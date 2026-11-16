// Mounts the worker as Orca would and talks to it over TCP like the Stream Deck plugin does.
import { mkdtempSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'
import type { ServerMessage } from './bridge-protocol'
import { readRendezvous } from './bridge-rendezvous'

// The worker writes its port and token where the deck looks; keep that out of the real home.
process.env.ORCA_STREAMDECK_BRIDGE_FILE = join(mkdtempSync(join(tmpdir(), 'orca-streamdeck-')), 'bridge.json')

const workspaces = [
  { id: 'w1', name: 'orca', project: null, path: '/repo', branch: 'main', kind: 'worktree' },
  { id: 'w2', name: 'docs', project: null, path: '/docs', branch: 'main', kind: 'worktree' }
]
const claude = { terminalId: 't1', title: 'Claude', agent: 'claude', state: 'blocked', stateStartedAt: 1000 }
const codex = { terminalId: 't2', title: 'Codex', agent: 'codex', state: 'working', stateStartedAt: 800 }

const host = () =>
  mockHost({
    results: {
      'workspace.list': { workspaces: workspaces.map((w) => ({ ...w, hostId: null })), truncated: false },
      'workspace.readContext': null,
      // w1 is the workspace Orca's window shows once it is focused.
      'agents.list': (params?: { workspaceId?: string }) => ({ agents: params?.workspaceId === 'w2' ? [codex] : [claude] }),
      'statusBar.update': { ok: true },
      'workspace.open': { opened: true },
      'agent.launch': { terminalId: 't9' }
    }
  })

async function connectClient(port: number) {
  const socket = connect({ host: '127.0.0.1', port })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.setEncoding('utf8')
  const lines: string[] = []
  const waiters: ((line: string) => void)[] = []
  let buffered = ''
  socket.on('data', (chunk: string) => {
    buffered += chunk
    let index = buffered.indexOf('\n')
    while (index !== -1) {
      const line = buffered.slice(0, index)
      buffered = buffered.slice(index + 1)
      const waiter = waiters.shift()
      if (waiter) waiter(line)
      else lines.push(line)
      index = buffered.indexOf('\n')
    }
  })
  const next = (): Promise<ServerMessage> =>
    new Promise((resolve) => {
      const line = lines.shift()
      if (line !== undefined) resolve(JSON.parse(line))
      else waiters.push((l) => resolve(JSON.parse(l)))
    })
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  const write = (text: string) => socket.write(text)
  return { next, write, closed, received: () => lines.length, send: (message: object) => write(`${JSON.stringify(message)}\n`), close: () => socket.destroy() }
}

test('greets a deck with the roster, pushes status changes and runs its actions in Orca', async () => {
  const worker = await mountWorker(main, { host: host() })
  const rendezvous = readRendezvous()
  assert.ok(rendezvous, 'the worker wrote no rendezvous file')
  assert.ok(String(await worker.command('streamdeck.status')).includes(`127.0.0.1:${rendezvous.port}`))

  const deck = await connectClient(rendezvous.port)
  deck.send({ type: 'auth', token: rendezvous.token })
  const hello = await deck.next()
  assert.equal(hello.type, 'hello')
  if (hello.type === 'hello') {
    assert.equal(hello.protocol, 5)
    assert.deepEqual(hello.plugin, { id: 'streamdeck-bridge', version: '1.0.1' })
  }
  // No workspace is focused, yet Orca listed the agents of each one, keyed by terminal until an event names the pane.
  assert.deepEqual(worker.host.callsOf('agents.list'), [{ workspaceId: 'w1' }, { workspaceId: 'w2' }])
  const listedClaude = { paneKey: 'terminal:t1', workspaceId: 'w1', terminalId: 't1', title: 'Claude', agent: 'claude', state: 'blocked', outcome: null, since: 1000 }
  const listedCodex = { paneKey: 'terminal:t2', workspaceId: 'w2', terminalId: 't2', title: 'Codex', agent: 'codex', state: 'working', outcome: null, since: 800 }
  assert.deepEqual(await deck.next(), { type: 'snapshot', agents: [listedClaude, listedCodex], workspaces, focusedWorkspaceId: null })

  // Events carry Orca's raw id too; the deck must see the one `workspace.list` gives.
  await worker.emit('agent.status.changed', { workspaceId: 'abc::/repo', workspaceListId: 'w1', paneKey: 'p1', terminalId: 't1', title: 'Claude', state: 'waiting', receivedAt: 2000 })
  const waiting = { ...listedClaude, paneKey: 'p1', state: 'waiting', since: 2000 }
  assert.deepEqual(await deck.next(), { type: 'agent', agent: waiting })
  assert.deepEqual(await deck.next(), { type: 'agent.removed', paneKey: 'terminal:t1' })
  const statusBar = worker.host.callsOf('statusBar.update').at(-1) as { text: string; tone: string }
  assert.equal(statusBar.text, '1')
  assert.equal(statusBar.tone, 'warning')

  // Focusing a workspace lists it again; the older state Orca reports does not undo the event.
  await worker.emit('workspace.changed', { context: { workspaceId: 'w1', displayName: 'elsewhere', branch: 'main', terminals: [{ id: 't1' }] } })
  assert.deepEqual(await deck.next(), { type: 'snapshot', agents: [waiting, listedCodex], workspaces, focusedWorkspaceId: 'w1' })

  deck.send({ type: 'open', id: 'r1', workspaceId: 'w1' })
  assert.deepEqual(await deck.next(), { type: 'result', id: 'r1', ok: true })
  assert.deepEqual(worker.host.callsOf('workspace.open'), [{ workspaceId: 'w1' }])

  // A launch shows on the deck right away, keyed by terminal until the agent's first event.
  deck.send({ type: 'launch', id: 'r3', workspaceId: 'w1', agent: 'codex' })
  const launched = await deck.next()
  assert.equal(launched.type, 'agent')
  if (launched.type === 'agent') {
    const { since, ...row } = launched.agent
    assert.equal(typeof since, 'number')
    assert.deepEqual(row, { paneKey: 'terminal:t9', workspaceId: 'w1', terminalId: 't9', title: null, agent: 'codex', state: 'working', outcome: null })
  }
  assert.deepEqual(await deck.next(), { type: 'result', id: 'r3', ok: true, result: { terminalId: 't9' } })

  deck.send({ type: 'focus', id: 'r4', terminalId: 't1' })
  assert.deepEqual(await deck.next(), { type: 'result', id: 'r4', ok: true, result: { focused: true } })
  assert.deepEqual(worker.host.callsOf('terminal.focus'), [{ terminalId: 't1' }])

  deck.close()
  await worker.deactivate()
  assert.deepEqual(worker.refusals, [])
  assert.equal(readRendezvous(), null)
})

test('tells nothing to, and runs nothing for, a client without the token', async () => {
  const worker = await mountWorker(main, { host: host() })
  const { port } = readRendezvous()!

  // What a web page can do: post to the loopback port, with a command as the request body.
  const page = await connectClient(port)
  page.write(`POST / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n${JSON.stringify({ type: 'open', workspaceId: 'w1' })}\n`)
  await page.closed

  const guesser = await connectClient(port)
  guesser.send({ type: 'auth', token: 'not-the-token' })
  guesser.send({ type: 'open', workspaceId: 'w1' })
  await guesser.closed

  assert.equal(page.received() + guesser.received(), 0)
  assert.deepEqual(worker.host.callsOf('workspace.open'), [])
  await worker.deactivate()
})

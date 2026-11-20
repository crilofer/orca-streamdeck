// Orca transpiles this file when it loads: no build step. The status bar item keeps the worker
// running while the plugin is enabled, so the roster sees every agent event after Orca starts.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Disposable } from 'orca/host'
import { AgentRoster } from './agent-roster'
import { isBotHome } from './bot-home'
import {
  BRIDGE_PROTOCOL,
  type ClientMessage,
  type WorkspaceSummary
} from './bridge-protocol'
import { removeRendezvous, writeRendezvous } from './bridge-rendezvous'
import { BridgeServer, type BridgeClient } from './bridge-server'

type WorkspaceContext = { workspaceId?: string; terminals: { id: string }[] }

const STATUS_ITEM = 'attention'

let server: BridgeServer | null = null
let boundPort: number | null = null
/** One per worker run; the deck reads it from the rendezvous file each time it connects. */
let token: string | null = null
const disposables: Disposable[] = []

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  const plugin = readManifestIdentity()
  const roster = new AgentRoster()
  let workspaces: WorkspaceSummary[] = []
  let focusedWorkspaceId: string | null = null

  const snapshot = () => ({
    type: 'snapshot' as const,
    agents: roster.list(),
    workspaces,
    focusedWorkspaceId
  })

  const refreshWorkspaces = async () => {
    try {
      const { workspaces: listed } = await orca.host.call('workspace.list')
      workspaces = listed.map((row) => ({
        id: row.id,
        name: row.name,
        project: row.project ?? null,
        path: row.path,
        branch: row.branch,
        kind: row.kind,
        bot: row.kind === 'folder' && isBotHome(row.path)
      }))
    } catch (error) {
      orca.log(`workspace.list failed: ${describe(error)}`)
    }
  }

  const syncFocusedAgents = async (context: WorkspaceContext | null) => {
    focusedWorkspaceId = context?.workspaceId ?? null
    if (!context) return
    try {
      const { agents } = await orca.host.call('agents.list')
      roster.syncFocused(agents, context.terminals.map((t) => t.id), focusedWorkspaceId)
    } catch (error) {
      orca.log(`agents.list failed: ${describe(error)}`)
    }
  }

  /**
   * Every workspace's agents, from Orca; its events keep them current after. Run when the worker
   * starts and again when a deck connects: right after Orca starts it lists less than it will.
   */
  const syncEverything = async () => {
    await refreshWorkspaces()
    let listed = 0
    let withoutTerminal = 0
    let unknowable = 0
    for (const workspace of workspaces) {
      try {
        const { agents } = await orca.host.call('agents.list', { workspaceId: workspace.id })
        listed += agents.length
        withoutTerminal += agents.filter((agent) => agent.terminalId === null).length
        unknowable += roster.syncWorkspace(agents, workspace.id)
      } catch (error) {
        orca.log(`agents.list(${workspace.name}) failed: ${describe(error)}`)
      }
    }
    try {
      await syncFocusedAgents(await orca.host.call('workspace.readContext'))
    } catch (error) {
      orca.log(`workspace.readContext failed: ${describe(error)}`)
    }
    orca.log(
      `Orca listed ${listed} agent(s) in ${workspaces.length} workspace(s): ${withoutTerminal} without a terminal, ${unknowable} of them without a session either (not shown)`
    )
  }

  const updateStatusBar = async () => {
    const count = roster.attentionCount()
    const decks = server?.clientCount ?? 0
    try {
      await orca.host.call('statusBar.update', {
        id: STATUS_ITEM,
        text: `${count}`,
        icon: count > 0 ? 'bell' : 'bot',
        tone: count > 0 ? 'warning' : 'neutral',
        tooltip: `Stream Deck bridge: ${count} agent(s) need you, ${decks} deck(s) connected`
      })
    } catch (error) {
      orca.log(`statusBar.update failed: ${describe(error)}`)
    }
  }

  const handleClientMessage = async (client: BridgeClient, message: ClientMessage) => {
    const { id } = message
    try {
      let result: unknown
      switch (message.type) {
        case 'snapshot':
          client.send(snapshot())
          break
        case 'open':
          await orca.host.call('workspace.open', { workspaceId: message.workspaceId })
          break
        case 'launch': {
          const { terminalId } = await orca.host.call('agent.launch', {
            workspaceId: message.workspaceId,
            agent: message.agent,
            ...(message.prompt !== undefined ? { prompt: message.prompt } : {})
          })
          // Orca opens the agent's tab in the background; the deck shows it before its first status event.
          const launched = roster.addLaunched(terminalId, message.workspaceId, message.agent, Date.now())
          server?.broadcast({ type: 'agent', agent: launched })
          result = { terminalId }
          break
        }
        case 'focus':
          // `focused` is false when a newer request won or Orca's window did not move.
          result = await orca.host.call('terminal.focus', { terminalId: message.terminalId })
          break
      }
      if (id !== undefined) client.send({ type: 'result', id, ok: true, ...(result !== undefined ? { result } : {}) })
    } catch (error) {
      orca.log(`${message.type} failed: ${describe(error)}`)
      if (id !== undefined) {
        client.send({ type: 'result', id, ok: false, error: { code: errorCode(error), message: describe(error) } })
      }
    }
  }

  disposables.push(
    orca.events.on('agent.status.changed', (event) => {
      const { agent, replaced } = roster.apply(event)
      server?.broadcast({ type: 'agent', agent })
      // The agent was listed or launched before this event named its pane; decks hold it under the old key.
      if (replaced !== null) server?.broadcast({ type: 'agent.removed', paneKey: replaced })
      void updateStatusBar()
    }),
    orca.events.on('workspace.removed', ({ workspaceId, workspaceListId }) => {
      const removed = workspaceListId ?? workspaceId
      for (const paneKey of roster.removeWorkspace(removed)) server?.broadcast({ type: 'agent.removed', paneKey })
      workspaces = workspaces.filter((w) => w.id !== removed)
      void updateStatusBar()
    }),
    orca.events.on('workspace.changed', async ({ context }) => {
      await refreshWorkspaces()
      await syncFocusedAgents(context)
      server?.broadcast(snapshot())
      void updateStatusBar()
    }),
    orca.commands.register('streamdeck.status', () => {
      const listening = boundPort !== null ? `listening on 127.0.0.1:${boundPort}` : 'not listening'
      const agents = roster.list()
      return `Stream Deck bridge: ${listening}, ${server?.clientCount ?? 0} deck(s) connected, ${agents.length} agent(s), ${roster.attentionCount()} need you`
    })
  )

  const startServer = async () => {
    token = randomBytes(24).toString('hex')
    server = new BridgeServer({
      token,
      log: (message) => orca.log(message),
      onConnect: (client) => {
        client.send({ type: 'hello', protocol: BRIDGE_PROTOCOL, plugin })
        void syncEverything().then(() => {
          server?.broadcast(snapshot())
          void updateStatusBar()
        })
      },
      onMessage: handleClientMessage
    })
    try {
      boundPort = await server.listen()
      writeRendezvous({ port: boundPort, token })
      orca.log(`listening on 127.0.0.1:${boundPort}`)
    } catch (error) {
      orca.log(`cannot listen on 127.0.0.1: ${describe(error)}`)
    }
  }

  await syncEverything()
  // Listen last, so a failed activation never leaves a port open behind a worker Orca will restart.
  await startServer()
  try {
    await updateStatusBar()
  } catch (error) {
    await deactivate()
    throw error
  }
}

export async function deactivate(): Promise<void> {
  for (const disposable of disposables.splice(0)) disposable.dispose()
  await server?.close()
  server = null
  boundPort = null
  if (token !== null) removeRendezvous(token)
  token = null
}

function readManifestIdentity(): { id: string; version: string } {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
    return { id: String(manifest.id), version: String(manifest.version) }
  } catch {
    return { id: 'streamdeck-bridge', version: 'unknown' }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' ? code : 'action_failed'
}

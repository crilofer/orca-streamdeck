import { assert, test } from 'orca/testing'
import { AgentRoster, type AgentStatusEvent } from './agent-roster'

const status = (paneKey: string, state: AgentStatusEvent['state'], receivedAt: number): AgentStatusEvent => ({
  workspaceId: 'w1',
  paneKey,
  terminalId: `t-${paneKey}`,
  state,
  receivedAt
})

test('lists whoever needs a person first, newest first within a state', () => {
  const roster = new AgentRoster()
  roster.apply(status('busy', 'working', 10))
  roster.apply(status('asked-early', 'blocked', 20))
  roster.apply(status('idle', 'waiting', 30))
  roster.apply(status('asked-late', 'blocked', 40))
  roster.apply(status('finished', 'done', 50))

  assert.deepEqual(
    roster.list().map((agent) => agent.paneKey),
    ['asked-late', 'asked-early', 'idle', 'busy', 'finished']
  )
  assert.equal(roster.attentionCount(), 3)
})

test('keeps when a state began across repeated reports and forgets a removed workspace', () => {
  const roster = new AgentRoster()
  roster.apply(status('a', 'working', 10))
  roster.apply(status('a', 'working', 20))
  assert.equal(roster.list()[0].since, 10)
  roster.apply(status('a', 'blocked', 30))
  assert.equal(roster.list()[0].since, 30)

  roster.apply({ ...status('b', 'working', 40), workspaceId: 'w2' })
  assert.deepEqual(roster.removeWorkspace('w1'), ['a'])
  assert.deepEqual(roster.list().map((agent) => agent.paneKey), ['b'])
})

test('an agent listed before any event is replaced by the event that names its pane', () => {
  const roster = new AgentRoster()
  roster.syncFocused(
    [{ terminalId: 't-x', title: 'Claude', agent: 'claude', state: 'working', stateStartedAt: 5 }],
    ['t-x', 't-empty'],
    'w1'
  )
  assert.deepEqual(roster.list().map((agent) => [agent.paneKey, agent.agent]), [['terminal:t-x', 'claude']])

  roster.apply({ ...status('pane-x', 'blocked', 9), terminalId: 't-x' })
  assert.deepEqual(roster.list().map((agent) => [agent.paneKey, agent.agent, agent.state]), [['pane-x', 'claude', 'blocked']])

  roster.syncFocused([], ['t-x'], 'w1')
  assert.deepEqual(roster.list(), [])
})

test('forgets an agent of the focused workspace whose terminal closed, keeps the rest', () => {
  const roster = new AgentRoster()
  roster.apply({ workspaceId: 'W', paneKey: 'open', terminalId: 't-open', state: 'working', receivedAt: 1 })
  roster.apply({ workspaceId: 'W', paneKey: 'closed', terminalId: 't-closed', state: 'done', receivedAt: 2 })
  roster.apply({ workspaceId: 'OTHER', paneKey: 'elsewhere', terminalId: 't-elsewhere', state: 'done', receivedAt: 3 })

  roster.syncFocused([{ terminalId: 't-open', title: null, agent: 'claude', state: 'working', stateStartedAt: 1 }], ['t-open'], 'W')

  assert.deepEqual(roster.list().map((agent) => agent.paneKey), ['open', 'elsewhere'])
})

test('a listing corrects the state of an agent whose last event was missed, not a newer event', () => {
  const roster = new AgentRoster()
  roster.apply({ workspaceId: 'W', paneKey: 'p', terminalId: 't', state: 'working', receivedAt: 5 })

  roster.syncFocused([{ terminalId: 't', title: null, agent: 'claude', state: 'done', stateStartedAt: 7 }], ['t'], 'W')
  assert.deepEqual(roster.list().map((agent) => [agent.paneKey, agent.state, agent.since]), [['p', 'done', 7]])

  roster.apply({ workspaceId: 'W', paneKey: 'p', terminalId: 't', state: 'waiting', receivedAt: 9 })
  roster.syncFocused([{ terminalId: 't', title: null, agent: 'claude', state: 'done', stateStartedAt: 7 }], ['t'], 'W')
  assert.deepEqual(roster.list().map((agent) => [agent.paneKey, agent.state, agent.since]), [['p', 'waiting', 9]])
})

test('a launched agent survives listings that do not name it yet, until it reports or the grace runs out', () => {
  const roster = new AgentRoster()
  roster.addLaunched('t-new', 'W', 'claude', 1_000)
  roster.syncFocused([], ['t-new'], 'W', 1_500)
  assert.deepEqual(roster.list().map((agent) => [agent.paneKey, agent.state]), [['terminal:t-new', 'working']])

  assert.equal(roster.apply({ ...status('pane-new', 'done', 2_000), terminalId: 't-new' }).replaced, 'terminal:t-new')
  roster.syncFocused([], ['t-new'], 'W', 2_500)
  assert.deepEqual(roster.list(), [])

  roster.addLaunched('t-silent', 'W', 'claude', 10_000)
  roster.syncFocused([], ['t-silent'], 'W', 39_999)
  assert.deepEqual(roster.list().map((agent) => agent.paneKey), ['terminal:t-silent'])
  roster.syncFocused([], ['t-silent'], 'W', 40_000)
  assert.deepEqual(roster.list(), [])
})

test('an agent Orca lists without a terminal is kept by its session, and stays one agent once Orca names its terminal and pane', () => {
  const roster = new AgentRoster()
  const rows = () => roster.list().map((agent) => [agent.paneKey, agent.terminalId, agent.agent, agent.state])
  // What Orca answers right after it starts: it has the agent's status, not yet its terminal.
  roster.syncWorkspace([{ terminalId: null, title: null, agent: 'claude', state: 'waiting', stateStartedAt: 5, sessionId: 's1' }], 'W')
  assert.deepEqual(rows(), [['session:s1', null, 'claude', 'waiting']])

  roster.syncFocused([{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', stateStartedAt: 5, sessionId: 's1' }], ['t1'], 'W')
  assert.deepEqual(rows(), [['session:s1', 't1', 'claude', 'waiting']])

  const named = roster.apply({ workspaceId: 'W', paneKey: 'p1', terminalId: 't1', state: 'working', receivedAt: 9 })
  assert.equal(named.replaced, 'session:s1')
  assert.deepEqual(rows(), [['p1', 't1', 'claude', 'working']])
})

test('an event that carries only the session takes over the agent listed without a terminal', () => {
  const roster = new AgentRoster()
  roster.syncWorkspace([{ terminalId: null, title: null, agent: 'codex', state: 'done', stateStartedAt: 5, sessionId: 's1' }], 'W')

  assert.equal(roster.apply({ workspaceId: 'W', paneKey: 'chat-1', sessionId: 's1', state: 'working', receivedAt: 9 }).replaced, 'session:s1')
  assert.deepEqual(roster.list().map((agent) => [agent.paneKey, agent.agent]), [['chat-1', 'codex']])
  // Still listed without a terminal: the same agent, not a second one.
  roster.syncWorkspace([{ terminalId: null, title: null, agent: 'codex', state: 'working', stateStartedAt: 9, sessionId: 's1' }], 'W')
  assert.deepEqual(roster.list().map((agent) => agent.paneKey), ['chat-1'])
})

test('forgets an agent without a terminal once Orca no longer lists its session in that workspace', () => {
  const roster = new AgentRoster()
  const listed = (sessionId: string) => ({ terminalId: null, title: null, agent: 'claude', state: 'done' as const, stateStartedAt: 5, sessionId })
  roster.syncWorkspace([listed('s1'), listed('s2')], 'W')
  roster.syncWorkspace([listed('s3')], 'OTHER')

  roster.syncWorkspace([listed('s2')], 'W')
  assert.deepEqual(roster.list().map((agent) => agent.paneKey).sort(), ['session:s2', 'session:s3'])
})

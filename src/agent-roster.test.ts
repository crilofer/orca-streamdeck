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

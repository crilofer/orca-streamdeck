import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RosterAgent } from '../../src/bridge-protocol.ts'
import { nextAgent, shownAgent, workspaceAgents } from './workspace-key-view.ts'

const agent = (paneKey: string, state: RosterAgent['state'], since: number, workspaceId = 'W'): RosterAgent => ({
  paneKey,
  workspaceId,
  terminalId: `t-${paneKey}`,
  title: null,
  agent: 'claude',
  state,
  outcome: null,
  since
})

test('shows whoever answered last, keeps a tapped agent until someone else answers after the tap', () => {
  const blocked = agent('a', 'blocked', 100)
  const done = agent('b', 'done', 200)
  const working = agent('c', 'working', 300)
  const agents = workspaceAgents([working, done, blocked, agent('x', 'blocked', 999, 'OTHER')], 'W')

  assert.deepEqual(agents.map((a) => a.paneKey), ['a', 'b', 'c'])
  assert.equal(shownAgent(agents, null)?.paneKey, 'b')
  assert.equal(shownAgent(agents, { paneKey: 'a', terminalId: 't-a', at: 250 })?.paneKey, 'a')

  const answered = agents.map((a) => (a.paneKey === 'c' ? { ...a, state: 'waiting' as const, since: 400 } : a))
  assert.equal(shownAgent(answered, { paneKey: 'a', terminalId: 't-a', at: 250 })?.paneKey, 'c')
  assert.equal(shownAgent(agents, { paneKey: 'gone', terminalId: null, at: 250 })?.paneKey, 'b')
  // A launched agent is first keyed by terminal; the tap that launched it still matches its real pane.
  assert.equal(shownAgent(agents, { paneKey: 'terminal:t-c', terminalId: 't-c', at: 250 })?.paneKey, 'c')
  assert.equal(nextAgent(agents, working).paneKey, 'a')
})

test('with every agent working, the newest one shows', () => {
  const agents = [agent('a', 'working', 100), agent('b', 'working', 200)]
  assert.equal(shownAgent(agents, null)?.paneKey, 'b')
  assert.equal(shownAgent([], null), null)
})

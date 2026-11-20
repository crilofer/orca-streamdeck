import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RosterAgent, WorkspaceSummary } from '../../src/bridge-protocol.ts'
import { agentsInScope, botViews, shownBot } from './bot-view.ts'

const workspace = (id: string, name: string, bot: boolean): WorkspaceSummary => ({ id, name, project: null, path: `/${id}`, branch: null, kind: 'folder', bot })
const chat = (paneKey: string, workspaceId: string, state: RosterAgent['state'], since: number): RosterAgent => ({
  paneKey,
  workspaceId,
  terminalId: null,
  title: null,
  agent: 'claude',
  state,
  outcome: null,
  since
})

const workspaces = [workspace('zed', 'Zed', true), workspace('repo', 'app', false), workspace('amy', 'amy', true), workspace('bo', 'Bo', true)]

test('lists bots by name with their chats, the one that needs a person first', () => {
  const agents = [chat('z1', 'zed', 'done', 5), chat('z2', 'zed', 'blocked', 3), chat('r1', 'repo', 'blocked', 9)]
  const bots = botViews(workspaces, agents)
  assert.deepEqual(bots.map((bot) => [bot.workspace.name, bot.chats.map((c) => c.paneKey), bot.lead?.paneKey ?? null]), [
    ['amy', [], null],
    ['Bo', [], null],
    ['Zed', ['z2', 'z1'], 'z2']
  ])
})

test('the dial shows the most urgent bot, keeps a picked one, and lets go of it when another bot asks later', () => {
  const working = [chat('a1', 'amy', 'working', 10), chat('z1', 'zed', 'waiting', 20)]
  assert.equal(shownBot(botViews(workspaces, working), null)?.workspace.id, 'zed')
  assert.equal(shownBot(botViews(workspaces, working), { workspaceId: 'bo', at: 30 })?.workspace.id, 'bo')
  assert.equal(shownBot(botViews(workspaces, working), { workspaceId: 'gone', at: 30 })?.workspace.id, 'zed')

  const askedLater = [chat('a1', 'amy', 'blocked', 40), chat('z1', 'zed', 'waiting', 20)]
  assert.equal(shownBot(botViews(workspaces, askedLater), { workspaceId: 'bo', at: 30 })?.workspace.id, 'amy')
  assert.equal(shownBot(botViews(workspaces, []), null)?.workspace.id, 'amy')
})

test('Needs you counts everything, only agents or only bots', () => {
  const agents = [chat('z1', 'zed', 'blocked', 3), chat('r1', 'repo', 'blocked', 9), { ...chat('loose', 'x', 'done', 1), workspaceId: null }]
  assert.deepEqual(agentsInScope(agents, workspaces, 'all').map((a) => a.paneKey), ['z1', 'r1', 'loose'])
  assert.deepEqual(agentsInScope(agents, workspaces, 'agents').map((a) => a.paneKey), ['r1', 'loose'])
  assert.deepEqual(agentsInScope(agents, workspaces, 'bots').map((a) => a.paneKey), ['z1'])
})

// What the Bot key, the Bots dial and the Needs you key make of the roster: a bot is a workspace,
// and its chats are that workspace's agents.
import { byAttention, needsAttention, type RosterAgent, type WorkspaceSummary } from '../../src/bridge-protocol.ts'

/** A bot with its chats, the one that most needs a person first; `lead` is null while it has none. */
export type BotView = { workspace: WorkspaceSummary; chats: RosterAgent[]; lead: RosterAgent | null }

/** Which agents the Needs you key counts. */
export type AttentionScope = 'all' | 'agents' | 'bots'

/** The dial's pick and when it was made; it holds until another bot asks for a person after that. */
export type BotPick = { workspaceId: string; at: number }

/** Every bot, by name: an order that stays put while their states change. */
export function botViews(workspaces: WorkspaceSummary[], agents: RosterAgent[]): BotView[] {
  return workspaces
    .filter((workspace) => workspace.bot)
    .map((workspace) => {
      const chats = agents.filter((agent) => agent.workspaceId === workspace.id).sort(byAttention)
      return { workspace, chats, lead: chats[0] ?? null }
    })
    .sort((a, b) => a.workspace.name.localeCompare(b.workspace.name, undefined, { sensitivity: 'base' }))
}

/** The bot the dial shows: the picked one, unless another bot has asked for a person since. */
export function shownBot(bots: BotView[], pick: BotPick | null): BotView | null {
  const urgent = [...bots].sort((a, b) => (a.lead && b.lead ? byAttention(a.lead, b.lead) : a.lead ? -1 : b.lead ? 1 : 0))[0] ?? null
  const picked = pick ? bots.find((bot) => bot.workspace.id === pick.workspaceId) : undefined
  if (!pick || !picked) return urgent
  const askedSince = bots.some((bot) => bot !== picked && bot.lead !== null && needsAttention(bot.lead.state) && bot.lead.since > pick.at)
  return askedSince ? urgent : picked
}

export function agentsInScope(agents: RosterAgent[], workspaces: WorkspaceSummary[], scope: AttentionScope): RosterAgent[] {
  if (scope === 'all') return agents
  const botIds = new Set(workspaces.filter((workspace) => workspace.bot).map((workspace) => workspace.id))
  return agents.filter((agent) => (agent.workspaceId !== null && botIds.has(agent.workspaceId)) === (scope === 'bots'))
}

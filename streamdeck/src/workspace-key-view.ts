// What an Agent key shows for its workspace when several agents run there.
import type { RosterAgent } from '../../src/bridge-protocol.ts'

/**
 * The agent a person tapped to (or just launched), and when; it holds until another agent answers
 * after that. A launched agent is keyed by terminal until its first status event names its pane.
 */
export type ShownOverride = { paneKey: string; terminalId: string | null; at: number }

/** One workspace's agents in a stable order, so the dots and "next" do not jump as states change. */
export function workspaceAgents(agents: RosterAgent[], workspaceId: string): RosterAgent[] {
  return agents.filter((agent) => agent.workspaceId === workspaceId).sort((a, b) => a.paneKey.localeCompare(b.paneKey))
}

/** Whoever answered last (stopped working most recently), unless a tap picked another agent since. */
export function shownAgent(agents: RosterAgent[], override: ShownOverride | null): RosterAgent | null {
  if (agents.length === 0) return null
  const answered = agents.filter((agent) => agent.state !== 'working').sort((a, b) => b.since - a.since)
  if (override) {
    const picked = agents.find(
      (agent) => agent.paneKey === override.paneKey || (override.terminalId !== null && agent.terminalId === override.terminalId)
    )
    const newerAnswer = answered.some((agent) => agent !== picked && agent.since > override.at)
    if (picked && !newerAnswer) return picked
  }
  return answered[0] ?? [...agents].sort((a, b) => b.since - a.since)[0]!
}

export function nextAgent(agents: RosterAgent[], current: RosterAgent): RosterAgent {
  const index = agents.findIndex((agent) => agent.paneKey === current.paneKey)
  return agents[(index + 1) % agents.length]!
}

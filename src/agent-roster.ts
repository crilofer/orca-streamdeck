import type { PluginEvents } from 'orca/host'

import { byAttention, needsAttention, type AgentState, type RosterAgent } from './bridge-protocol'

export type { AgentState, RosterAgent }
export type AgentStatusEvent = PluginEvents['agent.status.changed']
export type ListedAgent = {
  terminalId: string | null
  title: string | null
  agent: string | null
  state: AgentState
  stateStartedAt: number
}

/** How long a launched agent is kept while Orca does not list it yet: its CLI is still starting. */
export const LAUNCH_GRACE_MS = 30_000

/** Every agent Orca has reported since the worker started, keyed by Orca's pane id. */
export class AgentRoster {
  private readonly agents = new Map<string, RosterAgent>()
  /** When each launched agent that Orca has not reported yet was started, by terminal. */
  private readonly launchedAt = new Map<string, number>()

  /** The agent after the event, and the key of the terminal-keyed row its pane took over, if any. */
  apply(event: AgentStatusEvent): { agent: RosterAgent; replaced: string | null } {
    const known = this.agents.get(event.paneKey)
    const listed = known ? undefined : this.takeListedByTerminal(event.terminalId)
    if (event.terminalId) this.launchedAt.delete(event.terminalId)
    const previous = known ?? listed
    const agent: RosterAgent = {
      paneKey: event.paneKey,
      // The id `workspace.list` gives, which is what the deck and every workspace method use.
      workspaceId: event.workspaceListId ?? event.workspaceId ?? previous?.workspaceId ?? null,
      terminalId: event.terminalId ?? previous?.terminalId ?? null,
      title: event.title ?? previous?.title ?? null,
      agent: previous?.agent ?? null,
      state: event.state,
      outcome: event.mainAgent?.outcome ?? null,
      since: previous?.state === event.state ? previous.since : event.receivedAt
    }
    this.agents.set(event.paneKey, agent)
    return { agent, replaced: listed?.paneKey ?? null }
  }

  /**
   * A launch Orca just confirmed: show it working at once, keyed by terminal until the agent's
   * first status event names its pane.
   */
  addLaunched(terminalId: string, workspaceId: string, agent: string, now: number): RosterAgent {
    const known = this.findByTerminal(terminalId)
    if (known) return known
    const launched: RosterAgent = {
      paneKey: `terminal:${terminalId}`,
      workspaceId,
      terminalId,
      title: null,
      agent,
      state: 'working',
      outcome: null,
      since: now
    }
    this.agents.set(launched.paneKey, launched)
    this.launchedAt.set(terminalId, now)
    return launched
  }

  /** Orca listed one workspace's agents in full: whatever it no longer lists there is gone. */
  syncWorkspace(listed: ListedAgent[], workspaceId: string): void {
    const terminalIds = listed.flatMap((agent) => (agent.terminalId === null ? [] : [agent.terminalId]))
    this.syncFocused(listed, terminalIds, workspaceId)
  }

  /**
   * Orca listed the focused workspace's agents: learn their kind and current state, forget agents in that
   * workspace's terminals that Orca no longer lists, and agents of that workspace whose terminal
   * is gone. `workspaceId` is null when unknown. An agent launched moments ago stays: Orca lists it
   * only once its CLI has reported.
   */
  syncFocused(listed: ListedAgent[], terminalIds: string[], workspaceId: string | null, now = Date.now()): void {
    const listedByTerminal = new Map(
      listed.filter((agent) => agent.terminalId !== null).map((agent) => [agent.terminalId, agent])
    )
    for (const terminalId of listedByTerminal.keys()) this.launchedAt.delete(terminalId!)
    for (const [paneKey, agent] of this.agents) {
      if (agent.terminalId === null) continue
      const launchedAt = this.launchedAt.get(agent.terminalId)
      if (launchedAt !== undefined) {
        if (now - launchedAt < LAUNCH_GRACE_MS) continue
        this.launchedAt.delete(agent.terminalId)
      }
      const inFocusedTerminals = terminalIds.includes(agent.terminalId)
      if (inFocusedTerminals && !listedByTerminal.has(agent.terminalId)) {
        this.agents.delete(paneKey)
        continue
      }
      const inFocusedWorkspace = workspaceId !== null && agent.workspaceId === workspaceId
      if (inFocusedWorkspace && !inFocusedTerminals) this.agents.delete(paneKey)
    }
    for (const [terminalId, entry] of listedByTerminal) {
      const known = this.findByTerminal(terminalId!)
      if (known) {
        known.agent = entry.agent ?? known.agent
        known.title = entry.title ?? known.title
        known.workspaceId = known.workspaceId ?? workspaceId
        // Orca's listing corrects a state whose event the worker missed, but not an event newer
        // than the state it reports.
        if (known.state !== entry.state && entry.stateStartedAt >= known.since) {
          known.state = entry.state
          known.outcome = null
          known.since = entry.stateStartedAt
        }
        continue
      }
      // Seen before any event: keyed by terminal until an event names its pane.
      this.agents.set(`terminal:${terminalId}`, {
        paneKey: `terminal:${terminalId}`,
        workspaceId,
        terminalId: terminalId!,
        title: entry.title,
        agent: entry.agent,
        state: entry.state,
        outcome: null,
        since: entry.stateStartedAt
      })
    }
  }

  removeWorkspace(workspaceId: string): string[] {
    const removed: string[] = []
    for (const [paneKey, agent] of this.agents) {
      if (agent.workspaceId === workspaceId) {
        this.agents.delete(paneKey)
        removed.push(paneKey)
      }
    }
    return removed
  }

  list(): RosterAgent[] {
    return [...this.agents.values()].sort(byAttention)
  }

  attentionCount(): number {
    let count = 0
    for (const agent of this.agents.values()) if (needsAttention(agent.state)) count++
    return count
  }

  private findByTerminal(terminalId: string): RosterAgent | undefined {
    for (const agent of this.agents.values()) if (agent.terminalId === terminalId) return agent
    return undefined
  }

  private takeListedByTerminal(terminalId: string | undefined): RosterAgent | undefined {
    if (terminalId === undefined) return undefined
    const key = `terminal:${terminalId}`
    const listed = this.agents.get(key)
    if (listed) this.agents.delete(key)
    return listed
  }
}

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
  /** The agent's own session id, when Orca has one. */
  sessionId?: string | null
}

/** How long a launched agent is kept while Orca does not list it yet: its CLI is still starting. */
export const LAUNCH_GRACE_MS = 30_000

/** Every agent Orca has reported since the worker started, keyed by Orca's pane id. */
export class AgentRoster {
  private readonly agents = new Map<string, RosterAgent>()
  /** When each launched agent that Orca has not reported yet was started, by terminal. */
  private readonly launchedAt = new Map<string, number>()
  /** The keys of agents Orca listed or launched that no event has named the pane of yet. */
  private readonly unnamed = new Set<string>()
  /** Each agent's own session id, when Orca gave one, by the key the agent is held under. */
  private readonly sessions = new Map<string, string>()

  /** The agent after the event, and the key of the listed row its pane took over, if any. */
  apply(event: AgentStatusEvent): { agent: RosterAgent; replaced: string | null } {
    const known = this.agents.get(event.paneKey)
    const listed = known ? undefined : this.findUnnamed(event.terminalId, event.sessionId)
    const sessionId = event.sessionId ?? this.sessions.get(listed?.paneKey ?? event.paneKey)
    if (listed) this.forget(listed.paneKey)
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
    if (sessionId !== undefined) this.sessions.set(event.paneKey, sessionId)
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
    this.unnamed.add(launched.paneKey)
    this.launchedAt.set(terminalId, now)
    return launched
  }

  /**
   * Orca listed one workspace's agents in full: whatever it no longer lists there is gone. Returns
   * how many it listed that cannot be shown, having neither a terminal nor a session to know them by.
   */
  syncWorkspace(listed: ListedAgent[], workspaceId: string): number {
    const terminalIds = listed.flatMap((agent) => (agent.terminalId === null ? [] : [agent.terminalId]))
    return this.syncFocused(listed, terminalIds, workspaceId)
  }

  /**
   * Orca listed the focused workspace's agents: learn their kind and current state, forget agents in that
   * workspace's terminals that Orca no longer lists, and agents of that workspace whose terminal
   * is gone. `workspaceId` is null when unknown. An agent launched moments ago stays: Orca lists it
   * only once its CLI has reported. An agent Orca ties to no terminal, as it does for every agent
   * right after it starts and for chats always, is known by its session instead. Returns how many
   * listed agents have neither and cannot be shown.
   */
  syncFocused(listed: ListedAgent[], terminalIds: string[], workspaceId: string | null, now = Date.now()): number {
    const listedByTerminal = new Map(
      listed.filter((agent) => agent.terminalId !== null).map((agent) => [agent.terminalId, agent])
    )
    const listedSessions = new Set(listed.flatMap((agent) => (agent.sessionId ? [agent.sessionId] : [])))
    for (const terminalId of listedByTerminal.keys()) this.launchedAt.delete(terminalId!)
    for (const [paneKey, agent] of this.agents) {
      const sessionId = this.sessions.get(paneKey)
      // Orca still lists it, whatever it says of its terminal this time.
      if (sessionId !== undefined && listedSessions.has(sessionId)) continue
      if (agent.terminalId === null) {
        const inWorkspace = workspaceId !== null && agent.workspaceId === workspaceId
        if (inWorkspace && sessionId !== undefined) this.forget(paneKey)
        continue
      }
      const launchedAt = this.launchedAt.get(agent.terminalId)
      if (launchedAt !== undefined) {
        if (now - launchedAt < LAUNCH_GRACE_MS) continue
        this.launchedAt.delete(agent.terminalId)
      }
      const inFocusedTerminals = terminalIds.includes(agent.terminalId)
      if (inFocusedTerminals && !listedByTerminal.has(agent.terminalId)) {
        this.forget(paneKey)
        continue
      }
      const inFocusedWorkspace = workspaceId !== null && agent.workspaceId === workspaceId
      if (inFocusedWorkspace && !inFocusedTerminals) this.forget(paneKey)
    }
    let unknowable = 0
    for (const entry of listed) {
      const { terminalId } = entry
      const sessionId = entry.sessionId ?? undefined
      const known = (terminalId !== null ? this.findByTerminal(terminalId) : undefined) ?? this.findBySession(sessionId)
      if (known) {
        known.agent = entry.agent ?? known.agent
        known.title = entry.title ?? known.title
        known.workspaceId = known.workspaceId ?? workspaceId
        known.terminalId = terminalId ?? known.terminalId
        if (sessionId !== undefined) this.claimSession(known.paneKey, sessionId)
        // Orca's listing corrects a state whose event the worker missed, but not an event newer
        // than the state it reports.
        if (known.state !== entry.state && entry.stateStartedAt >= known.since) {
          known.state = entry.state
          known.outcome = null
          known.since = entry.stateStartedAt
        }
        continue
      }
      // Seen before any event: keyed by terminal, or by session without one, until an event names its pane.
      const paneKey = terminalId !== null ? `terminal:${terminalId}` : sessionId !== undefined ? `session:${sessionId}` : null
      if (paneKey === null) {
        unknowable++
        continue
      }
      this.agents.set(paneKey, {
        paneKey,
        workspaceId,
        terminalId,
        title: entry.title,
        agent: entry.agent,
        state: entry.state,
        outcome: null,
        since: entry.stateStartedAt
      })
      this.unnamed.add(paneKey)
      if (sessionId !== undefined) this.sessions.set(paneKey, sessionId)
    }
    return unknowable
  }

  removeWorkspace(workspaceId: string): string[] {
    const removed: string[] = []
    for (const [paneKey, agent] of this.agents) {
      if (agent.workspaceId === workspaceId) {
        this.forget(paneKey)
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

  private findBySession(sessionId: string | undefined): RosterAgent | undefined {
    if (sessionId === undefined) return undefined
    for (const [paneKey, known] of this.sessions) if (known === sessionId) return this.agents.get(paneKey)
    return undefined
  }

  /** The listed or launched agent an event is about: by its terminal, else by its session. */
  private findUnnamed(terminalId: string | undefined, sessionId: string | undefined): RosterAgent | undefined {
    const unnamed = [...this.unnamed].map((paneKey) => this.agents.get(paneKey)!)
    return (
      (terminalId === undefined ? undefined : unnamed.find((agent) => agent.terminalId === terminalId)) ??
      (sessionId === undefined ? undefined : unnamed.find((agent) => this.sessions.get(agent.paneKey) === sessionId))
    )
  }

  /** One agent per session: a row an earlier listing made for the same session, by another key, goes. */
  private claimSession(paneKey: string, sessionId: string): void {
    for (const [other, known] of this.sessions) if (known === sessionId && other !== paneKey) this.forget(other)
    this.sessions.set(paneKey, sessionId)
  }

  private forget(paneKey: string): void {
    this.agents.delete(paneKey)
    this.unnamed.delete(paneKey)
    this.sessions.delete(paneKey)
  }
}

// What every key and dial shares: the roster from the bridge plus the agent the person selected.
import type { RosterAgent, WorkspaceSummary } from '../../src/bridge-protocol.ts'
import type { BridgeClient } from './bridge-client.ts'
import { agentsInScope, botViews, type AttentionScope, type BotView } from './bot-view.ts'
import { workspaceAgents, type ShownOverride } from './workspace-key-view.ts'

export class DeckState {
  private selectedPaneKey: string | null = null
  /** An agent listed or launched before its first event changes key; its terminal does not. */
  private selectedTerminalId: string | null = null
  private selectedAt = 0
  private readonly listeners = new Set<() => void>()

  /** `raiseOrca` brings Orca in front of other apps once it shows what a press asked for. */
  constructor(
    readonly bridge: BridgeClient,
    readonly raiseOrca: () => void = () => {}
  ) {
    bridge.subscribe(() => this.notify())
  }

  get connected(): boolean {
    return this.bridge.status === 'connected'
  }

  agents(): RosterAgent[] {
    return this.bridge.agents()
  }

  /** The agents the Needs you key counts: all of them, or leaving bots' chats in or out. */
  agentsInScope(scope: AttentionScope): RosterAgent[] {
    return agentsInScope(this.bridge.agents(), this.bridge.workspaces, scope)
  }

  /** Every agent but bots' chats, which have a key and a dial of their own. */
  codingAgents(): RosterAgent[] {
    return this.agentsInScope('agents')
  }

  /** Every bot on this computer, by name. */
  bots(): BotView[] {
    return botViews(this.bridge.workspaces, this.bridge.agents())
  }

  agentsIn(workspaceId: string): RosterAgent[] {
    return workspaceAgents(this.bridge.agents(), workspaceId)
  }

  /** The workspace Orca shows, as the bridge last reported or as we last opened. */
  get focusedWorkspaceId(): string | null {
    return this.bridge.focusedWorkspaceId
  }

  /** Shows the workspace in Orca and counts it as focused until Orca says otherwise. */
  async open(workspaceId: string): Promise<void> {
    await this.bridge.request({ type: 'open', workspaceId })
    this.bridge.markFocused(workspaceId)
    this.raiseOrca()
  }

  /** Brings the agent's terminal to the front; an agent Orca tied to no terminal gets its workspace shown. */
  async focus(agent: RosterAgent): Promise<void> {
    if (agent.terminalId !== null) {
      await this.bridge.request({ type: 'focus', terminalId: agent.terminalId })
      if (agent.workspaceId !== null) this.bridge.markFocused(agent.workspaceId)
      this.raiseOrca()
      return
    }
    if (agent.workspaceId === null) throw new Error('Orca has not tied this agent to a workspace')
    await this.open(agent.workspaceId)
  }

  /** The coding agent the dial picked while it is still around, else the one that most needs a person. */
  selected(): RosterAgent | null {
    const agents = this.codingAgents()
    if (this.selectedPaneKey !== null) {
      const picked =
        agents.find((agent) => agent.paneKey === this.selectedPaneKey) ??
        agents.find((agent) => this.selectedTerminalId !== null && agent.terminalId === this.selectedTerminalId)
      if (picked) {
        this.selectedPaneKey = picked.paneKey
        return picked
      }
      this.selectedPaneKey = null
      this.selectedTerminalId = null
    }
    return agents[0] ?? null
  }

  isSelected(agent: RosterAgent): boolean {
    return this.selected()?.paneKey === agent.paneKey
  }

  /** The agent a key or the dial picked, as the override a key holds, so every key follows it. */
  selection(): ShownOverride | null {
    return this.selectedPaneKey === null ? null : { paneKey: this.selectedPaneKey, terminalId: this.selectedTerminalId, at: this.selectedAt }
  }

  select(paneKey: string | null, terminalId: string | null = paneKey === null ? null : (this.bridge.agent(paneKey)?.terminalId ?? null)): void {
    this.selectedPaneKey = paneKey
    this.selectedTerminalId = terminalId
    this.selectedAt = Date.now()
    this.notify()
  }

  workspace(workspaceId: string | null): WorkspaceSummary | null {
    return this.bridge.workspaces.find((w) => w.id === workspaceId) ?? null
  }

  /** What a key shows for its workspace: the project alone; the dial names the branch. */
  projectLabel(workspaceId: string | null): string | null {
    const workspace = this.workspace(workspaceId)
    return workspace ? projectName(workspace) : null
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

export function projectName(workspace: WorkspaceSummary): string {
  return workspace.project ?? workspace.path.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace.name
}

/** "project · name", or just the name when it already names the project. */
export function workspaceLabel(workspace: WorkspaceSummary): string {
  const project = projectName(workspace)
  return project !== workspace.name ? `${project} · ${workspace.name}` : workspace.name
}

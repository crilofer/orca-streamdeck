// One key per workspace, chosen in the key's settings. It shows that workspace's agents one at a
// time: whoever answered last, or the one you tapped to. Tap opens the workspace in Orca; when
// Orca already shows it, tap steps to the next agent. Hold starts a new agent there. A key with
// no workspace starts agents in the workspace Orca is showing.
import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type JsonValue,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent
} from '@elgato/streamdeck'
import { workspaceLabel, type DeckState } from '../deck-state.ts'
import { emptyWorkspaceKeyImage, newAgentKeyImage, workspaceKeyImage } from '../key-image.ts'
import { nextAgent, shownAgent, type ShownOverride } from '../workspace-key-view.ts'
import type { RosterAgent } from '../../../src/bridge-protocol.ts'

const LONG_PRESS_MS = 600
const DEFAULT_AGENT = 'claude'

type AgentKeySettings = {
  pinnedWorkspaceId?: string
  launchAgent?: string
}

@action({ UUID: 'com.crilofer.orca.agent' })
export class AgentKey extends SingletonAction<AgentKeySettings> {
  private readonly settingsById = new Map<string, AgentKeySettings>()
  private readonly overrideById = new Map<string, ShownOverride>()
  private readonly pressedAt = new Map<string, number>()
  private unsubscribe: (() => void) | undefined

  constructor(private readonly state: DeckState) {
    super()
  }

  override async onWillAppear(ev: WillAppearEvent<AgentKeySettings>): Promise<void> {
    this.settingsById.set(ev.action.id, ev.payload.settings)
    this.unsubscribe ??= this.state.subscribe(() => this.renderAll())
    if (ev.action.isKey()) await this.render(ev.action)
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentKeySettings>): void {
    this.settingsById.delete(ev.action.id)
    this.overrideById.delete(ev.action.id)
    this.pressedAt.delete(ev.action.id)
    if (this.settingsById.size === 0) {
      this.unsubscribe?.()
      this.unsubscribe = undefined
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<AgentKeySettings>): Promise<void> {
    this.settingsById.set(ev.action.id, ev.payload.settings)
    this.overrideById.delete(ev.action.id)
    if (ev.action.isKey()) await this.render(ev.action)
  }

  override onKeyDown(ev: KeyDownEvent<AgentKeySettings>): void {
    this.pressedAt.set(ev.action.id, Date.now())
  }

  override async onKeyUp(ev: KeyUpEvent<AgentKeySettings>): Promise<void> {
    const held = Date.now() - (this.pressedAt.get(ev.action.id) ?? Date.now())
    this.pressedAt.delete(ev.action.id)
    const settings = this.settingsById.get(ev.action.id) ?? ev.payload.settings
    const workspaceId = settings.pinnedWorkspaceId || null
    try {
      if (held >= LONG_PRESS_MS) {
        await this.launch(ev.action, workspaceId, settings.launchAgent || DEFAULT_AGENT)
        return
      }
      if (workspaceId === null) return
      const agents = this.state.agentsIn(workspaceId)
      const shown = shownAgent(agents, this.override(ev.action.id, agents))
      if (shown && agents.length > 1 && this.state.focusedWorkspaceId === workspaceId) {
        const next = nextAgent(agents, shown)
        this.overrideById.set(ev.action.id, { paneKey: next.paneKey, terminalId: next.terminalId, at: Date.now() })
        this.state.select(next.paneKey)
        await this.state.focus(next)
        return
      }
      if (shown) {
        this.state.select(shown.paneKey)
        await this.state.focus(shown)
        return
      }
      await this.state.open(workspaceId)
    } catch (error) {
      streamDeck.logger.warn(`agent key: ${error instanceof Error ? error.message : String(error)}`)
      await ev.action.showAlert()
    }
  }

  /** Starts an agent in the key's workspace, or in the one Orca shows, and brings that workspace up. */
  private async launch(key: KeyAction<AgentKeySettings>, workspaceId: string | null, agent: string): Promise<void> {
    const target = workspaceId ?? this.state.focusedWorkspaceId
    if (target === null) throw new Error('no workspace: pick one in the key settings or focus one in Orca')
    if (this.state.focusedWorkspaceId !== target) await this.state.open(target)
    const result = await this.state.bridge.request({ type: 'launch', workspaceId: target, agent })
    const terminalId = (result as { terminalId?: unknown } | null)?.terminalId
    // Show the new agent on this key as soon as the bridge reports it, instead of whoever answered last.
    if (typeof terminalId === 'string') {
      this.overrideById.set(key.id, { paneKey: `terminal:${terminalId}`, terminalId, at: Date.now() })
      this.state.select(`terminal:${terminalId}`, terminalId)
      await this.render(key)
      // Orca opens plugin-launched tabs behind the current one; bring it up.
      await this.state.bridge.request({ type: 'focus', terminalId }).catch((error: unknown) => {
        streamDeck.logger.warn(`focus after launch: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    await key.showOk()
  }

  /** The property inspector's workspace picker asks for its items (sdpi-components datasource). */
  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, AgentKeySettings>): Promise<void> {
    const payload = ev.payload
    if (typeof payload !== 'object' || payload === null || (payload as { event?: unknown }).event !== 'getWorkspaces') return
    await this.sendWorkspaces('requested')
  }

  /** Also push them when the inspector opens: with `hot-reload` the picker takes them whenever they arrive. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await this.sendWorkspaces('inspector opened')
  }

  private async sendWorkspaces(reason: string): Promise<void> {
    const inspector = streamDeck.ui.current
    const items = this.state.bridge.workspaces.map((w) => ({ label: workspaceLabel(w), value: w.id }))
    streamDeck.logger.info(`workspaces for the inspector (${reason}): ${items.length} item(s), inspector ${inspector ? 'present' : 'absent'}`)
    if (!inspector) return
    await inspector.sendToPropertyInspector({ event: 'getWorkspaces', items })
  }

  private renderAll(): void {
    for (const instance of this.actions) if (instance.isKey()) void this.render(instance)
  }

  private async render(key: KeyAction<AgentKeySettings>): Promise<void> {
    const workspaceId = this.settingsById.get(key.id)?.pinnedWorkspaceId || null
    if (workspaceId === null) {
      await key.setImage(newAgentKeyImage(this.state.projectLabel(this.state.focusedWorkspaceId), this.state.connected))
      return
    }
    const label = this.state.projectLabel(workspaceId) ?? 'not in Orca'
    const agents = this.state.agentsIn(workspaceId)
    const shown = shownAgent(agents, this.override(key.id, agents))
    if (!shown) {
      await key.setImage(emptyWorkspaceKeyImage(label, this.state.connected))
      return
    }
    await key.setImage(workspaceKeyImage({ agent: shown, agents, workspace: label, selected: this.state.isSelected(shown) }))
  }

  /** The key's own pick, or the dial's when it landed on one of this workspace's agents later. */
  private override(keyId: string, agents: RosterAgent[]): ShownOverride | null {
    const own = this.overrideById.get(keyId) ?? null
    const selection = this.state.selection()
    if (!selection || !agents.some((agent) => agent.paneKey === selection.paneKey)) return own
    return own && own.at > selection.at ? own : selection
  }
}

// One key that answers "does anything need me?". Tap jumps to the most urgent agent. Its settings
// choose what it counts: every agent, or leaving bots' chats in or out.
import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent
} from '@elgato/streamdeck'
import type { AttentionScope } from '../bot-view.ts'
import type { DeckState } from '../deck-state.ts'
import { attentionKeyImage } from '../key-image.ts'

type AttentionKeySettings = { count?: string }

const NOUN: Record<AttentionScope, string> = { all: 'agent', agents: 'agent', bots: 'bot chat' }

@action({ UUID: 'com.crilofer.orca.attention' })
export class AttentionKey extends SingletonAction<AttentionKeySettings> {
  private readonly scopeById = new Map<string, AttentionScope>()
  private unsubscribe: (() => void) | undefined

  constructor(private readonly state: DeckState) {
    super()
  }

  override async onWillAppear(ev: WillAppearEvent<AttentionKeySettings>): Promise<void> {
    this.scopeById.set(ev.action.id, scopeOf(ev.payload.settings))
    this.unsubscribe ??= this.state.subscribe(() => this.renderAll())
    if (ev.action.isKey()) await this.render(ev.action)
  }

  override onWillDisappear(ev: WillDisappearEvent<AttentionKeySettings>): void {
    this.scopeById.delete(ev.action.id)
    if (this.scopeById.size === 0) {
      this.unsubscribe?.()
      this.unsubscribe = undefined
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<AttentionKeySettings>): Promise<void> {
    this.scopeById.set(ev.action.id, scopeOf(ev.payload.settings))
    if (ev.action.isKey()) await this.render(ev.action)
  }

  override async onKeyUp(ev: KeyUpEvent<AttentionKeySettings>): Promise<void> {
    const target = this.state.agentsInScope(this.scopeById.get(ev.action.id) ?? scopeOf(ev.payload.settings))[0]
    if (!target) return
    try {
      this.state.select(target.paneKey)
      await this.state.focus(target)
    } catch (error) {
      streamDeck.logger.warn(`attention key: ${error instanceof Error ? error.message : String(error)}`)
      await ev.action.showAlert()
    }
  }

  private renderAll(): void {
    for (const instance of this.actions) if (instance.isKey()) void this.render(instance)
  }

  private async render(key: KeyAction<AttentionKeySettings>): Promise<void> {
    const scope = this.scopeById.get(key.id) ?? 'all'
    await key.setImage(attentionKeyImage(this.state.agentsInScope(scope), this.state.connected, NOUN[scope]))
  }
}

function scopeOf(settings: AttentionKeySettings): AttentionScope {
  return settings.count === 'agents' || settings.count === 'bots' ? settings.count : 'all'
}

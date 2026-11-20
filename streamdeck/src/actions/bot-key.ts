// One key per bot, chosen in the key's settings. It shows the bot's picture and what its most
// pressing chat is doing. Tap opens the bot in Orca, on whichever chat Orca last showed there: a
// chat has no terminal, and Orca lets a plugin go to nothing else inside a workspace.
import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type JsonValue,
  type KeyAction,
  type KeyUpEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent
} from '@elgato/streamdeck'
import { botAvatar } from '../bot-avatar.ts'
import type { DeckState } from '../deck-state.ts'
import { botKeyImage, emptyBotKeyImage } from '../key-image.ts'

type BotKeySettings = {
  /** The bot's workspace in Orca. */
  botWorkspaceId?: string
}

@action({ UUID: 'com.crilofer.orca.bot' })
export class BotKey extends SingletonAction<BotKeySettings> {
  private readonly settingsById = new Map<string, BotKeySettings>()
  private unsubscribe: (() => void) | undefined

  constructor(private readonly state: DeckState) {
    super()
  }

  override async onWillAppear(ev: WillAppearEvent<BotKeySettings>): Promise<void> {
    this.settingsById.set(ev.action.id, ev.payload.settings)
    this.unsubscribe ??= this.state.subscribe(() => this.renderAll())
    if (ev.action.isKey()) await this.render(ev.action)
  }

  override onWillDisappear(ev: WillDisappearEvent<BotKeySettings>): void {
    this.settingsById.delete(ev.action.id)
    if (this.settingsById.size === 0) {
      this.unsubscribe?.()
      this.unsubscribe = undefined
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BotKeySettings>): Promise<void> {
    this.settingsById.set(ev.action.id, ev.payload.settings)
    if (ev.action.isKey()) await this.render(ev.action)
  }

  override async onKeyUp(ev: KeyUpEvent<BotKeySettings>): Promise<void> {
    const workspaceId = (this.settingsById.get(ev.action.id) ?? ev.payload.settings).botWorkspaceId
    if (!workspaceId) return
    try {
      await this.state.open(workspaceId)
    } catch (error) {
      streamDeck.logger.warn(`bot key: ${error instanceof Error ? error.message : String(error)}`)
      await ev.action.showAlert()
    }
  }

  /** The property inspector's bot picker asks for its items (sdpi-components datasource). */
  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, BotKeySettings>): Promise<void> {
    const payload = ev.payload
    if (typeof payload !== 'object' || payload === null || (payload as { event?: unknown }).event !== 'getBots') return
    await this.sendBots()
  }

  /** Also push them when the inspector opens: with `hot-reload` the picker takes them whenever they arrive. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await this.sendBots()
  }

  private async sendBots(): Promise<void> {
    const items = this.state.bots().map((bot) => ({ label: bot.workspace.name, value: bot.workspace.id }))
    await streamDeck.ui.current?.sendToPropertyInspector({ event: 'getBots', items })
  }

  private renderAll(): void {
    for (const instance of this.actions) if (instance.isKey()) void this.render(instance)
  }

  private async render(key: KeyAction<BotKeySettings>): Promise<void> {
    const workspaceId = this.settingsById.get(key.id)?.botWorkspaceId
    if (!workspaceId) {
      await key.setImage(emptyBotKeyImage('pick a bot', 'in key settings', this.state.connected))
      return
    }
    const bot = this.state.bots().find((candidate) => candidate.workspace.id === workspaceId)
    if (!bot) {
      await key.setImage(emptyBotKeyImage('bot', 'not in Orca', this.state.connected))
      return
    }
    await key.setImage(botKeyImage({ name: bot.workspace.name, avatar: botAvatar(bot.workspace.path), chats: bot.chats }))
  }
}

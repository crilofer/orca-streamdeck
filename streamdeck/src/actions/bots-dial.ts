// Stream Deck + dial: rotate through the bots, by name, each with what it is doing; push or tap to
// open the one shown. Left alone, it shows the bot that most needs a person.
import streamDeck, {
  action,
  SingletonAction,
  type DialAction,
  type DialDownEvent,
  type DialRotateEvent,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent
} from '@elgato/streamdeck'
import { botAvatar } from '../bot-avatar.ts'
import { shownBot, type BotPick, type BotView } from '../bot-view.ts'
import type { DeckState } from '../deck-state.ts'
import { botStripImage, stripMessageImage } from '../strip-image.ts'

@action({ UUID: 'com.crilofer.orca.bots' })
export class BotsDial extends SingletonAction {
  private unsubscribe: (() => void) | undefined
  private visible = 0
  private pick: BotPick | null = null

  constructor(private readonly state: DeckState) {
    super()
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visible++
    if (ev.action.isDial()) await ev.action.setFeedbackLayout('layouts/strip.json')
    this.unsubscribe ??= this.state.subscribe(() => this.renderAll())
    this.renderAll()
  }

  override onWillDisappear(_ev: WillDisappearEvent): void {
    this.visible = Math.max(0, this.visible - 1)
    if (this.visible === 0) {
      this.unsubscribe?.()
      this.unsubscribe = undefined
    }
  }

  override onDialRotate(ev: DialRotateEvent): void {
    const bots = this.state.bots()
    const current = shownBot(bots, this.pick)
    if (!current) return
    const step = ev.payload.ticks > 0 ? 1 : -1
    const next = bots[(bots.indexOf(current) + step + bots.length) % bots.length]!
    this.pick = { workspaceId: next.workspace.id, at: Date.now() }
    this.renderAll()
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    await this.open(ev.action)
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    await this.open(ev.action)
  }

  private async open(dial: DialAction): Promise<void> {
    const target = shownBot(this.state.bots(), this.pick)
    if (!target) return
    try {
      await this.state.open(target.workspace.id)
    } catch (error) {
      streamDeck.logger.warn(`bots dial: ${error instanceof Error ? error.message : String(error)}`)
      await dial.showAlert()
    }
  }

  private renderAll(): void {
    const bots = this.state.bots()
    const canvas = this.canvas(bots, shownBot(bots, this.pick))
    for (const instance of this.actions) if (instance.isDial()) void instance.setFeedback({ canvas })
  }

  private canvas(bots: BotView[], shown: BotView | null): string {
    if (!this.state.connected || !shown) return stripMessageImage(this.state.connected ? 'no bots' : 'bridge offline')
    return botStripImage({
      name: shown.workspace.name,
      avatar: botAvatar(shown.workspace.path),
      lead: shown.lead,
      index: bots.indexOf(shown),
      total: bots.length
    })
  }
}

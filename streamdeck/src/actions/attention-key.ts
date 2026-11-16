// One key that answers "does anything need me?". Tap jumps to the most urgent agent.
import streamDeck, { action, SingletonAction, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck'
import type { DeckState } from '../deck-state.ts'
import { attentionKeyImage } from '../key-image.ts'

@action({ UUID: 'com.crilofer.orca.attention' })
export class AttentionKey extends SingletonAction {
  private unsubscribe: (() => void) | undefined
  private visible = 0

  constructor(private readonly state: DeckState) {
    super()
  }

  override onWillAppear(_ev: WillAppearEvent): void {
    this.visible++
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

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const target = this.state.agents()[0]
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
    const image = attentionKeyImage(this.state.agents(), this.state.connected)
    for (const instance of this.actions) if (instance.isKey()) void instance.setImage(image)
  }
}

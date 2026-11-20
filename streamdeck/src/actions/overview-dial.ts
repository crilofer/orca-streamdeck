// Stream Deck + dial: rotate to select a coding agent (most urgent first), push or tap to open it.
// Bots' chats are left to the Bots dial.
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
import { projectName, type DeckState } from '../deck-state.ts'
import { agentStripImage, stripMessageImage } from '../strip-image.ts'

@action({ UUID: 'com.crilofer.orca.overview' })
export class OverviewDial extends SingletonAction {
  private unsubscribe: (() => void) | undefined
  private visible = 0

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
    const agents = this.state.codingAgents()
    if (agents.length === 0) return
    const current = this.state.selected()
    const index = current ? agents.findIndex((agent) => agent.paneKey === current.paneKey) : -1
    const step = ev.payload.ticks > 0 ? 1 : -1
    const next = (index + step + agents.length) % agents.length
    this.state.select(agents[next].paneKey)
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    await this.open(ev.action)
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    await this.open(ev.action)
  }

  private async open(dial: DialAction): Promise<void> {
    const target = this.state.selected()
    if (!target) return
    try {
      await this.state.focus(target)
    } catch (error) {
      streamDeck.logger.warn(`overview dial: ${error instanceof Error ? error.message : String(error)}`)
      await dial.showAlert()
    }
  }

  private renderAll(): void {
    for (const instance of this.actions) if (instance.isDial()) void this.render(instance)
  }

  private async render(dial: DialAction): Promise<void> {
    const selected = this.state.selected()
    if (!this.state.connected || !selected) {
      await dial.setFeedback({ canvas: stripMessageImage(this.state.connected ? 'no agents' : 'bridge offline') })
      return
    }
    // Keys name only the project, so the strip is where the branch or worktree shows.
    const workspace = this.state.workspace(selected.workspaceId)
    await dial.setFeedback({
      canvas: agentStripImage({
        agent: selected,
        project: workspace ? projectName(workspace) : (selected.title ?? 'agent'),
        branch: workspace?.name ?? ''
      })
    })
  }
}

import streamDeck, { LogLevel } from '@elgato/streamdeck'
import { AgentKey } from './actions/agent-key.ts'
import { AttentionKey } from './actions/attention-key.ts'
import { OverviewDial } from './actions/overview-dial.ts'
import { BridgeClient } from './bridge-client.ts'
import { DeckState } from './deck-state.ts'
import { raiseOrcaWindow } from './orca-window.ts'

streamDeck.logger.setLevel(LogLevel.INFO)

const bridge = new BridgeClient((message) => streamDeck.logger.info(message))
const state = new DeckState(bridge, () => raiseOrcaWindow((message) => streamDeck.logger.warn(message)))

streamDeck.actions.registerAction(new AgentKey(state))
streamDeck.actions.registerAction(new AttentionKey(state))
streamDeck.actions.registerAction(new OverviewDial(state))

await streamDeck.connect()
bridge.start()

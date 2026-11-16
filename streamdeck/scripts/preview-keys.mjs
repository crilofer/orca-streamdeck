// Renders sample key images to dist/preview/*.png with resvg, to eyeball layout without a deck.
// resvg is not Qt: it proves the markup, not Qt's exact text metrics.
import { mkdirSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { agentStripImage, stripMessageImage } from '../src/strip-image.ts'
import { attentionKeyImage, emptyWorkspaceKeyImage, newAgentKeyImage, offlineKeyImage, workspaceKeyImage } from '../src/key-image.ts'

const agent = (paneKey, kind, state, since) => ({ paneKey, workspaceId: 'w', terminalId: null, title: null, agent: kind, state, outcome: null, since })
const agents = [agent('a', 'claude', 'blocked', 1), agent('b', 'codex', 'working', 2), agent('c', 'gemini', 'done', 3)]

const samples = {
  'key-claude-blocked': workspaceKeyImage({ agent: agents[0], agents, workspace: 'web', selected: false }),
  'key-codex-working-selected': workspaceKeyImage({ agent: agents[1], agents, workspace: 'api', selected: true }),
  'key-gemini-done-single': workspaceKeyImage({ agent: agents[2], agents: [agents[2]], workspace: 'docs', selected: false }),
  'key-unknown-agent': workspaceKeyImage({ agent: agent('d', null, 'waiting', 4), agents: [agent('d', null, 'waiting', 4)], workspace: 'design-system', selected: true }),
  'key-cursor': workspaceKeyImage({ agent: agent('e', 'cursor', 'working', 5), agents: [agent('e', 'cursor', 'working', 5)], workspace: 'payments-service', selected: false }),
  'key-empty-workspace': emptyWorkspaceKeyImage('web', true),
  'key-new-agent': newAgentKeyImage('web', true),
  'key-new-agent-no-focus': newAgentKeyImage(null, true),
  'key-attention': attentionKeyImage(agents, true),
  'key-offline': offlineKeyImage(),
  'strip-long-branch': agentStripImage({ agent: agents[2], project: 'web', branch: 'feature/checkout-flow-with-saved-cards' }),
  'strip-short-branch': agentStripImage({ agent: agents[0], project: 'payments-service', branch: 'main' }),
  'strip-mid-branch': agentStripImage({ agent: agents[1], project: 'design-system', branch: 'fix/login-redirect' }),
  'strip-no-agents': stripMessageImage('no agents')
}

mkdirSync(new URL('../dist/preview/', import.meta.url), { recursive: true })
for (const [name, dataUri] of Object.entries(samples)) {
  const svg = decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml;charset=utf8,/, ''))
  const png = new Resvg(svg, { fitTo: { mode: 'zoom', value: 3 } }).render().asPng()
  writeFileSync(new URL(`../dist/preview/${name}.png`, import.meta.url), png)
}
console.log(`${Object.keys(samples).length} previews in streamdeck/dist/preview/`)

// Renders the images Orca's plugin page shows (../images/): the icon the Stream Deck plugin
// already uses, and a screenshot drawn from the real key and strip renderers (the cover is a hand-made image).
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { attentionKeyImage, emptyWorkspaceKeyImage, newAgentKeyImage, workspaceKeyImage } from '../src/key-image.ts'
import { agentStripImage } from '../src/strip-image.ts'
import { FONT } from '../src/svg-markup.ts'

const out = new URL('../../images/', import.meta.url)
mkdirSync(out, { recursive: true })

const icon = readFileSync(new URL('../com.crilofer.orca.sdPlugin/imgs/plugin/icon.svg', import.meta.url))
writeFileSync(new URL('icon.png', out), new Resvg(icon, { fitTo: { mode: 'width', value: 512 } }).render().asPng())

const agent = (paneKey, kind, state) => ({ paneKey, workspaceId: 'w', terminalId: null, title: null, agent: kind, state, outcome: null, since: 1 })
const web = [agent('a', 'claude', 'blocked'), agent('b', 'codex', 'working'), agent('c', 'claude', 'done')]
const mobile = [agent('d', 'cursor', 'working'), agent('e', 'claude', 'done')]
const all = [...web, ...mobile, agent('f', 'codex', 'working'), agent('g', 'gemini', 'done'), agent('h', 'claude', 'waiting')]
const one = (kind, state) => [agent('x', kind, state)]

const keys = [
  workspaceKeyImage({ agent: web[0], agents: web, workspace: 'web', selected: true }),
  workspaceKeyImage({ agent: one('codex', 'working')[0], agents: one('codex', 'working'), workspace: 'api', selected: false }),
  workspaceKeyImage({ agent: one('gemini', 'done')[0], agents: one('gemini', 'done'), workspace: 'design-system', selected: false }),
  workspaceKeyImage({ agent: one('claude', 'waiting')[0], agents: one('claude', 'waiting'), workspace: 'docs', selected: false }),
  workspaceKeyImage({ agent: mobile[0], agents: mobile, workspace: 'mobile-app', selected: false }),
  emptyWorkspaceKeyImage('billing', true),
  attentionKeyImage(all, true),
  newAgentKeyImage('web', true)
]
const strip = agentStripImage({ agent: web[0], project: 'web', branch: 'feature/checkout-flow' })

/** The drawing inside one of our SVG data URIs, placed and scaled into the cover. */
const place = (dataUri, x, y, scale) => {
  const svg = decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml;charset=utf8,/, ''))
  const body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return `<g transform="translate(${x} ${y}) scale(${scale})">${body}</g>`
}

const KEY = 180
const GAP = 40
const LEFT = 380
const keyMarkup = keys.map((key, index) => place(key, LEFT + (index % 4) * (KEY + GAP), 300 + Math.floor(index / 4) * (KEY + GAP), KEY / 72)).join('')
const segment = (KEY * 4 + GAP * 3) / 4
const dials = [0, 1, 2, 3]
  .map((index) => {
    const cx = LEFT + segment * index + segment / 2
    return `<circle cx="${cx}" cy="905" r="34" fill="#27272a" stroke="#3f3f46" stroke-width="3"/><circle cx="${cx}" cy="905" r="20" fill="#18181b"/>`
  })
  .join('')

const cover = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1c21"/><stop offset="1" stop-color="#09090b"/></linearGradient>
    <clipPath id="strip"><rect x="${LEFT}" y="740" width="${segment * 4}" height="105" rx="14"/></clipPath>
  </defs>
  <rect width="1600" height="1000" fill="url(#bg)"/>
  <text x="800" y="120" font-family="${FONT}" font-size="64" font-weight="700" fill="#fafafa" text-anchor="middle">Stream Deck Bridge</text>
  <text x="800" y="178" font-family="${FONT}" font-size="28" font-weight="500" fill="#a1a1aa" text-anchor="middle">Your Orca agents on your Stream Deck: one key per workspace</text>
  <rect x="320" y="240" width="960" height="730" rx="44" fill="#111113" stroke="#2e2e33" stroke-width="3"/>
  ${keyMarkup}
  <g clip-path="url(#strip)">
    <rect x="${LEFT}" y="740" width="${segment * 4}" height="105" fill="#18181b"/>
    ${place(strip, LEFT, 740, segment / 200)}
  </g>
  ${dials}
</svg>`
writeFileSync(new URL('keys.png', out), new Resvg(cover, { fitTo: { mode: 'width', value: 1600 } }).render().asPng())
console.log('wrote images/icon.png (512) and images/keys.png (1600x1000)')

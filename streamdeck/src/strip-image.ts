// The Stream Deck + touch strip segment above a dial, drawn whole (200x100) so the branch gets
// the width the built-in layouts give to an icon.
import type { RosterAgent } from '../../src/bridge-protocol.ts'
import { agentLogo } from './agent-logos.ts'
import { botMark } from './bot-mark.ts'
import { STATE_COLOR, STATE_LABEL, truncate } from './key-image.ts'
import { svgDataUri, text } from './svg-markup.ts'

const BG = '#18181b'
const FG = '#fafafa'
const MUTED = '#a1a1aa'
const WIDTH = 200
const HEIGHT = 100
const BRANCH_LINE = 28
const DIM = '#3f3f46'

export function agentStripImage(input: { agent: RosterAgent; project: string; branch: string }): string {
  const { agent, project, branch } = input
  const color = STATE_COLOR[agent.state]
  const lines = wrapBranch(branch)
  const branchY = lines.length > 1 ? 68 : 76
  return strip(`
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="${color}"/>
  ${agentLogo(agent.agent, 10, 16, 30)}
  ${text(50, 29, truncate(project, 16), 15, FG, 700, 'start')}
  ${text(50, 45, STATE_LABEL[agent.state], 12, color, 500, 'start')}
  ${lines.map((line, index) => text(10, branchY + index * 17, line, 13, index === 0 ? FG : MUTED, 500, 'start')).join('')}`)
}

/**
 * One bot on the strip, with where it stands among the `total` bots. It shows one state, that of
 * `lead`, its most pressing chat, and no count of chats: Orca reports only some of a bot's chats.
 */
export function botStripImage(input: { name: string; avatar: string | null; lead: RosterAgent | null; index: number; total: number }): string {
  const { name, avatar, lead, index, total } = input
  const color = lead ? STATE_COLOR[lead.state] : DIM
  return strip(`
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="${color}"/>
  ${botMark(name, avatar, 10, 16, 34)}
  ${text(54, 31, truncate(name, 16), 15, FG, 700, 'start')}
  ${text(54, 47, lead ? STATE_LABEL[lead.state] : 'idle', 12, lead ? color : MUTED, 500, 'start')}
  ${total > 1 ? text(10, 78, `bot ${index + 1} of ${total}`, 13, MUTED, 500, 'start') : ''}`)
}

export function stripMessageImage(message: string): string {
  return strip(`${text(WIDTH / 2, 46, 'Orca', 16, FG, 700)}${text(WIDTH / 2, 66, message, 13, MUTED)}`)
}

/** Up to two lines, broken after a `/`, `-` or `_` where one falls in reach. */
export function wrapBranch(branch: string): string[] {
  if (branch.length <= BRANCH_LINE) return branch ? [branch] : []
  const head = branch.slice(0, BRANCH_LINE)
  const breakAt = Math.max(head.lastIndexOf('/'), head.lastIndexOf('-'), head.lastIndexOf('_')) + 1
  const cut = breakAt >= BRANCH_LINE / 2 ? breakAt : BRANCH_LINE
  return [branch.slice(0, cut), truncate(branch.slice(cut), BRANCH_LINE)]
}

function strip(body: string): string {
  return svgDataUri(WIDTH, HEIGHT, `<rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>${body}`)
}

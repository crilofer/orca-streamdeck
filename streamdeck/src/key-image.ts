// Keys get their picture from an SVG data URI at runtime, so one plugin asset serves every state.
// Stream Deck renders SVG with Qt: rect, circle, path, text and inline images; no nested <svg>.
import type { AgentState, RosterAgent } from '../../src/bridge-protocol.ts'
import { agentLogo } from './agent-logos.ts'
import { svgDataUri, text } from './svg-markup.ts'

export const STATE_COLOR: Record<AgentState, string> = {
  blocked: '#ef4444',
  waiting: '#f59e0b',
  working: '#3b82f6',
  done: '#22c55e'
}

export const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'needs you',
  waiting: 'waiting',
  working: 'working',
  done: 'done'
}

const BG = '#18181b'
const FG = '#fafafa'
const MUTED = '#a1a1aa'
const DIM = '#3f3f46'
const MAX_DOTS = 8

/** A workspace key with agents: the shown agent's mark and state, one dot per agent below. */
export function workspaceKeyImage(input: {
  agent: RosterAgent
  agents: RosterAgent[]
  workspace: string
  selected: boolean
}): string {
  const { agent, agents, workspace, selected } = input
  const color = STATE_COLOR[agent.state]
  // Selected: the state bar grows into a frame of the same colour, so the two never clash.
  const frame = selected
    ? `<rect width="72" height="72" rx="12" fill="${color}"/><rect x="3" y="8" width="66" height="61" rx="8" fill="${BG}"/>`
    : `<rect x="0" y="0" width="72" height="7" rx="3.5" fill="${color}"/>`
  return key(`
  ${frame}
  ${agentLogo(agent.agent, 23, 11, 26)}
  ${fittedText(36, 49, workspace)}
  ${text(36, 59, STATE_LABEL[agent.state], 9, color)}
  ${agents.length > 1 ? agentDots(agents, agent.paneKey, 65) : ''}`)
}

/** A workspace key whose workspace has no agent right now. */
export function emptyWorkspaceKeyImage(workspace: string, connected: boolean): string {
  if (!connected) return offlineKeyImage()
  return key(`
  ${dashedFrame()}
  ${fittedText(36, 30, workspace)}
  ${text(36, 44, 'no agents', 9, MUTED)}
  ${text(36, 58, 'hold: new agent', 8, MUTED)}`)
}

/** A key with no workspace: it starts agents in the workspace Orca shows. */
export function newAgentKeyImage(focusedWorkspace: string | null, connected: boolean): string {
  if (!connected) return offlineKeyImage()
  return key(`
  ${dashedFrame()}
  ${text(36, 36, '+', 28, MUTED, 300)}
  ${text(36, 50, focusedWorkspace ? truncate(focusedWorkspace, 13) : 'pick a workspace', 8, MUTED)}
  ${text(36, 60, focusedWorkspace ? 'hold: new agent' : 'in key settings', 8, MUTED)}`)
}

export function attentionKeyImage(agents: RosterAgent[], connected: boolean): string {
  if (!connected) return offlineKeyImage()
  const blocked = agents.filter((a) => a.state === 'blocked').length
  const waiting = agents.filter((a) => a.state === 'waiting').length
  const working = agents.filter((a) => a.state === 'working').length
  const need = blocked + waiting
  const color = blocked > 0 ? STATE_COLOR.blocked : waiting > 0 ? STATE_COLOR.waiting : working > 0 ? STATE_COLOR.working : agents.length > 0 ? STATE_COLOR.done : DIM
  const caption = need > 0 ? (need === 1 ? 'needs you' : 'need you') : working > 0 ? 'working' : agents.length > 0 ? 'all done' : 'no agents'
  const big = need > 0 ? String(need) : working > 0 ? String(working) : agents.length > 0 ? String(agents.length) : '0'
  return key(`
  <circle cx="36" cy="27" r="14" fill="${color}"/>
  ${text(36, 32, big, 16, BG, 800)}
  ${text(36, 58, caption, 11, FG)}
  ${text(36, 68, `${agents.length} agents`, 8, MUTED)}`)
}

export function offlineKeyImage(): string {
  return key(`
  <circle cx="36" cy="30" r="12" fill="none" stroke="${DIM}" stroke-width="3"/>
  <rect x="34" y="18" width="4" height="12" fill="${BG}"/>
  <rect x="34" y="14" width="4" height="12" rx="2" fill="${DIM}"/>
  ${text(36, 60, 'Orca offline', 9, MUTED)}`)
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1))}…`
}

/** A project name at the largest size that fits the key's width; only very long ones are cut. */
function fittedText(x: number, y: number, value: string): string {
  const size = value.length <= 12 ? 10 : value.length <= 14 ? 9 : 8
  return text(x, y, truncate(value, 16), size, FG)
}

function agentDots(agents: RosterAgent[], shownPaneKey: string, y: number): string {
  const shown = agents.slice(0, MAX_DOTS)
  const spacing = 8
  const start = 36 - ((shown.length - 1) * spacing) / 2
  return shown
    .map((agent, index) => {
      const x = start + index * spacing
      const isShown = agent.paneKey === shownPaneKey
      const outline = isShown ? ` stroke="${FG}" stroke-width="1"` : ''
      return `<circle cx="${x}" cy="${y}" r="${isShown ? 3 : 2.2}" fill="${STATE_COLOR[agent.state]}"${outline}/>`
    })
    .join('')
}

function dashedFrame(): string {
  return `<rect x="8" y="8" width="56" height="56" rx="10" fill="none" stroke="${DIM}" stroke-width="2" stroke-dasharray="4 3"/>`
}

function key(body: string): string {
  return svgDataUri(72, 72, `<rect width="72" height="72" rx="12" fill="${BG}"/>${body}`)
}

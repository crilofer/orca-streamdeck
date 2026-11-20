// Newline-delimited JSON over TCP on 127.0.0.1. One message per line, both directions.
// The Stream Deck plugin speaks the same types; keep this file copyable as-is.

/**
 * 6: a workspace says whether it is a bot's home (`bot`).
 * 5: `hello` no longer carries `features`: every Orca this runs on can focus a terminal.
 * 4: a client's first line is `auth` with the token from the rendezvous file; `send` is gone.
 * 3: `hello` carries `features` and `focus` requests exist. 2: `snapshot` carries `focusedWorkspaceId`.
 */
export const BRIDGE_PROTOCOL = 6

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'

export type RosterAgent = {
  paneKey: string
  workspaceId: string | null
  terminalId: string | null
  title: string | null
  /** Agent kind such as `claude` or `codex`; known once Orca lists the agent's workspace. */
  agent: string | null
  state: AgentState
  outcome: string | null
  /** When the agent entered its current state, ms since epoch. */
  since: number
}

/** Lower sorts first: whoever needs a person comes before who is busy or finished. */
const ATTENTION_RANK: Record<AgentState, number> = { blocked: 0, waiting: 1, working: 2, done: 3 }

export function needsAttention(state: AgentState): boolean {
  return state === 'blocked' || state === 'waiting'
}

export function byAttention(a: RosterAgent, b: RosterAgent): number {
  return ATTENTION_RANK[a.state] - ATTENTION_RANK[b.state] || b.since - a.since
}

export type WorkspaceSummary = {
  id: string
  name: string
  /** The project (repository) the workspace belongs to, when Orca knows it. */
  project: string | null
  path: string
  branch: string | null
  kind: 'worktree' | 'folder'
  /** A bot's home on this computer; its chats are the agents of this workspace. */
  bot: boolean
}

export type ServerMessage =
  | { type: 'hello'; protocol: typeof BRIDGE_PROTOCOL; plugin: { id: string; version: string } }
  | {
      type: 'snapshot'
      agents: RosterAgent[]
      workspaces: WorkspaceSummary[]
      /** The workspace Orca's window shows, as `workspaces[].id` names it; null when unknown. */
      focusedWorkspaceId: string | null
    }
  | { type: 'agent'; agent: RosterAgent }
  | { type: 'agent.removed'; paneKey: string }
  | { type: 'result'; id: string; ok: true; result?: unknown }
  | { type: 'result'; id: string; ok: false; error: { code: string; message: string } }

/** A client's first line. Anything else, or a wrong token, closes the connection unanswered. */
export type AuthMessage = { type: 'auth'; token: string }

export function isAuthMessage(value: unknown): value is AuthMessage {
  const message = value as Partial<AuthMessage> | null
  return typeof message === 'object' && message !== null && message.type === 'auth' && typeof message.token === 'string'
}

export type ClientMessage =
  | { type: 'snapshot'; id?: string }
  | { type: 'open'; id?: string; workspaceId: string }
  | { type: 'launch'; id?: string; workspaceId: string; agent: string; prompt?: string }
  | { type: 'focus'; id?: string; terminalId: string }

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  if (message.id !== undefined && typeof message.id !== 'string') return false
  switch (message.type) {
    case 'snapshot':
      return true
    case 'open':
      return typeof message.workspaceId === 'string'
    case 'launch':
      return (
        typeof message.workspaceId === 'string' &&
        typeof message.agent === 'string' &&
        (message.prompt === undefined || typeof message.prompt === 'string')
      )
    case 'focus':
      return typeof message.terminalId === 'string'
    default:
      return false
  }
}

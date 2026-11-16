// Talks to the Stream Deck Bridge Orca plugin: newline-delimited JSON over TCP on loopback.
import { connect, type Socket } from 'node:net'
import {
  BRIDGE_PROTOCOL,
  byAttention,
  type ClientMessage,
  type RosterAgent,
  type ServerMessage,
  type WorkspaceSummary
} from '../../src/bridge-protocol.ts'
import { readRendezvous, type BridgeRendezvous } from '../../src/bridge-rendezvous.ts'

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected'
/** `Omit` over each member of a union, so a request keeps its own fields. */
type WithoutId<T> = T extends { id?: string } ? Omit<T, 'id'> : never
export type BridgeRequest = WithoutId<ClientMessage>
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

const RETRY_MIN_MS = 1000
const RETRY_MAX_MS = 10000
const REQUEST_TIMEOUT_MS = 10000

export class BridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export class BridgeClient {
  status: BridgeStatus = 'disconnected'
  workspaces: WorkspaceSummary[] = []
  /** The workspace Orca's window shows, by its listed id; null until the bridge says. */
  focusedWorkspaceId: string | null = null
  private readonly agentsByPane = new Map<string, RosterAgent>()
  private socket: Socket | null = null
  private buffered = ''
  private retryMs = RETRY_MIN_MS
  private retryTimer: NodeJS.Timeout | null = null
  private stopped = true
  private nextId = 1
  private readonly pending = new Map<string, Pending>()
  private readonly listeners = new Set<() => void>()

  /** `rendezvous` says where the bridge listens and the token it expects; read anew on every attempt. */
  constructor(
    private readonly log: (message: string) => void,
    private readonly rendezvous: () => BridgeRendezvous | null = readRendezvous
  ) {}

  start(): void {
    this.stopped = false
    this.open()
  }

  stop(): void {
    this.stopped = true
    this.clearRetry()
    this.socket?.destroy()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Attention first: blocked, waiting, working, done; newest first within a state. */
  agents(): RosterAgent[] {
    return [...this.agentsByPane.values()].sort(byAttention)
  }

  agent(paneKey: string): RosterAgent | undefined {
    return this.agentsByPane.get(paneKey)
  }

  /** Orca just opened this workspace at our request; its own notice follows a moment later. */
  markFocused(workspaceId: string): void {
    if (this.focusedWorkspaceId === workspaceId) return
    this.focusedWorkspaceId = workspaceId
    this.notify()
  }

  request(message: BridgeRequest): Promise<unknown> {
    if (!this.socket || this.status !== 'connected') {
      return Promise.reject(new BridgeError('unavailable', 'the Orca bridge is not connected'))
    }
    const id = String(this.nextId++)
    const socket = this.socket
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BridgeError('timeout', 'Orca did not answer in time'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      socket.write(`${JSON.stringify({ ...message, id })}\n`)
    })
  }

  private open(): void {
    // The bridge writes the file when it starts listening: none means Orca or the plugin is not running.
    const rendezvous = this.rendezvous()
    if (!rendezvous) {
      this.scheduleRetry()
      return
    }
    this.status = 'connecting'
    this.notify()
    const socket = connect({ host: '127.0.0.1', port: rendezvous.port })
    this.socket = socket
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    // Connected only once the bridge greets us: it closes on a stale token without a word.
    socket.on('connect', () => socket.write(`${JSON.stringify({ type: 'auth', token: rendezvous.token })}\n`))
    socket.on('data', (chunk: string) => this.receive(chunk))
    socket.on('error', (error) => {
      if (this.status === 'connected') this.log(`bridge connection error: ${error.message}`)
    })
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      this.buffered = ''
      const wasConnected = this.status === 'connected'
      this.status = 'disconnected'
      this.focusedWorkspaceId = null
      for (const [id, pending] of this.pending) {
        this.pending.delete(id)
        pending.reject(new BridgeError('unavailable', 'the Orca bridge disconnected'))
      }
      if (wasConnected) this.log('disconnected from the Orca bridge')
      this.notify()
      this.scheduleRetry()
    })
  }

  private receive(chunk: string): void {
    this.buffered += chunk
    let newline = this.buffered.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffered.slice(0, newline).trim()
      this.buffered = this.buffered.slice(newline + 1)
      if (line) this.handle(line)
      newline = this.buffered.indexOf('\n')
    }
  }

  private handle(line: string): void {
    let message: ServerMessage
    try {
      message = JSON.parse(line) as ServerMessage
    } catch {
      this.log(`ignoring a line the bridge sent that is not JSON: ${line.slice(0, 80)}`)
      return
    }
    switch (message.type) {
      case 'hello':
        this.status = 'connected'
        this.retryMs = RETRY_MIN_MS
        this.log(`bridge is ${message.plugin.id} ${message.plugin.version} (protocol ${message.protocol})`)
        if (message.protocol < BRIDGE_PROTOCOL) this.log('the Stream Deck Bridge plugin in Orca is older than this deck plugin; update it')
        this.notify()
        return
      case 'snapshot':
        this.agentsByPane.clear()
        for (const agent of message.agents) this.agentsByPane.set(agent.paneKey, agent)
        this.workspaces = message.workspaces
        this.focusedWorkspaceId = message.focusedWorkspaceId ?? null
        this.notify()
        return
      case 'agent':
        this.agentsByPane.set(message.agent.paneKey, message.agent)
        this.notify()
        return
      case 'agent.removed':
        this.agentsByPane.delete(message.paneKey)
        this.notify()
        return
      case 'result': {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.ok) pending.resolve(message.result)
        else pending.reject(new BridgeError(message.error.code, message.error.message))
        return
      }
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.open()
    }, this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS)
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

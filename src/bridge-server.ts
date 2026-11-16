import { timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { isAuthMessage, isClientMessage, type ClientMessage, type ServerMessage } from './bridge-protocol'

const MAX_LINE_BYTES = 64 * 1024
const AUTH_TIMEOUT_MS = 5000

export type BridgeClient = { send(message: ServerMessage): void }

export type BridgeServerOptions = {
  /** What a client's first line must carry; see `bridge-rendezvous.ts`. */
  token: string
  onConnect: (client: BridgeClient) => void
  onMessage: (client: BridgeClient, message: ClientMessage) => void | Promise<void>
  log: (message: string) => void
}

/**
 * Accepts Stream Deck plugins on 127.0.0.1 and exchanges newline-delimited JSON with them. A
 * client is told nothing until it presents the token, and one bad line ends the connection: a
 * web page can post to a loopback port, and its HTTP request line must not be skipped over.
 */
export class BridgeServer {
  private readonly server: Server
  private readonly sockets = new Set<Socket>()

  constructor(private readonly options: BridgeServerOptions) {
    this.server = createServer((socket) => this.accept(socket))
  }

  /** Listens on a port the system picks and resolves with it. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      this.server.once('error', onError)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', onError)
        this.server.on('error', (error) => this.options.log(`bridge server error: ${error.message}`))
        const address = this.server.address()
        if (typeof address === 'object' && address) resolve(address.port)
        else reject(new Error('the bridge server has no port'))
      })
    })
  }

  get clientCount(): number {
    return this.sockets.size
  }

  broadcast(message: ServerMessage): void {
    const line = `${JSON.stringify(message)}\n`
    for (const socket of this.sockets) socket.write(line)
  }

  close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private accept(socket: Socket): void {
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    const client: BridgeClient = {
      send: (message) => {
        if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`)
      }
    }
    let authenticated = false
    const authTimer = setTimeout(() => socket.destroy(), AUTH_TIMEOUT_MS)
    const refuse = (why: string) => {
      this.options.log(`bridge client ${why}; disconnecting it`)
      socket.destroy()
    }
    const dispatch = (line: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return refuse('sent a line that is not JSON')
      }
      if (!authenticated) {
        if (!isAuthMessage(parsed) || !sameToken(parsed.token, this.options.token)) return refuse('did not present the bridge token')
        authenticated = true
        clearTimeout(authTimer)
        this.sockets.add(socket)
        this.options.onConnect(client)
        return
      }
      if (!isClientMessage(parsed)) return refuse('sent an unknown message')
      void this.options.onMessage(client, parsed)
    }
    let buffered = ''
    socket.on('data', (chunk: string) => {
      buffered += chunk
      if (buffered.length > MAX_LINE_BYTES) return refuse('sent an oversized line')
      let newline = buffered.indexOf('\n')
      while (newline !== -1 && !socket.destroyed) {
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (line) dispatch(line)
        newline = buffered.indexOf('\n')
      }
    })
    socket.on('error', (error) => this.options.log(`bridge client error: ${error.message}`))
    socket.on('close', () => {
      clearTimeout(authTimer)
      this.sockets.delete(socket)
    })
  }
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

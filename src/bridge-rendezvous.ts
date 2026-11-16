// Where the bridge tells the Stream Deck plugin how to reach it: a file only this user can read,
// holding the port it listens on and the token a client must present. A web page can reach a
// loopback port but cannot read the file, so the token is what keeps it out.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type BridgeRendezvous = { port: number; token: string }

/** `ORCA_STREAMDECK_BRIDGE_FILE` moves it, for tests and for running two Orcas apart. */
export function rendezvousPath(): string {
  return process.env.ORCA_STREAMDECK_BRIDGE_FILE || join(homedir(), '.orca-streamdeck', 'bridge.json')
}

export function writeRendezvous(rendezvous: BridgeRendezvous, path = rendezvousPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(rendezvous)}\n`, { mode: 0o600 })
  // An existing file keeps its old mode on write; Windows ignores modes and relies on the profile's ACL.
  chmodSync(path, 0o600)
}

/** Null when the bridge has not written it (Orca not running, plugin disabled) or it is unreadable. */
export function readRendezvous(path = rendezvousPath()): BridgeRendezvous | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<BridgeRendezvous>
    const portOk = typeof value.port === 'number' && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535
    return portOk && typeof value.token === 'string' && value.token.length > 0 ? { port: value.port!, token: value.token } : null
  } catch {
    return null
  }
}

/** Removes the file if it is still this bridge's: another Orca may have written its own since. */
export function removeRendezvous(token: string, path = rendezvousPath()): void {
  if (readRendezvous(path)?.token === token) rmSync(path, { force: true })
}

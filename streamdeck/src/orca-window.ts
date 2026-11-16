// Orca's plugin API moves between workspaces and tabs but cannot raise Orca's window, so the deck
// does it itself. macOS only; drop this once Orca lets a plugin reveal a terminal.
import { execFile } from 'node:child_process'

const ORCA_BUNDLE_ID = 'com.stablyai.orca'

/** Brings Orca in front of other apps; `log` hears why it could not. */
export function raiseOrcaWindow(log: (message: string) => void): void {
  if (process.platform !== 'darwin') return
  execFile('open', ['-b', ORCA_BUNDLE_ID], (error) => {
    if (error) log(`could not bring Orca to the front: ${error.message}`)
  })
}

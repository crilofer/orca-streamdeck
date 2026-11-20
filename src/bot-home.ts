// Orca's plugin API lists a bot's home like any folder workspace and does not say it is one. Orca
// keeps every bot in its hidden Bots group, `…/bots/<name>`, with a `bot.json` at the root.
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Whether this folder workspace is a bot's home on this computer. */
export function isBotHome(path: string): boolean {
  return basename(dirname(path)) === 'bots' && existsSync(join(path, 'bot.json'))
}

// A bot's own picture, which Orca keeps as `avatar.png` in the bot's home. Read here, not sent by
// the bridge: the deck runs on the same computer, and the file is too large for every snapshot.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pngThumbnail } from './png-thumbnail.ts'

/** Drawn at up to 34 units on a canvas the deck renders at twice that. */
const AVATAR_PIXELS = 72
const MAX_FILE_BYTES = 8 * 1024 * 1024

const cache = new Map<string, { modified: number; base64: string | null }>()

/** The avatar as a small base64 PNG, or null when the bot has none this plugin can read. */
export function botAvatar(botHome: string): string | null {
  const file = join(botHome, 'avatar.png')
  try {
    const { mtimeMs, size } = statSync(file)
    const known = cache.get(file)
    if (known?.modified === mtimeMs) return known.base64
    const base64 = size > MAX_FILE_BYTES ? null : (pngThumbnail(readFileSync(file), AVATAR_PIXELS)?.toString('base64') ?? null)
    cache.set(file, { modified: mtimeMs, base64 })
    return base64
  } catch {
    cache.delete(file)
    return null
  }
}

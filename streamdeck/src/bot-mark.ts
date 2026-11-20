// How a bot is drawn: its own picture, or its initial when it has none this plugin can read.
import { escapeXml, FONT } from './svg-markup.ts'

const WHITE = '#fafafa'

/** The bot's mark as SVG inside a `size` square at (x, y); `avatar` is a base64 PNG. */
export function botMark(name: string, avatar: string | null, x: number, y: number, size: number): string {
  if (avatar !== null) {
    const href = `data:image/png;base64,${avatar}`
    return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${href}" xlink:href="${href}"/>`
  }
  const letter = name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size / 2}" fill="${WHITE}" fill-opacity="0.2"/>` +
    `<text x="${x + size / 2}" y="${y + size * 0.72}" font-family="${FONT}" font-size="${size * 0.6}" font-weight="700" fill="${WHITE}" text-anchor="middle">${escapeXml(letter)}</text>`
  )
}

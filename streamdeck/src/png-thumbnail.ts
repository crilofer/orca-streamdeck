// Shrinks a PNG to a small square one with nothing but zlib: a bot's avatar is a 512px file, and a
// key's picture is sent to the Stream Deck app on every change.
import { deflateSync, inflateSync } from 'node:zlib'

export type Bitmap = { width: number; height: number; rgba: Uint8Array }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_SIDE = 4096

/** The picture as a `size` square PNG; null for a file that is not an 8-bit RGB or RGBA PNG. */
export function pngThumbnail(file: Uint8Array, size: number): Buffer | null {
  const bitmap = decodePng(file)
  return bitmap ? encodePng(shrink(bitmap, size)) : null
}

/** 8-bit truecolour PNGs, with or without alpha, not interlaced: what Orca writes for an avatar. */
export function decodePng(file: Uint8Array): Bitmap | null {
  const data = Buffer.from(file.buffer, file.byteOffset, file.byteLength)
  if (data.length < SIGNATURE.length || !data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return null
  let header: { width: number; height: number; channels: number } | null = null
  const compressed: Buffer[] = []
  for (let offset = SIGNATURE.length; offset + 12 <= data.length; ) {
    const length = data.readUInt32BE(offset)
    const type = data.toString('latin1', offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (body.length < length) return null
    if (type === 'IHDR') {
      const [bitDepth, colorType, , , interlace] = body.subarray(8, 13)
      const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
      const width = body.readUInt32BE(0)
      const height = body.readUInt32BE(4)
      if (bitDepth !== 8 || channels === 0 || interlace !== 0) return null
      if (width === 0 || height === 0 || width > MAX_SIDE || height > MAX_SIDE) return null
      header = { width, height, channels }
    } else if (type === 'IDAT') {
      compressed.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (!header) return null
  const { width, height, channels } = header
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(compressed))
  } catch {
    return null
  }
  const stride = width * channels
  if (raw.length < (stride + 1) * height) return null
  const rgba = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels]! : 0
      const up = previous[x]!
      const upLeft = x >= channels ? previous[x - channels]! : 0
      const predicted = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0
      line[x] = (line[x]! + predicted) & 0xff
    }
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      rgba[at] = line[x * channels]!
      rgba[at + 1] = line[x * channels + 1]!
      rgba[at + 2] = line[x * channels + 2]!
      rgba[at + 3] = channels === 4 ? line[x * channels + 3]! : 255
    }
    previous = line
  }
  return { width, height, rgba }
}

export function encodePng({ width, height, rgba }: Bitmap): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const lines = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) lines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(lines)), chunk('IEND', Buffer.alloc(0))])
}

/** Averages each block of source pixels into one, weighting colour by its opacity; never enlarges. */
function shrink(source: Bitmap, size: number): Bitmap {
  const width = Math.min(size, source.width)
  const height = Math.min(size, source.height)
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * source.height) / height)
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * source.height) / height))
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * source.width) / width)
      const right = Math.max(left + 1, Math.floor(((x + 1) * source.width) / width))
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let sy = top; sy < bottom; sy++) {
        for (let sx = left; sx < right; sx++) {
          const at = (sy * source.width + sx) * 4
          const opacity = source.rgba[at + 3]!
          red += source.rgba[at]! * opacity
          green += source.rgba[at + 1]! * opacity
          blue += source.rgba[at + 2]! * opacity
          alpha += opacity
        }
      }
      const at = (y * width + x) * 4
      if (alpha > 0) {
        rgba[at] = Math.round(red / alpha)
        rgba[at + 1] = Math.round(green / alpha)
        rgba[at + 2] = Math.round(blue / alpha)
      }
      rgba[at + 3] = Math.round(alpha / ((bottom - top) * (right - left)))
    }
  }
  return { width, height, rgba }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const toLeft = Math.abs(estimate - left)
  const toUp = Math.abs(estimate - up)
  const toUpLeft = Math.abs(estimate - upLeft)
  return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
}

function chunk(type: string, body: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body])
  const out = Buffer.alloc(typed.length + 8)
  out.writeUInt32BE(body.length, 0)
  typed.copy(out, 4)
  out.writeUInt32BE(crc32(typed), typed.length + 4)
  return out
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

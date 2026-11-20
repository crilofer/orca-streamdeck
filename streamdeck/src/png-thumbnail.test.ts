import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodePng, encodePng, pngThumbnail } from './png-thumbnail.ts'

const pixels = (...rgba: number[][]) => Uint8Array.from(rgba.flat())
const RED = [255, 0, 0, 255]
const BLUE = [0, 0, 255, 255]
const CLEAR = [0, 255, 0, 0]

test('shrinks a picture by averaging its pixels, ignoring the colour of transparent ones', () => {
  // 4x2: a red block, then a block that is half blue and half fully transparent green.
  const source = encodePng({ width: 4, height: 2, rgba: pixels(RED, RED, BLUE, CLEAR, RED, RED, BLUE, CLEAR) })
  const small = decodePng(pngThumbnail(source, 2)!)!
  assert.deepEqual([small.width, small.height], [2, 2])
  assert.deepEqual([...small.rgba.subarray(0, 8)], [255, 0, 0, 255, 0, 0, 255, 128])
})

test('refuses what is not a PNG it can read, and leaves a small picture at its size', () => {
  assert.equal(pngThumbnail(Buffer.from('not a picture'), 64), null)
  const tiny = encodePng({ width: 1, height: 1, rgba: pixels(BLUE) })
  assert.deepEqual([...decodePng(pngThumbnail(tiny, 64)!)!.rgba], BLUE)
})

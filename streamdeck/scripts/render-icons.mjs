// The Stream Deck app wants the plugin icon as PNG; everything else may stay SVG.
// Renders imgs/plugin/icon.svg to icon.png (256) and icon@2x.png (512).
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..', 'com.crilofer.orca.sdPlugin')
const svg = readFileSync(join(plugin, 'imgs/plugin/icon.svg'))

for (const [file, size] of [
  ['icon.png', 256],
  ['icon@2x.png', 512]
]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(join(plugin, 'imgs/plugin', file), png)
  console.log(`wrote imgs/plugin/${file} (${size}px)`)
}

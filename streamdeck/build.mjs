// Bundles src/plugin.ts into the .sdPlugin folder. Stream Deck runs plugins on its own Node 20,
// which strips neither TypeScript nor the SDK's standard decorators, so esbuild compiles both
// ahead of time. `--watch` rebuilds on save.
import { build, context } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const plugin = join(root, 'com.crilofer.orca.sdPlugin')
const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [join(root, 'src/plugin.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(plugin, 'bin/plugin.js'),
  sourcemap: watch ? 'inline' : false,
  // The SDK depends on `ws`, a CommonJS package that calls require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  // ws's optional native accelerators; absent at runtime, ws falls back to JavaScript.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info'
}

// The .sdPlugin folder is copied around on its own, so mark the bundle as ESM from inside it.
mkdirSync(join(plugin, 'bin'), { recursive: true })
writeFileSync(join(plugin, 'bin/package.json'), '{ "type": "module" }\n')

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('watching src/ for changes')
} else {
  await build(options)
}

// Builds, then installs the plugin into the Stream Deck app as a real folder copy and restarts it.
// A copy rather than `streamdeck link`: the app writes its logs into the plugin folder, and a
// symlink into this repo would land them inside the Orca plugin's dev folder, whose watcher
// reloads the bridge on every write.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const name = 'com.crilofer.orca.sdPlugin'
const source = join(root, name)

function pluginsDirectory() {
  if (process.platform === 'darwin') return join(homedir(), 'Library/Application Support/com.elgato.StreamDeck/Plugins')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'Elgato/StreamDeck/Plugins')
  throw new Error('the Stream Deck app runs on macOS and Windows only')
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(process.execPath, [join(root, 'build.mjs')])

const target = join(pluginsDirectory(), name)
if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true })
// Replace everything but the app's logs, so a file this plugin no longer ships does not linger.
if (existsSync(target)) {
  for (const entry of readdirSync(target)) if (entry !== 'logs') rmSync(join(target, entry), { recursive: true, force: true })
}
cpSync(source, target, { recursive: true, filter: (path) => !path.startsWith(join(source, 'logs')) })
console.log(`installed ${name} into ${dirname(target)}`)

run('streamdeck', ['restart', 'com.crilofer.orca'])

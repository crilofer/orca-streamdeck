import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { isBotHome } from './bot-home'

test('a bot home is a folder of the Bots group that holds a bot.json, and nothing else is', () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-streamdeck-bots-'))
  const bot = join(root, 'bots', 'helper')
  const emptied = join(root, 'bots', 'emptied')
  const project = join(root, 'projects', 'app')
  for (const folder of [bot, emptied, project]) mkdirSync(folder, { recursive: true })
  writeFileSync(join(bot, 'bot.json'), '{}')
  writeFileSync(join(project, 'bot.json'), '{}')

  assert.equal(isBotHome(bot), true)
  assert.equal(isBotHome(emptied), false)
  assert.equal(isBotHome(project), false)
  assert.equal(isBotHome(join(root, 'bots', 'on-another-computer')), false)
})

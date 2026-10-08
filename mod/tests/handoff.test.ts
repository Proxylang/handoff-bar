import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { buildHandoff } from '../hooks/writer'

const HOME = '/home/u'
const ID = 'abc'
const CHAT = `${HOME}/.claude/projects/-w-proj/${ID}.jsonl`
const OUT = `${HOME}/.claude/handoffs/${ID}.md`
const REPLY_AT = Date.parse('2026-10-08T08:00:00.000Z')

// One prompt and one reply that wrote a 5-minute cache.
const TEXT = [
  { type: 'user', cwd: '/w/proj', gitBranch: 'main', message: { role: 'user', content: 'Fix the login page' } },
  {
    type: 'assistant',
    timestamp: '2026-10-08T08:00:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Fixed.\n\nNext steps:\n1. Deploy it' }],
      usage: { cache_creation: { ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 } },
    },
  },
]
  .map(row => JSON.stringify(row))
  .join('\n')

/** Answers every call the mod makes on $ beneath it, and records what it writes. */
function world(on: On, readable = true) {
  const clock = mock.clock(on, { now: REPLY_AT })
  mock.store(on)
  mock.env(on, { HOME })
  const writes = new Map<string, string>()
  const status: (string | undefined)[] = []
  const copied: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine's own band: nothing.
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  on('session.id', () => ({ value: ID }))
  on('session.root', () => ({ value: '/w/proj' }))
  on('session.cwd', () => ({ value: '/w/proj' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', ($, e) => ({ value: e.path === CHAT }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TEXT.length, mtimeMs: REPLY_AT, isLink: false } }))
  on('fs.read', ($, e) => (readable ? { value: e.path === CHAT ? TEXT : '' } : { deny: 'disk unplugged' }))
  on('fs.write', ($, e) => {
    writes.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', ($, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  return { clock, writes, status, copied }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/w/proj', surface: 'terminal', isInteractive: true })
}

test('/handoff writes the Swift writer text and copies it', async ($, on) => {
  const { writes, copied } = world(on)
  await start($)
  const { text } = await $.command.run({
    command: 'handoff',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(text).toBe(`Handoff saved to ${OUT} and copied. Paste it into a new chat.`)
  expect(writes.get(OUT)).toBe(buildHandoff(TEXT, CHAT))
  expect(copied).toEqual([buildHandoff(TEXT, CHAT)])
})

test('status counts down, then the handoff is saved 3 minutes after the reply', async ($, on) => {
  const { clock, writes, status } = world(on)
  await start($)
  await clock.advance(1000)
  expect(status.at(-1)).toBe('Prompt cache: 4:59 left')
  expect(writes.size).toBe(0)
  await clock.set(REPLY_AT + 180_000)
  await clock.advance(1000)
  expect(status.at(-1)).toBe('Prompt cache: 1:59 left')
  expect(writes.get(OUT)).toBe(buildHandoff(TEXT, CHAT))
  await clock.set(REPLY_AT + 5 * 60_000 + 10_000)
  await clock.advance(1000)
  expect(status.at(-1)).toBe('Prompt cache: expired just now')
  await clock.set(REPLY_AT + 7 * 60_000)
  await clock.advance(1000)
  expect(status.at(-1)).toBe('Prompt cache: expired 2 min ago')
})

test('an error that repeats every second is shown in the chat once', async ($, on) => {
  const { clock } = world(on, false)
  const logs: string[] = []
  on('ui.log', ($, e) => {
    if (e.to === 'transcript') logs.push(e.text)
    return { value: undefined }
  })
  await start($)
  await clock.advance(5000)
  expect(logs.length).toBe(1)
  const { text } = await $.command.run({
    command: 'handoff',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(text).toMatch(/^HandoffBar could not write the handoff: /)
})

test('the warning shows above the prompt once the cache has expired', async ($, on) => {
  const { clock } = world(on)
  await start($)
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as const
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'handoffbar', surface, component: 'AbovePrompt', props: props as never })
    expect(await ui.find({ key: 'write' })).toBeUndefined()
    await ui.unmount()
  }
  await clock.set(REPLY_AT + 6 * 60_000)
  await clock.advance(1000)
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'handoffbar', surface, component: 'AbovePrompt', props: props as never })
    expect(await ui.find({ key: 'write' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'handoffbar', surface: 'vscode', component: 'AbovePrompt', props: props as never })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ key: 'write' })).toBeUndefined()
  await ui.unmount()
})

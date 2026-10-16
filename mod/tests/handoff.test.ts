import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { buildHandoff, cacheState } from '../hooks/writer'

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

/** Answers every call the mod makes on $ beneath it, and records what it writes. `files` are
 * other files on disk by path, each read as TEXT; folders are listed from them. `taken` are
 * command names the user's own commands or skills already use. `hasChat` false is a new chat
 * whose file does not exist yet. `surfaces` are where the session draws. */
function world(
  on: On,
  readable = true,
  files: Record<string, { mtimeMs: number; size?: number }> = {},
  taken: string[] = [],
  hasChat = true,
  surfaces: ('terminal' | 'vscode')[] = ['terminal'],
) {
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
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', ($, e) =>
    taken.includes(e.name)
      ? { deny: `"/${e.name}" refused: it is the user's /${e.name}` }
      : { value: { command: e.name } },
  )
  const listed: string[] = []
  on('fs.list', ($, e) => {
    listed.push(e.path)
    const entries = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [path, { mtimeMs, size = TEXT.length }] of Object.entries(files)) {
      if (!path.startsWith(`${e.path}/`)) continue
      const [name = '', ...rest] = path.slice(e.path.length + 1).split('/')
      entries.set(
        name,
        rest.length > 0
          ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
          : { name, kind: 'file', size, mtimeMs, isLink: false },
      )
    }
    return { value: [...entries.values()] }
  })
  on('fs.exists', ($, e) => ({ value: hasChat && e.path === CHAT }))
  on('fs.stat', () => ({ value: { kind: 'file', size: TEXT.length, mtimeMs: REPLY_AT, isLink: false } }))
  on('fs.read', ($, e) =>
    readable ? { value: e.path === CHAT || e.path in files ? TEXT : '' } : { deny: 'disk unplugged' },
  )
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
  return { clock, writes, status, copied, listed }
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

test("at start, the past week's other chats get a missing or outdated handoff, one a second", async ($, on) => {
  const day = 24 * 60 * 60_000
  const chat = (project: string, id: string) => `${HOME}/.claude/projects/${project}/${id}.jsonl`
  const saved = (id: string) => `${HOME}/.claude/handoffs/${id}.md`
  const { clock, writes, listed } = world(on, true, {
    [CHAT]: { mtimeMs: REPLY_AT },
    // No handoff yet.
    [chat('-w-old', 'new')]: { mtimeMs: REPLY_AT - day },
    // A subagent's chat, not the user's.
    [`${HOME}/.claude/projects/-w-old/new/subagents/a.jsonl`]: { mtimeMs: REPLY_AT },
    // The chat changed after its handoff was written.
    [chat('-w-old', 'stale')]: { mtimeMs: REPLY_AT - 2 * day },
    [saved('stale')]: { mtimeMs: REPLY_AT - 3 * day },
    // Its handoff is up to date: writing it again would only repeat it.
    [chat('-w-old', 'done')]: { mtimeMs: REPLY_AT - day },
    [saved('done')]: { mtimeMs: REPLY_AT - day },
    [chat('-w-old', 'old')]: { mtimeMs: REPLY_AT - 8 * day },
    [chat('-w-old', 'big')]: { mtimeMs: REPLY_AT - day, size: 5 * 1024 * 1024 },
    [chat('-private-tmp-x', 'helper')]: { mtimeMs: REPLY_AT },
  })
  await start($)
  await clock.advance(1000)
  expect([...writes.keys()]).toEqual([saved('new')])
  await clock.advance(5000)
  expect([...writes.keys()]).toEqual([saved('new'), saved('stale')])
  expect(writes.get(saved('stale'))).toBe(buildHandoff(TEXT, chat('-w-old', 'stale')))
  expect(listed.filter(dir => dir.includes('-private-tmp'))).toEqual([])
})

test('when the user has their own /handoff, the mod uses /handoffbar and still counts down', async ($, on) => {
  const { clock, writes, status } = world(on, true, {}, ['handoff'])
  await start($)
  await clock.advance(1000)
  expect(status.at(-1)).toBe('Prompt cache: 4:59 left')
  const { text } = await $.command.run({
    command: 'handoffbar',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(text).toBe(`Handoff saved to ${OUT} and copied. Paste it into a new chat.`)
  expect(writes.get(OUT)).toBe(buildHandoff(TEXT, CHAT))
})

test('the last reply is found behind a row longer than the 512 KB read from the end', async () => {
  // The desktop app saves its tool list (about 1.1 MB) in the chat file after a reply.
  const tools = JSON.stringify({ type: 'attachment', attachment: { type: 'prompt_snapshot', tools: 'x'.repeat(1_200_000) } })
  expect(cacheState(`${TEXT}\n${tools}\n`)).toEqual({ lastRequest: REPLY_AT, cache: 300 })
})

test('a new chat with no reply yet shows no button: there is nothing to copy', async ($, on) => {
  const { clock } = world(on, true, {}, [], false)
  await start($)
  await clock.advance(1000)
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as const
  const ui = await $.ui.mount({ plugin: 'handoffbar', surface: 'terminal', component: 'AbovePrompt', props: props as never })
  expect(await ui.find({ key: 'copy' })).toBeUndefined()
  await ui.unmount()
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
  await clock.advance(1000)
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as const
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'handoffbar', surface, component: 'AbovePrompt', props: props as never })
    expect(await ui.find({ key: 'hide' })).toBeUndefined()
    expect(await ui.find({ key: 'copy' })).toBeDefined()
    await ui.unmount()
  }
  await clock.set(REPLY_AT + 6 * 60_000)
  await clock.advance(1000)
  // Only the terminal has Hide: elsewhere the band is always one row, the warning in its line.
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'handoffbar', surface, component: 'AbovePrompt', props: props as never })
    expect(await ui.find({ key: 'hide' })).toBeUndefined()
    expect(await ui.find({ text: 'HandoffBar: Prompt cache expired 1 min ago · next message costs full price' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'handoffbar', surface: 'terminal', component: 'AbovePrompt', props: props as never })
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await ui.press({ key: 'hide' })
  expect(await ui.find({ key: 'hide' })).toBeUndefined()
  expect(await ui.find({ key: 'copy' })).toBeDefined()
  await ui.unmount()
})

test('Copy handoff copies the saved handoff and sends nothing to the chat', async ($, on) => {
  const { writes, copied, clock } = world(on)
  const sent: string[] = []
  on('prompt.submit', ($, e, next) => {
    sent.push(e.text)
    return next(e)
  })
  await start($)
  await clock.advance(1000)
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as const
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'handoffbar', surface, component: 'AbovePrompt', props: props as never })
    await ui.press({ key: 'copy' })
    await ui.unmount()
  }
  expect(writes.get(OUT)).toBe(buildHandoff(TEXT, CHAT))
  expect(copied).toEqual([1, 2, 3].map(() => buildHandoff(TEXT, CHAT)))
  expect(sent).toEqual([])
  // The band says it worked, then the line goes away.
  const ui = await $.ui.mount({ plugin: 'handoffbar', surface: 'terminal', component: 'AbovePrompt', props: props as never })
  const done = `✓ Handoff saved to ${OUT} and copied. Paste it into a new chat.`
  expect(await ui.find({ text: done })).toBeDefined()
  await clock.advance(6000)
  expect(await ui.find({ text: done })).toBeUndefined()
  await ui.unmount()
})

test('in VS Code the band shows the cache timer and no status line is drawn', async ($, on) => {
  const { clock, status } = world(on, true, {}, [], true, ['vscode'])
  await start($)
  await clock.advance(1000)
  expect(status.filter(text => text !== undefined)).toEqual([])
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as const
  const ui = await $.ui.mount({ plugin: 'handoffbar', surface: 'vscode', component: 'AbovePrompt', props: props as never })
  expect(await ui.find({ text: 'HandoffBar: Prompt cache 4:59 left' })).toBeDefined()
  await ui.press({ key: 'copy' })
  expect(await ui.find({ text: 'HandoffBar: Copied ✓' })).toBeDefined()
  await clock.advance(6000)
  expect(await ui.find({ text: 'HandoffBar: Prompt cache 4:53 left' })).toBeDefined()
  await clock.set(REPLY_AT + 7 * 60_000)
  await clock.advance(1000)
  expect(await ui.find({ text: 'HandoffBar: Prompt cache expired 2 min ago · next message costs full price' })).toBeDefined()
  await ui.unmount()
})

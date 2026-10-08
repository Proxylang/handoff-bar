// HandoffBar inside Claude Code: a countdown of this chat's prompt cache in the status line,
// a warning above the prompt once it has expired, /handoff, and the same automatic saves as
// the menu bar app. It only reads chat files and writes ~/.claude/handoffs/<chat id>.md.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { buildHandoff, cacheState, saveTimes, tempProjectPrefixes } from './writer'

// $.fs.read refuses files over 4 MiB. Longer chats get the countdown, not the handoff.
const readLimit = 4 * 1024 * 1024
// The countdown shows seconds.
const tickMs = 1000
// A chat file appears with the first message. Until then, look for it this often.
const searchMs = 30_000

// Minutes since this chat's cache expired; null while it is live or unknown.
const expiredFor = atom({ plugin: 'handoffbar', key: 'expiredFor' } as const, null)
// The person hid the warning for this expiry. A new reply shows it again next time.
const isHidden = atom({ plugin: 'handoffbar', key: 'isHidden' } as const, false)

type Chat = { id: string; path: string; project: string }
type $ = EngineInterface

let chat: Chat | undefined
let searchedAt = 0
let seenMtime = -1
let state: { lastRequest: number; cache: number; isTooBig: boolean } | undefined
// The last reply a save was made for, and how many of its save times are done.
let written: { request: number; saves: number } | undefined
let isTicking = false
// Errors already shown in the chat. A repeat goes to the debug log only, so a lasting
// problem does not add a line every second.
const shownErrors = new Set<string>()

function report($: $, error: unknown) {
  const text = `HandoffBar: ${String(error)}`
  $.ui.log(text, { to: shownErrors.has(text) ? 'debug' : 'transcript' })
  shownErrors.add(text)
}

const ago = (minutes: number) => (minutes === 0 ? 'just now' : `${minutes} min ago`)

async function home($: $): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
}

/** This chat's file: <home>/.claude/projects/<folder named after the working folder>/<id>.jsonl. */
async function findChat($: $): Promise<Chat | undefined> {
  const id = await $.session.id()
  if (chat?.id === id) return chat
  const now = await $.clock.now()
  if (now - searchedAt < searchMs) return undefined
  searchedAt = now
  const projects = `${await home($)}/.claude/projects`
  const named = [await $.session.root(), await $.session.cwd()].map(dir => dir.replace(/[^a-zA-Z0-9]/g, '-'))
  const listed = (await $.fs.list(projects).catch(() => [])).filter(e => e.kind === 'dir').map(e => e.name)
  for (const project of [...new Set([...named, ...listed])]) {
    const path = `${projects}/${project}/${id}.jsonl`
    if (await $.fs.exists(path)) {
      chat = { id, path, project }
      seenMtime = -1
      state = undefined
      written = undefined
      return chat
    }
  }
  return undefined
}

async function writeHandoff($: $, found: Chat): Promise<{ path: string; text: string }> {
  const text = buildHandoff(await $.fs.read(found.path), found.path)
  const path = `${await home($)}/.claude/handoffs/${found.id}.md`
  await $.fs.write(path, text)
  return { path, text }
}

/** Writes the handoff now and copies it. The answer is one line for the person. */
async function handoffNow($: $, surface?: Parameters<$['ui']['copy']>[0]['surface']): Promise<string> {
  return writeAndCopy($, surface).catch(error => `HandoffBar could not write the handoff: ${String(error)}`)
}

async function writeAndCopy($: $, surface?: Parameters<$['ui']['copy']>[0]['surface']): Promise<string> {
  const found = await findChat($)
  if (found === undefined) return 'This chat has no saved messages yet.'
  const { size } = await $.fs.stat(found.path)
  if (size > readLimit) {
    const mb = Math.round(size / 1024 / 1024)
    return `This chat file is ${mb} MB. A Claude Code mod can read files up to 4 MB, so the HandoffBar menu bar app writes this one.`
  }
  const { path, text } = await writeHandoff($, found)
  const copied = await $.ui.copy({ text, surface })
  return copied.isCopied
    ? `Handoff saved to ${path} and copied. Paste it into a new chat.`
    : `Handoff saved to ${path}. Open it and paste it into a new chat.`
}

async function tick($: $) {
  const found = await findChat($)
  if (found === undefined) {
    // A /clear starts a new chat with no file yet: nothing to count down or warn about.
    if ((await read($, expiredFor)) !== null) await update($, expiredFor, () => null)
    return $.ui.status(undefined)
  }
  const stat = await $.fs.stat(found.path).catch(() => undefined)
  if (stat === undefined) return
  if (stat.mtimeMs !== seenMtime) {
    seenMtime = stat.mtimeMs
    const before = state?.lastRequest
    if (stat.size <= readLimit) {
      const parsed = cacheState(await $.fs.read(found.path))
      state = parsed && { ...parsed, isTooBig: false }
      // Claude Code picks the cache length per account, so a long chat uses the last one seen.
      if (parsed) await $.store.set('cache', parsed.cache)
    } else {
      // Too long to read: the file's last write stands in for the last reply.
      const cache = Number((await $.store.get('cache')) ?? 300)
      state = { lastRequest: stat.mtimeMs, cache, isTooBig: true }
    }
    if (state?.lastRequest !== before) await update($, isHidden, () => false)
  }
  if (state === undefined) return $.ui.status(undefined)

  const now = await $.clock.now()
  const left = Math.ceil((state.lastRequest + state.cache * 1000 - now) / 1000)
  const minutes = left > 0 ? null : Math.floor(-left / 60)
  if ((await read($, expiredFor)) !== minutes) await update($, expiredFor, () => minutes)
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  $.ui.status(minutes === null ? `Prompt cache: ${clock} left` : `Prompt cache: expired ${ago(minutes)}`)

  const isTemp = tempProjectPrefixes.some(p => found.project.startsWith(p))
  if (state.isTooBig || isTemp) return
  const quiet = (now - state.lastRequest) / 1000
  const due = saveTimes(state.cache).filter(t => quiet >= t).length
  const done = written?.request === state.lastRequest ? written.saves : 0
  if (quiet < state.cache && due > done) {
    written = { request: state.lastRequest, saves: due }
    await writeHandoff($, found)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'handoff',
      description: "Write this chat's handoff now and copy it",
    })
    $.clock.every(tickMs, () => {
      if (isTicking) return
      isTicking = true
      tick($)
        .catch(error => report($, error))
        .finally(() => (isTicking = false))
    })

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => ({ text: await handoffNow($) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const minutes = await read($, expiredFor)
    if (minutes === null || e.props.hasSurvey || e.props.isWorking || (await read($, isHidden))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text color="yellow">
          This chat's prompt cache expired {ago(minutes)}. Your next message re-sends the whole chat at full price.
        </Text>
        <Box>
          <Button
            key="write"
            label="Write handoff"
            variant="primary"
            onPress={async press => $.ui.toast(await handoffNow($, press.surface))}
          />
          <Text> </Text>
          <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
        </Box>
      </Box>
    )
  })
}

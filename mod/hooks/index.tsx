// HandoffBar inside Claude Code: a countdown of this chat's prompt cache in the status line,
// a warning above the prompt once it has expired, /handoff, and the same automatic saves as
// the menu bar app. At start it also writes the handoffs other recent chats are missing.
// It only reads chat files and writes ~/.claude/handoffs/<chat id>.md.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { buildHandoff, cacheState, saveTimes, tempProjectPrefixes } from './writer'

// $.fs.read refuses files over 4 MiB. Longer chats get the countdown, not the handoff.
const readLimit = 4 * 1024 * 1024
// The countdown shows seconds.
const tickMs = 1000
// A chat file appears with the first message. Until then, look for it this often.
const searchMs = 30_000
// At start, other chats changed this recently get a handoff if theirs is missing or older than
// the chat. Older chats are rarely continued, and the limit keeps the first run short.
const catchUpMs = 7 * 24 * 60 * 60 * 1000

// Minutes since this chat's cache expired; null while it is live or unknown.
const expiredFor = atom({ plugin: 'handoffbar', key: 'expiredFor' } as const, null)
// The person hid the warning for this expiry. A new reply shows it again next time.
const isHidden = atom({ plugin: 'handoffbar', key: 'isHidden' } as const, false)
// This chat has a reply, so there is a handoff to copy. A new chat shows no button until then.
const hasReply = atom({ plugin: 'handoffbar', key: 'hasReply' } as const, false)
// What the last Copy handoff press did, shown in the band for noticeMs. The engine's toast is a
// dim line at the screen's bottom, easy to miss, so the band says it where the person looked.
const notice = atom({ plugin: 'handoffbar', key: 'notice' } as const, null)
const noticeMs = 6000

type Chat = { id: string; path: string; project: string }
type $ = EngineInterface

let chat: Chat | undefined
let searchedAt = 0
let seenMtime = -1
let state: { lastRequest: number; cache: number; isTooBig: boolean } | undefined
// The last reply a save was made for, and how many of its save times are done.
let written: { request: number; saves: number } | undefined
let isTicking = false
// The HandoffBar icon is a hand pointing right; this emoji is the same hand and every terminal
// draws it. The orange is the site's accent in dark mode, where most terminals run.
const copyLabel = '👉 Copy handoff'
const copyHotkey = '0'
const brandOrange = '#e8683f'
// Claude Code refuses a command name the user's own command or skill has, so the second
// name is used when the first is taken.
const commandNames = ['handoff', 'handoffbar']
let command: string | undefined
// Other chats still waiting for their handoff, newest first. Built on the first tick.
let waiting: Chat[] | undefined
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
  const saved = `${await home($)}/.claude/handoffs/${found.id}.md`
  if (size > readLimit && !(await $.fs.exists(saved))) {
    const mb = Math.round(size / 1024 / 1024)
    return `This chat file is ${mb} MB. A Claude Code mod can read files up to 4 MB, so the HandoffBar menu bar app writes this one.`
  }
  // Too long to read: copy the handoff the menu bar app saved.
  const { path, text } = size > readLimit ? { path: saved, text: await $.fs.read(saved) } : await writeHandoff($, found)
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
    if (await read($, hasReply)) await update($, hasReply, () => false)
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
    if ((await read($, hasReply)) !== (state !== undefined)) await update($, hasReply, () => state !== undefined)
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

/** Other chats from the last week whose handoff is missing or older than the chat. One file per
 * chat id, so a chat already saved by the menu bar app or another session is never repeated. */
async function staleChats($: $): Promise<Chat[]> {
  const claude = `${await home($)}/.claude`
  const id = await $.session.id()
  const since = (await $.clock.now()) - catchUpMs
  const saved = new Map((await $.fs.list(`${claude}/handoffs`).catch(() => [])).map(e => [e.name, e.mtimeMs]))
  const found: (Chat & { mtimeMs: number })[] = []
  for (const dir of await $.fs.list(`${claude}/projects`).catch(() => [])) {
    if (dir.kind !== 'dir' || tempProjectPrefixes.some(p => dir.name.startsWith(p))) continue
    for (const file of await $.fs.list(`${claude}/projects/${dir.name}`).catch(() => [])) {
      const chatId = file.name.replace(/\.jsonl$/, '')
      if (file.kind !== 'file' || chatId === file.name || chatId === id) continue
      if (file.mtimeMs < since || file.size > readLimit) continue
      if ((saved.get(`${chatId}.md`) ?? -1) >= file.mtimeMs) continue
      const path = `${claude}/projects/${dir.name}/${file.name}`
      found.push({ id: chatId, path, project: dir.name, mtimeMs: file.mtimeMs })
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** Writes the next waiting chat's handoff, one per call so a long list does not slow the session. */
async function catchUp($: $) {
  waiting ??= await staleChats($)
  const next = waiting.shift()
  if (next !== undefined) await writeHandoff($, next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const name of commandNames) {
      const registered = await $.command
        .register({ name, description: "Write this chat's handoff now and copy it" })
        .catch(() => undefined)
      if (registered !== undefined) {
        command = name
        break
      }
    }
    $.clock.every(tickMs, () => {
      if (isTicking) return
      isTicking = true
      tick($)
        .catch(error => report($, error))
        .then(() => catchUp($))
        // Another chat's file: not this chat's problem, so not shown in it.
        .catch(error => $.ui.log(`HandoffBar: ${String(error)}`, { to: 'debug' }))
        .finally(() => (isTicking = false))
    })

    return next(e)
  })

  // Only the name this mod registered: a user's own /handoff stays theirs.
  on('command.run', async ($, e, next) => (e.command === command ? { text: await handoffNow($) } : next(e)))

  // Once the chat has a reply the Copy handoff button is always there, so the person never has to
  // type a message (which would re-send the chat) to get the handoff. A press only copies.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking || !(await read($, hasReply))) return next(e)
    const minutes = await read($, expiredFor)
    const isWarning = minutes !== null && !(await read($, isHidden))
    const shown = await read($, notice)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {shown !== null && (
          <Text color={shown.includes(' and copied.') ? 'green' : 'yellow'}>
            {shown.includes(' and copied.') ? `✓ ${shown}` : shown}
          </Text>
        )}
        {isWarning && (
          <Text color="yellow">
            This chat's prompt cache expired {ago(minutes)}. Your next message re-sends the whole chat at full price.
          </Text>
        )}
        <Box justifyContent={isWarning ? 'flex-start' : 'flex-end'}>
          {/* While the cache is live, a small dim link on the right that lights up under the pointer.
              The keyed Box is the area the pointer hovers. */}
          {/* Outside the fullscreen layout the terminal keeps the mouse for selecting text, so a
              click never reaches the button. A digit hotkey does: typed into an empty prompt, it
              presses this band's button. 0, because a message rarely starts with it.
              A plain Button draws its hotkey ("0: label") itself; the full button does not. */}
          {e.viewport?.isFullscreen === false && <Text dimColor>{isWarning ? 'press 0: ' : 'press '}</Text>}
          <Box key="copy-area">
            <Button
              key="copy"
              hotkey={copyHotkey}
              label={copyLabel}
              plain={isWarning ? undefined : true}
              dimColor={!isWarning}
              hover={{ color: brandOrange, dimColor: false }}
              variant={isWarning ? 'primary' : undefined}
              onPress={async press => {
                const text = await handoffNow($, press.surface)
                await update($, notice, () => text)
                $.clock.after(noticeMs, () => update($, notice, shown => (shown === text ? null : shown)))
              }}
            />
          </Box>
          {isWarning && <Text> </Text>}
          {isWarning && <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />}
        </Box>
      </Box>
    )
  })
}

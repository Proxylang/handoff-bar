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
// Seconds until this chat's cache expires; null once expired or unknown. The band in VS Code,
// the desktop app and the phone shows it, so those surfaces need no status line under the band.
const cacheLeft = atom({ plugin: 'handoffbar', key: 'cacheLeft' } as const, null)
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
// VS Code, the desktop app and the phone draw a real icon, so their button needs no emoji.
const webCopyLabel = 'Copy handoff'
// The HandoffBar app icon (vscode/media/hand-dark.svg): a white hand on an orange square.
const handIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3.6" fill="#E8683F"/><g fill="#FFFFFF" transform="translate(2 1.2) scale(0.75)"><rect x="0.5" y="5" width="1.6" height="8" rx="0.5"/><path d="M2.7 6.2C2.7 4.9 3.6 4 4.9 4H14C14.8 4 15.5 4.6 15.5 5.4C15.5 6.2 14.8 6.9 14 6.9H8.4V12.4C8.4 13.3 7.7 14 6.8 14H4.9C3.6 14 2.7 13.1 2.7 11.8Z"/><rect x="7.3" y="7.4" width="3.5" height="1.9" rx="0.95"/><rect x="7.3" y="9.7" width="3.1" height="1.9" rx="0.95"/><rect x="7.3" y="12" width="2.6" height="1.9" rx="0.95"/></g></svg>`
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

const ago = (minutes: number) =>
  minutes === 0 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`
const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

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
    if ((await read($, cacheLeft)) !== null) await update($, cacheLeft, () => null)
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
  const seconds = minutes === null ? left : null
  if ((await read($, cacheLeft)) !== seconds) await update($, cacheLeft, () => seconds)
  // VS Code, the desktop app and the phone show the timer in the band. A status line there would
  // draw a second box under it.
  const isTerminal = (await $.session.surfaces()).includes('terminal')
  $.ui.status(
    !isTerminal
      ? undefined
      : minutes === null
        ? `Prompt cache: ${clockText(left)} left`
        : `Prompt cache: expired ${ago(minutes)}`,
  )

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

/** A Copy handoff press: copies, then shows what happened in the band for noticeMs. */
async function copyPressed($: $, surface: Parameters<$['ui']['copy']>[0]['surface']) {
  const text = await handoffNow($, surface)
  await update($, notice, () => text)
  $.clock.after(noticeMs, () => update($, notice, shown => (shown === text ? null : shown)))
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
    const isCopied = shown?.includes(' and copied.') ?? false

    if (e.surface !== 'terminal') {
      // One line inside the frame the app draws: icon, "HandoffBar: <cache state>", the button on
      // the right. VS Code wraps a row by default, so both rows say nowrap and the text is cut
      // with an ellipsis when the panel is narrow. An error is the one line left to wrap: cut, it
      // would lose its reason.
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      const seconds = await read($, cacheLeft)
      const [state, color] =
        shown !== null
          ? [isCopied ? 'Copied ✓' : shown, isCopied ? 'success' : 'warning']
          : minutes !== null
            ? [`Prompt cache expired ${ago(minutes)} · next message costs full price`, 'warning']
            : [seconds === null ? 'Prompt cache' : `Prompt cache ${clockText(seconds)} left`, 'secondaryText']
      const wrap = shown !== null && !isCopied ? 'wrap' : 'truncate-end'
      return (
        <Box flexDirection="row" flexWrap="nowrap" alignItems="center" justifyContent="space-between" columnGap={2}>
          <Box flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={1} flexShrink={1}>
            <Svg source={handIcon} alt="" width={16} height={16} />
            <Text wrap={wrap}>
              <Text wrap={wrap} bold>
                HandoffBar
              </Text>
              <Text wrap={wrap} color={color}>
                : {state}
              </Text>
            </Text>
          </Box>
          {/* VS Code fills a Button with the theme's button color and reads no color prop, so the
              one button here is always the filled one. */}
          <Button key="copy" label={webCopyLabel} variant="primary" onPress={press => copyPressed($, press.surface)} />
        </Box>
      )
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {shown !== null && (
          <Text color={isCopied ? 'green' : 'yellow'}>{isCopied ? `✓ ${shown}` : shown}</Text>
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
              onPress={press => copyPressed($, press.surface)}
            />
          </Box>
          {isWarning && <Text> </Text>}
          {isWarning && <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />}
        </Box>
      </Box>
    )
  })
}

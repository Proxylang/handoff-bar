// Builds a handoff from a Claude Code chat file. A line-for-line port of Sources/Writer.swift:
// the text must match the Swift writer's byte for byte, so the Mac app and this mod write the
// same file. Swift counts characters as grapheme clusters, splits lines on every Unicode newline,
// and its regex engine (ICU) treats \s, \d and \b as Unicode; the helpers below do the same.

// The longest cache Anthropic offers.
export const longestCache = 3600
// Every chat gets a handoff after 3 quiet minutes: 2 minutes before a 5-minute cache runs out.
export const firstSave = 180
// 1-hour chats are saved again 5 minutes before the end.
export const lastSave = 300
/** Seconds after the last reply at which the handoff is written. */
export function saveTimes(cache: number): number[] {
  return cache >= longestCache ? [firstSave, cache - lastSave] : [firstSave]
}
// Enough of the file end to hold the last few replies and their cache usage.
const tailBytes = 512 * 1024
// Claude Code names a chat's project folder after its working folder. These are temp folders,
// used by scripts that run helper chats. Those are not the user's chats.
export const tempProjectPrefixes = ['-private-var-folders-', '-private-tmp', '-tmp']

const recentPrompts = 10
const promptChars = 500
// The last reply is kept whole: its end holds the open question and the next steps.
const maxFiles = 40
const summaryChars = 8000
const decisionAnswerChars = 3
const maxDecisions = 8
const questionChars = 200
const maxOptions = 4
const optionChars = 140
const maxBackgroundCommands = 6
const commandChars = 160
const maxNextSteps = 10
const recentErrorWindow = 3
const errorChars = 600

type Json = Record<string, unknown>

// What Swift's `as?` casts accept from JSONSerialization's values.
const isDict = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const dict = (v: unknown): Json | undefined => (isDict(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
// `as? [[String: Any]]` fails as a whole when any element is not an object.
const dicts = (v: unknown): Json[] => (Array.isArray(v) && v.every(isDict) ? v : [])
// JSONSerialization hands back NSNumber: `true` casts to 1 and 1 casts to true.
const bool = (v: unknown): boolean => v === true || v === 1
const int = (v: unknown): number | undefined =>
  v === true ? 1 : v === false ? 0 : typeof v === 'number' && Number.isInteger(v) ? v : undefined

function jsonLines(text: string): Json[] {
  const out: Json[] = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      const o: unknown = JSON.parse(line)
      if (isDict(o)) out.push(o)
    } catch {}
  }
  return out
}

// ISO8601DateFormatter with .withFractionalSeconds parses only timestamps that have them.
const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+(Z|[+-]\d{2}:?\d{2})$/

export type CacheState = {
  /** When the last reply's request was sent (ms since the epoch): the cache timer starts there. */
  lastRequest: number
  /** The cache length (seconds) the last cache write named; undefined when no write is found. */
  cache: number | undefined
  /** When the chat was compacted after that reply: the cache does not cover the new chat. */
  compactedAt: number | undefined
}

/**
 * The last reply's cache timing, read from the end of the chat file, by the rules the VS Code
 * extension uses for its "Prompt cache" clock. The API reports which cache a request wrote:
 * `ephemeral_1h_input_tokens` or `ephemeral_5m_input_tokens`.
 */
export function cacheState(text: string): CacheState | undefined {
  const bytes = new TextEncoder().encode(text)
  const tail = bytes.length > tailBytes ? new TextDecoder().decode(bytes.subarray(bytes.length - tailBytes)) : text
  // The desktop app saves its tool list (over 1 MB) after a reply, which can push the reply, or
  // the last cache write, out of the file end. Then the whole file is read.
  const found = lastReply(tail)
  return found?.cache !== undefined || tail === text ? found : lastReply(text) ?? found
}

const timeOf = (o: Json): number | undefined => {
  const ts = str(o.timestamp)
  return ts !== undefined && isoDate.test(ts) ? Date.parse(ts) : undefined
}

function lastReply(text: string): CacheState | undefined {
  const rows = jsonLines(text).filter(o => !bool(o.isSidechain))
  let reply = rows.length - 1
  while (reply >= 0 && rows[reply]?.type !== 'assistant') reply--
  if (reply < 0) return undefined
  const after = rows.slice(reply + 1).filter(o => o.type === 'system' && o.subtype === 'compact_boundary')
  const compactedAt = after.length > 0 ? timeOf(after[after.length - 1] as Json) : undefined

  // One request writes one row per content block, all with its message id. The request was sent
  // when the row before its first block was written: the prompt, or the tool results it carries.
  const id = str(dict(rows[reply]?.message)?.id)
  let first = reply
  while (first > 0 && rows[first - 1]?.type === 'assistant' && id !== undefined && str(dict(rows[first - 1]?.message)?.id) === id) first--
  let lastRequest: number | undefined
  for (let i = first - 1; i >= 0 && lastRequest === undefined; i--) lastRequest = timeOf(rows[i] as Json)
  lastRequest ??= timeOf(rows[first] as Json)
  if (lastRequest === undefined) return undefined

  // A reply that only read the cache keeps the length of the write before it.
  let cache: number | undefined
  for (let i = reply; i >= 0 && cache === undefined; i--) {
    if (rows[i]?.type !== 'assistant') continue
    const created = dict(dict(dict(rows[i]?.message)?.usage)?.cache_creation)
    if ((int(created?.ephemeral_1h_input_tokens) ?? 0) > 0) cache = 3600
    else if ((int(created?.ephemeral_5m_input_tokens) ?? 0) > 0) cache = 300
  }
  return { lastRequest, cache, compactedAt }
}

// MARK: - Swift string rules

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Swift's `s.count`, stopping once it passes `limit`. */
function count(s: string, limit = Infinity): number {
  let n = 0
  for (const _ of graphemes.segment(s)) if (++n > limit) break
  return n
}

function cut(s: string, n: number): string {
  if (count(s, n) <= n) return s
  let end = 0
  let taken = 0
  for (const g of graphemes.segment(s)) {
    if (taken++ === n) break
    end = g.index + g.segment.length
  }
  return s.slice(0, end) + ' ...'
}

// CharacterSet.whitespaces, and .whitespacesAndNewlines.
const spaces = '\\t\\p{Zs}'
const spacesAndNewlines = '\\t\\n\\v\\f\\r\\u0085\\p{Zs}\\u2028\\u2029'
const trimRe = (set: string) => new RegExp(`^[${set}]+|[${set}]+$`, 'gu')
const trimSpacesRe = trimRe(spaces)
const trimAllRe = trimRe(spacesAndNewlines)
const trimSpaces = (s: string) => s.replace(trimSpacesRe, '')
const trim = (s: string) => s.replace(trimAllRe, '')

// `split(whereSeparator: \.isNewline)`: every Unicode newline, "\r\n" as one, empty lines dropped.
const newline = new RegExp('\\r\\n|[\\n\\v\\f\\r\\u0085\\u2028\\u2029]', 'u')
const lines = (s: string) => s.split(newline).filter(l => l !== '')

function oneLine(s: string): string {
  return trimSpaces(lines(s).join(' '))
}

// Swift compares strings by canonical equivalence.
const same = (a: string, b: string) => a === b || a.normalize('NFC') === b.normalize('NFC')

// ICU's \s, \d and \b. JS reads all three as ASCII.
const S = '[\\t\\n\\f\\r\\p{Z}]'
const D = '\\p{Nd}'
const W = '[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200c\\u200d]'
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`
const icu = (pattern: string, flags = '') => new RegExp(pattern, flags + 'u')

// Blocks the harness adds to user messages. They are not the user's words.
const harnessBlocks = /<(system-reminder|browser_instruction|local-command-caveat)>.*?<\/\1>/gsu
// Skill bodies and background-task events arrive as user messages but are not the user's words.
const notUserPrefixes = ['[Request interrupted', 'Base directory for this skill', '<task-notification>']

function userText(o: Json): string {
  const content = dict(o.message)?.content
  const s = str(content)
  const parts =
    s !== undefined
      ? [s]
      : dicts(content)
          .filter(b => b.type === 'text')
          .map(b => str(b.text) ?? '')
  const text = trim(parts.join('\n').replace(harnessBlocks, ''))
  if (text === '' || notUserPrefixes.some(p => text.startsWith(p)) || text.includes('[SYSTEM NOTIFICATION')) return ''
  return text
}

function blockText(content: unknown): string {
  const s = str(content)
  if (s !== undefined) return s
  return dicts(content)
    .map(b => str(b.text))
    .filter((t): t is string => t !== undefined)
    .join('\n')
}

// A line that asks the user to choose: ends in "?", or says pick / choose / which / reply "X" or "Y".
const questionLine = icu(`\\?[*_]*${S}*$|${B}(pick one|choose|which one)${B}|reply${S}+["“][^"”]{1,20}["”]${S}+or${B}`, 'i')
// A heading that starts a list of next steps.
const nextStepsHeading = icu(`^[#*\\t\\n\\f\\r\\p{Z}]*(next steps?|what you need to do next|to-?do)${B}`, 'i')
const listItem = icu(`^${S}*([-*•]|${D}+[.)])${S}+`)
// Starts like an answer to a choice: "A", "2", "yes", "B, please", "option 1".
const answerStart = icu(`^${S}*(option${S}*)?([a-d]|[1-5]|yes|yep|yeah|no|nope|ok|okay|sure|both|neither)${B}`, 'i')
// "A. Wait.", "**B. Build it now.**", "- **A.** ...": a lettered option.
const letteredOption = icu(`^${S}*(-${S}+)?(\\*\\*)?[A-D][.):](\\*\\*)?${S}`)

function plain(line: string): string {
  return trimSpaces(line.replace(listItem, '').split('**').join(''))
}

const isBlank = (l: string) => trim(l) === ''

/** Lines after `i` with leading blank ones dropped, up to the first that is not a list item. */
function listAfter(ls: string[], i: number, max: number): string[] {
  const rest = ls.slice(i + 1)
  const start = rest.findIndex(l => !isBlank(l))
  if (start < 0) return []
  const out: string[] = []
  for (const l of rest.slice(start)) {
    if (!listItem.test(l) || out.length === max) break
    out.push(l)
  }
  return out
}

/** The last line in a reply that asks the user to choose, with the options listed right under it. */
function question(reply: string): string | undefined {
  const ls = lines(reply)
  // Quoted lines are drafts shown to the user, not questions to them.
  const asks = ls.flatMap((l, i) => (!l.startsWith('>') && questionLine.test(l) ? [i] : []))
  // "Pick one:" with its options beats a later bare "Reply A or B" that only points back at them.
  const i = asks.findLast(a => listAfter(ls, a, maxOptions).length > 0) ?? asks.at(-1)
  if (i === undefined) return undefined
  let found = listAfter(ls, i, maxOptions)
  // A bare "Reply A or B": the lettered options are elsewhere in the reply.
  if (found.length === 0) found = ls.filter(l => letteredOption.test(l)).slice(0, maxOptions)
  return cut(plain(ls[i]!), questionChars) + found.map(o => '\n    - ' + cut(plain(o), optionChars)).join('')
}

function isAnswer(text: string): boolean {
  const n = count(text, 80)
  return n <= decisionAnswerChars || (n <= 80 && answerStart.test(text))
}

/** The list under a "Next steps" style heading in a reply. */
function nextSteps(reply: string): string[] {
  const ls = lines(reply)
  const start = ls.findLastIndex(l => nextStepsHeading.test(l))
  return start < 0 ? [] : listAfter(ls, start, maxNextSteps)
}

/** The text of ~/.claude/handoffs/<chat id>.md for the chat file at `chatPath`. */
export function buildHandoff(text: string, chatPath: string): string {
  let title = '',
    customTitle = '',
    cwd = '',
    branch = '',
    lastReply = '',
    summary = ''
  const prompts: string[] = []
  let files: string[] = [] // oldest first, each path once
  const decisions: string[] = []
  let background: string[] = []
  const commands = new Map<string, string>() // tool use id -> what it ran
  let lastError = ''
  let resultsSinceError = Infinity

  for (const o of jsonLines(text)) {
    const sidechain = bool(o.isSidechain)
    if (o.type === 'ai-title') {
      title = str(o.aiTitle) ?? title
    } else if (o.type === 'custom-title') {
      // The name the user typed when renaming the tab. Beats the AI title.
      customTitle = str(o.customTitle) ?? customTitle
    } else if (o.type === 'user' && !sidechain) {
      // First folder, not the last: the chat may cd into a subfolder later.
      if (cwd === '') cwd = str(o.cwd) ?? ''
      if (branch === '') branch = str(o.gitBranch) ?? ''
      const content = dict(o.message)?.content
      if (bool(o.isCompactSummary)) {
        // Claude Code's own summary, written when the chat ran out of room.
        summary = blockText(content)
        continue
      }
      for (const b of dicts(content)) {
        if (b.type !== 'tool_result') continue
        resultsSinceError = resultsSinceError === Infinity ? Infinity : resultsSinceError + 1
        if (!bool(b.is_error)) continue
        const t = blockText(b.content)
        // The user turning down a tool call is a choice, not a failure.
        if (t.includes("doesn't want to proceed")) continue
        const ran = commands.get(str(b.tool_use_id) ?? '')
        lastError = (ran !== undefined ? `${ran}\n` : '') + cut(trim(t), errorChars)
        resultsSinceError = 0
      }
      const said = userText(o)
      if (said === '') continue
      prompts.push(said)
      const q = isAnswer(said) ? question(lastReply) : undefined
      if (q !== undefined) {
        const entry = `- Asked: ${q}\n  Answer: ${oneLine(said)}`
        // A message sent twice is one choice.
        const prev = decisions.at(-1)
        if (prev === undefined || !same(prev, entry)) decisions.push(entry)
      }
    } else if (o.type === 'assistant' && !sidechain) {
      for (const b of dicts(dict(o.message)?.content)) {
        const input = dict(b.input) ?? {}
        const t = str(b.text)
        if (b.type === 'text' && t !== undefined && trim(t) !== '') {
          lastReply = trim(t)
        } else if (b.type === 'tool_use') {
          const name = str(b.name) ?? ''
          const p = str(input.file_path)
          if ((name === 'Edit' || name === 'Write') && p !== undefined) {
            files = files.filter(f => !same(f, p))
            files.push(p)
          }
          const cmd = str(input.command)
          if (name === 'Bash' && cmd !== undefined) {
            const line = cut(oneLine(cmd), commandChars)
            commands.set(str(b.id) ?? '', `Command: \`${line}\``)
            if (bool(input.run_in_background)) {
              const d = str(input.description)
              const label = d !== undefined ? `${d}: ` : ''
              background = background.filter(x => !x.endsWith(`\`${line}\``))
              background.push(`- ${label}\`${line}\``)
            }
          } else if (name !== '') {
            commands.set(str(b.id) ?? '', `Tool: ${name}`)
          }
        }
      }
    }
  }

  const file = chatPath.slice(chatPath.lastIndexOf('/') + 1)
  const session = file.includes('.') ? file.slice(0, file.lastIndexOf('.')) : file
  if (customTitle !== '') title = customTitle
  const out = [
    `# Handoff: ${title === '' ? session : title}`,
    '',
    'Continue the work from an earlier chat that ran out of cache. Read this, then ask the user what to do first.',
    '',
    `- Folder: ${cwd}`,
    `- Branch: ${branch === '' ? 'none' : branch}`,
    `- Old chat file: ${chatPath}`,
    '',
  ]
  if (summary !== '') {
    out.push("## Claude's summary of the earlier part of the chat", '', cut(summary, summaryChars), '')
  }
  if (prompts.length > 0) {
    out.push('## First request', '', cut(prompts[0]!, promptChars * 2), '')
    out.push('## Recent requests, oldest first', '')
    out.push(...prompts.slice(-recentPrompts).map((p, i) => `${i + 1}. ${cut(p, promptChars)}`))
    out.push('')
  }
  if (decisions.length > 0) {
    out.push('## Choices the user made, oldest first. Do not reopen them.', '')
    out.push(...decisions.slice(-maxDecisions))
    out.push('')
  }
  const steps = nextSteps(lastReply)
  if (steps.length > 0) {
    out.push('## Next steps listed at the end of the old chat', '')
    out.push(...steps)
    out.push('')
  }
  if (background.length > 0) {
    out.push('## Started in the background in the old chat. Check if still running.', '')
    out.push(...background.slice(-maxBackgroundCommands))
    out.push('')
  }
  if (lastError !== '' && resultsSinceError < recentErrorWindow) {
    out.push('## Last error in the old chat', '', '```', lastError, '```', '')
  }
  if (files.length > 0) {
    out.push('## Files changed in the old chat, oldest first', '')
    out.push(...files.slice(-maxFiles).map(f => `- ${f}`))
    out.push('')
  }
  if (lastReply !== '') {
    out.push('## Last reply from the old chat', '', lastReply, '')
  }
  return out.join('\n')
}

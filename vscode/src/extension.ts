// HandoffBar for VS Code: a hand icon in the title bar of every Claude Code chat tab and the
// Claude sidebar copies that chat's handoff, and the status bar counts down its prompt cache.
// It only reads ~/.claude/projects and writes ~/.claude/handoffs/<chat id>.md. Nothing is sent
// to Claude: the Claude panel belongs to another extension, and this one never touches it.
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'

import { buildHandoff, cacheState, tempProjectPrefixes, type CacheState } from '../../mod/hooks/writer'
import { chatTitle, pickChat, projectFolderName, type ChatFile } from './chats'

const claudeDir = join(homedir(), '.claude')
const projectsDir = join(claudeDir, 'projects')
const handoffsDir = join(claudeDir, 'handoffs')
// The countdown shows seconds.
const tickMs = 1000
// Chat files change with every reply; listing them each second would stat hundreds of files.
const listMs = 5000
// The longest cache Anthropic offers. A chat quiet for longer has nothing left to count down.
const longestCacheMs = 3600 * 1000
// The Claude extension's chat tab (its webview panel's view type ends with this).
const claudePanel = 'claudeVSCodePanel'
// How long the status bar shows "Handoff copied!" in green after a copy. VS Code popups have no
// color option, so the confirmation lives in the status bar item instead.
const copiedMs = 3000
let copiedUntil = 0

type Seen = ChatFile & { size: number; cache?: CacheState }
// What each chat file held at its last mtime, so a file is read again only when it changes.
const seen = new Map<string, Seen>()
let chats: Seen[] = []
let listedAt = 0

/** The label of the active editor tab when it is a Claude chat; undefined otherwise. */
function activeClaudeLabel(): string | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab
  return tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(claudePanel) ? tab.label : undefined
}

/** The project folders of the open workspace; every project folder when none is open. */
async function projectFolders(): Promise<string[]> {
  const open = vscode.workspace.workspaceFolders?.map(f => projectFolderName(f.uri.fsPath))
  if (open && open.length > 0) return open
  const all = await fs.readdir(projectsDir).catch(() => [] as string[])
  return all.filter(name => !tempProjectPrefixes.some(p => name.startsWith(p)))
}

async function listChats(): Promise<Seen[]> {
  const found: Seen[] = []
  for (const folder of await projectFolders()) {
    const dir = join(projectsDir, folder)
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(dir, name)
      const stat = await fs.stat(path).catch(() => undefined)
      if (!stat?.isFile()) continue
      const known = seen.get(path)
      if (known?.mtimeMs === stat.mtimeMs) {
        found.push(known)
        continue
      }
      const text = await fs.readFile(path, 'utf8').catch(() => '')
      const chat: Seen = {
        id: name.slice(0, -'.jsonl'.length),
        path,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        title: chatTitle(text),
        isVSCode: text.includes('"entrypoint":"claude-vscode"'),
        cache: cacheState(text),
      }
      seen.set(path, chat)
      found.push(chat)
    }
  }
  return found
}

function showCopied(item: vscode.StatusBarItem): void {
  item.text = '✓ Handoff copied!'
  item.color = new vscode.ThemeColor('charts.green')
  item.backgroundColor = undefined
  item.show()
}

async function copyHandoff(item: vscode.StatusBarItem): Promise<void> {
  try {
    const chat = pickChat(await listChats(), activeClaudeLabel())
    if (chat === undefined) {
      void vscode.window.showInformationMessage('HandoffBar: no Claude Code chat found for this folder yet.')
      return
    }
    const text = buildHandoff(await fs.readFile(chat.path, 'utf8'), chat.path)
    await fs.mkdir(handoffsDir, { recursive: true })
    await fs.writeFile(join(handoffsDir, `${chat.id}.md`), text)
    await vscode.env.clipboard.writeText(text)
    copiedUntil = Date.now() + copiedMs
    showCopied(item)
  } catch (error) {
    void vscode.window.showErrorMessage(`HandoffBar could not copy the handoff: ${String(error)}`)
  }
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

async function tick(item: vscode.StatusBarItem): Promise<void> {
  const now = Date.now()
  if (now - listedAt >= listMs) {
    listedAt = now
    chats = await listChats()
  }
  if (now < copiedUntil) return showCopied(item)
  item.color = undefined
  const chat = pickChat(
    chats.filter(c => now - c.mtimeMs < longestCacheMs),
    activeClaudeLabel(),
  ) as Seen | undefined
  if (chat === undefined) return item.hide()

  const state = chat.cache
  // A compaction after the last reply ends the cache then. No cache write found: no countdown, not a guess.
  const end = state?.compactedAt ?? (state?.cache === undefined ? undefined : state.lastRequest + state.cache * 1000)
  const left = end === undefined ? undefined : Math.ceil((end - now) / 1000)
  const name = chat.title === '' ? 'this chat' : `"${chat.title}"`
  if (state === undefined) {
    item.text = '👉 Cache: waiting for first reply'
    item.backgroundColor = undefined
  } else if (left === undefined) {
    item.text = '👉 Copy handoff'
    item.backgroundColor = undefined
  } else if (left > 0) {
    item.text = `👉 Cache ${clock(left)} left`
    item.backgroundColor = undefined
  } else {
    const minutes = Math.floor(-left / 60)
    item.text = `👉 Cache expired ${minutes === 0 ? 'just now' : `${minutes} min ago`}`
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
  }
  item.tooltip = `HandoffBar: prompt cache of ${name}. Click to copy its handoff.`
  item.show()
}

export function activate(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  item.command = 'handoffbar.copy'
  let isTicking = false
  const timer = setInterval(() => {
    if (isTicking) return
    isTicking = true
    tick(item)
      .catch(() => item.hide())
      .finally(() => (isTicking = false))
  }, tickMs)

  context.subscriptions.push(
    vscode.commands.registerCommand('handoffbar.copy', () => copyHandoff(item)),
    item,
    { dispose: () => clearInterval(timer) },
  )
}

export function deactivate(): void {}

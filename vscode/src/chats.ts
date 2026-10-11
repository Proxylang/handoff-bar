// Which chat file belongs to the Claude tab the person is looking at. The Claude extension names
// its tab after the chat's title, so the title is the link; when no title matches, the newest
// VS Code chat in the open folders is the one.

export type ChatFile = { id: string; path: string; mtimeMs: number; title: string; isVSCode: boolean }

// The Claude extension's tab title for a chat with no title yet.
const untitled = 'Claude Code'
// The Claude extension cuts tab titles longer than this to 24 characters and an ellipsis.
const tabChars = 25

/** Claude Code names a chat's project folder after its working folder, every other character a dash. */
export function projectFolderName(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-')
}

/** The title as the Claude extension draws it on the tab. */
export function tabLabel(title: string): string {
  return title.length > tabChars ? `${title.slice(0, tabChars - 1)}…` : title
}

/** The chat's title: the last name the user gave the tab, else the last AI title. */
export function chatTitle(text: string): string {
  let ai = ''
  let custom = ''
  for (const line of text.split('\n')) {
    // Only title rows are parsed: they are short, and a chat file can be many megabytes.
    if (!line.includes('-title"')) continue
    try {
      const o = JSON.parse(line) as { type?: unknown; aiTitle?: unknown; customTitle?: unknown }
      if (o.type === 'ai-title' && typeof o.aiTitle === 'string') ai = o.aiTitle
      if (o.type === 'custom-title' && typeof o.customTitle === 'string') custom = o.customTitle
    } catch {
      // A line cut off mid-write.
    }
  }
  return custom || ai
}

/** The chat behind a tab labelled `label`; undefined label means no tab (the sidebar). */
export function pickChat(chats: ChatFile[], label: string | undefined): ChatFile | undefined {
  const newest = (list: ChatFile[]) => list.reduce<ChatFile | undefined>((a, b) => (a && a.mtimeMs >= b.mtimeMs ? a : b), undefined)
  const matched = label && label !== untitled ? chats.filter(c => c.title !== '' && tabLabel(c.title) === label) : []
  return newest(matched) ?? newest(chats.filter(c => c.isVSCode))
}

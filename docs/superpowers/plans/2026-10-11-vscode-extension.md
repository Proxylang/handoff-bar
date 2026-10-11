# HandoffBar for VS Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code extension that puts a HandoffBar hand icon in the title bar of every Claude Code chat tab and the Claude sidebar. One click writes and copies that chat's handoff. A status bar item shows the open chat's cache countdown.

**Architecture:** Plain VS Code extension in `vscode/`. It reuses the mod's writer (`mod/hooks/writer.ts`, the byte-for-byte port of `Sources/Writer.swift`) through an esbuild bundle. It never touches the Claude panel itself. VS Code does not let one extension change another's webview. It adds menu items to `editor/title` (when the active webview panel is `claudeVSCodePanel`) and `view/title` (the Claude sidebar views).

**Tech Stack:** TypeScript, VS Code API 1.90+, esbuild (bundle), node:test (tests). No runtime dependencies.

**Spec:** the design approved in chat on 2026-10-11 (icon in the chat tab's title bar, hover tip, click copies, nothing sent to Claude, status bar countdown).

## Global Constraints

- Nothing is ever sent to Claude. The extension only reads `~/.claude/projects` and writes `~/.claude/handoffs/<chat id>.md`.
- No network requests. No runtime dependencies.
- The handoff text must be the same bytes the Mac app writes: use `buildHandoff` from `mod/hooks/writer.ts`, unchanged.
- Icon: our own SVG of a hand pointing right. Not an SF Symbol (Apple's license limits SF Symbols to Apple platforms).
- Copy: plain words, no marketing adjectives.

## Review Focus

- The tab title is cut to 25 characters by the Claude extension (`aN1`: over 25 → first 24 + "…"); matching must cut the chat title the same way.
- Two chats with the same title: take the newest file.
- No matching title (tab still says "Claude Code", or the sidebar): take the newest `claude-vscode` chat in the open folders.
- A chat file with no reply yet: copy still works (handoff of the prompts); the countdown says "waiting for first reply".
- Temp project folders (`-private-var-folders-`, `-private-tmp`, `-tmp`) are never picked.

---

### Task 1: Chat picking (pure functions, tested)

**Files:**
- Create: `vscode/src/chats.ts`
- Test: `vscode/test/chats.test.ts`

**Interfaces:**
- Produces: `projectFolderName(dir: string): string`, `tabLabel(title: string): string`, `chatTitle(text: string): string`, `pickChat(chats: ChatFile[], label: string | undefined): ChatFile | undefined`, `type ChatFile = { id: string; path: string; mtimeMs: number; title: string; isVSCode: boolean }`.

- [ ] Write tests: label cut at 25; custom title beats AI title; title match wins over newer file; same title picks newest; no match picks newest VS Code chat; label "Claude Code" counts as no match.
- [ ] Run `node --test` on the bundled test: fails (module missing).
- [ ] Implement `chats.ts`.
- [ ] Run tests: pass.

### Task 2: Extension entry, command, menus, status bar

**Files:**
- Create: `vscode/package.json`, `vscode/src/extension.ts`, `vscode/tsconfig.json`, `vscode/media/hand-light.svg`, `vscode/media/hand-dark.svg`, `vscode/media/icon.png` (copy of `site/icon.png`), `vscode/README.md`, `vscode/LICENSE` (copy), `vscode/.vscodeignore`

**Interfaces:**
- Consumes: Task 1 functions; `buildHandoff`, `cacheState`, `tempProjectPrefixes` from `mod/hooks/writer.ts`.
- Produces: command `handoffbar.copy`.

- [ ] `package.json` contributes the command (title "Copy handoff for this chat", hand icon), `editor/title` menu when `activeWebviewPanelId == 'claudeVSCodePanel'`, `view/title` menu when `view == claudeVSCodeSidebar || view == claudeVSCodeSidebarSecondary`.
- [ ] `extension.ts`: on click, find the active Claude tab's label, list chat files for the open folders, pick, write the handoff, copy with `vscode.env.clipboard`, show "Handoff copied. Paste it into a new chat."
- [ ] Status bar item: once a second, for the picked chat, show "Cache 3:12 left" or "Cache expired 5 min ago"; read the file again only when its mtime changes; hidden when no Claude tab is open. Click runs the copy command.
- [ ] Type-check with `tsc --noEmit`.

### Task 3: Build, package, install locally

**Files:**
- Create: `vscode/build.sh` (esbuild bundle + hand-made `.vsix` zip: `extension.vsixmanifest`, `[Content_Types].xml`, `extension/`).

- [ ] Build `vscode/dist/handoffbar-0.1.0.vsix`.
- [ ] Install with `code --install-extension`.
- [ ] Check the extension is listed by `code --list-extensions`.

### Task 4: Site and README

- [ ] Site "Inside Claude Code" section: the VS Code line points to the extension instead of saying VS Code can't show buttons.

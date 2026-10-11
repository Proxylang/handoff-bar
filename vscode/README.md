# HandoffBar for Claude Code

When a Claude Code chat sits idle too long, its prompt cache expires and your next message re-sends the whole chat at full price. A short handoff in a new chat is cheaper.

This extension adds a hand icon to the title bar of every Claude Code chat tab and to the Claude sidebar. Click it and the chat's handoff is on your clipboard. Paste it into a new chat and keep going.

![The orange hand icon at the top right of a Claude chat tab, with the tip "Copy handoff for this chat"](https://handoffbar.proxylang.dev/vscode-copy-handoff.jpg)

- **One click, nothing sent.** The icon copies the handoff. It does not type into the chat, so the old chat is never re-sent.
- **Cache countdown.** The status bar shows how long the open chat's cache has left, and turns yellow once it expires.
- **Same handoff as the app.** It writes `~/.claude/handoffs/<chat id>.md`, the same file the HandoffBar Mac and Windows apps write.

## What it reads and writes

It reads the chat files Claude Code already saves in `~/.claude/projects`. It writes one Markdown file per chat in `~/.claude/handoffs`. It makes no network requests and has no dependencies.

MIT licensed. Source: [github.com/Proxylang/handoff-bar](https://github.com/Proxylang/handoff-bar). Not affiliated with Anthropic.

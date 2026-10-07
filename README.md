<a href="https://proxylang.dev/?utm_source=handoffbar&utm_medium=github&utm_campaign=getstarted15"><img src="site/proxylang-banner.png" width="880" alt="Made by Proxylang. Proxylang translates websites: 77 languages from one line of code. 15% off your first month."></a>

<p align="center"><img src="site/icon.png" width="128" alt="HandoffBar icon"></p>

<h1 align="center">HandoffBar</h1>

<p align="center">Pick up any <a href="https://claude.com/claude-code">Claude Code</a> chat where you left off.<br>
<a href="https://github.com/Proxylang/handoff-bar/releases/latest/download/HandoffBar.dmg"><b>Download for Mac</b></a> · <a href="https://handoffbar.proxylang.dev">Website</a></p>

<p align="center"><picture>
<source media="(prefers-color-scheme: dark)" srcset="site/panel-dark.png">
<img src="site/panel-light.png" width="380" alt="The HandoffBar panel: a search box above recent chats with titles, project names, and times">
</picture></p>

## What it does

Claude Code caches each chat so replies stay fast and cheap. Leave a chat alone too long and the cache expires. The next message then re-reads the whole chat at full price.

HandoffBar watches your chats. A few minutes before a chat's cache expires, it saves a **handoff**: a short Markdown summary of that chat. Click the hand in your menu bar, click the chat, and paste the handoff into a new Claude Code chat to keep going.

## Features

- **Saves handoffs on time.** Each chat's handoff is written a few minutes before its cache expires. HandoffBar works out per chat whether the cache lasts 5 minutes or 1 hour.
- **One click to copy.** Click a chat and its handoff prompt is on your clipboard, ready to paste.
- **Search.** Type to filter by chat title, project, or chat id. Search covers every saved handoff.
- **Your tab names.** Chats show the name you gave the tab, even if you rename it after the handoff was saved.
- **Easy to scan.** Chats are grouped by day, with the project and how long ago. Hover a chat to see your last request.
- **Open at login.** One checkbox keeps it running after a restart.
- **Light and dark mode.** Follows your Mac's setting.
- **Local only.** No network calls, no account, no model calls.

## What a handoff contains

- The chat's title (the name you gave the tab, or the title Claude Code generated)
- The working folder, git branch, and path to the old chat file
- Your first request and your last 10 requests
- The files the chat edited
- Claude's last reply

Handoffs are saved in `~/.claude/handoffs/`, one file per chat, named by chat id.

## When handoffs are written

Each Claude Code chat gets a cache that lasts either 5 minutes or 1 hour. HandoffBar checks your chat files in `~/.claude/projects/` once a minute and reads which cache each chat got from the usage data Claude Code saves. Then it writes the handoff:

- 5 minutes before a 1-hour cache expires
- 2 minutes before a 5-minute cache expires

A new reply in that chat resets the timer. Chats started in a temp folder (usually scripts running Claude Code) are skipped.

## Privacy

Everything happens on your Mac. HandoffBar makes no network calls, needs no account, and calls no model. It only reads the chat files Claude Code already keeps and writes Markdown files next to them.

## Install

1. Download [HandoffBar.dmg](https://github.com/Proxylang/handoff-bar/releases/latest/download/HandoffBar.dmg).
2. Open it and drag HandoffBar into Applications.
3. Open HandoffBar, click the hand in your menu bar, and tick **Open at login**.

Needs macOS 13 or later. Works on Apple Silicon and Intel. The app is signed and notarized by Apple.

If you use a menu bar manager such as Ice or Bartender, it may hide the new icon. Drag it into the visible part of the menu bar.

## Build from source

```
./build.sh
```

This builds the app, signs it, copies it to `~/Applications`, and starts it. It needs Apple's command line tools (`xcode-select --install`). Without a Developer ID certificate the app is signed for your Mac only.

To make a notarized download, store a notarytool keychain profile first, then run:

```
./build.sh release <profile name>
```

The installer lands in `dist/HandoffBar.dmg`, with a zip of the app next to it.

To redraw the app icon:

```
swift tools/make-icon.swift
iconutil -c icns AppIcon.iconset -o AppIcon.icns
```

The website is the static `site/` folder.

## Made by Proxylang

HandoffBar is made by [Proxylang](https://proxylang.dev). Proxylang translates websites into 77+ languages. Add one line of code and your site is live in other languages in about a minute, with per-language SEO built in.

HandoffBar is not affiliated with Anthropic. MIT licensed.

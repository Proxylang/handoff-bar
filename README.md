# HandoffBar

A menu bar app for [Claude Code](https://claude.com/claude-code) on macOS.

Claude Code caches each chat's context so replies stay fast and cheap. The cache expires after a period of no activity: 1 hour on Claude Max, 5 minutes on Pro and the API. When a chat's cache is about to expire, HandoffBar writes a handoff: a short summary of the chat that you paste into a new chat to pick up where you left off.

Click the hand in the menu bar to see your recent chats. Click one to copy its handoff prompt.

## What a handoff contains

- The chat's title (the name you gave the tab, or the title Claude Code generated)
- The working folder, git branch, and path to the old chat file
- Your first request and your last 10 requests
- The files the chat edited
- Claude's last reply

Handoffs are plain Markdown files in `~/.claude/handoffs/`, one per chat, named by chat id.

## When handoffs are written

HandoffBar checks your chat files in `~/.claude/projects/` once a minute. It reads each chat's cache length from the usage data Claude Code saves, then writes the handoff:

- 5 minutes before a 1-hour cache expires
- 2 minutes before a 5-minute cache expires

A new reply in that chat resets the timer. Everything happens on your Mac. HandoffBar makes no network calls and calls no model.

## Install

1. Download `HandoffBar.zip` from the latest release and unzip it.
2. Move `HandoffBar.app` to your Applications folder and open it.
3. Click the hand in the menu bar and tick **Open at login**.

Needs macOS 13 or later. Works on Apple Silicon and Intel.

If you use a menu bar manager such as Ice or Bartender, it may hide the new icon. Drag it into the visible part of the menu bar.

## Build from source

```
./build.sh
```

This builds the app, signs it, copies it to `~/Applications`, and starts it. It needs Apple's command line tools (`xcode-select --install`).

To make a notarized download, store a notarytool keychain profile first, then run:

```
./build.sh release <profile name>
```

The zip lands in `dist/HandoffBar.zip`.

To redraw the app icon:

```
swift tools/make-icon.swift
iconutil -c icns AppIcon.iconset -o AppIcon.icns
```

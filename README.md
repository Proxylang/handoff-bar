<a href="https://proxylang.dev/?utm_source=handoffbar&utm_medium=github&utm_campaign=getstarted15"><img src="site/proxylang-banner.png" width="880" alt="Made by Proxylang. Proxylang translates websites: 77 languages from one line of code. 15% off your first month."></a>

<p align="center"><img src="site/icon.png" width="128" alt="HandoffBar icon"></p>

<h1 align="center">HandoffBar</h1>

<p align="center">Pick up any <a href="https://claude.com/claude-code">Claude Code</a> chat where you left off.<br>
Claude Code 대화를 멈춘 곳에서 그대로 이어가세요.<br>
<a href="https://github.com/Proxylang/handoff-bar/releases/latest/download/HandoffBar.dmg"><b>Download for Mac · Mac용 다운로드</b></a> · <a href="https://handoffbar.proxylang.dev">Website · 웹사이트</a></p>

<p align="center"><picture>
<source media="(prefers-color-scheme: dark)" srcset="site/panel-dark.png">
<img src="site/panel-light.png" width="380" alt="The HandoffBar panel: a search box above recent chats with titles, project names, and times">
</picture></p>

## What it does · 하는 일

Claude Code caches each chat so replies stay fast and cheap. Leave a chat alone too long and the cache expires. The next message then re-reads the whole chat at full price.

You can see when this happens. Claude Code shows a red clock in the message box, and hovering it says the cache expired:

<p align="center"><img src="site/cache-expired.jpg" width="530" alt="Claude Code message box with a red clock. The tooltip says: Prompt cache likely expired (idle 1h 2m)."></p>

HandoffBar saves you before that point. A few minutes before a chat's cache expires, it saves a **handoff**: a short Markdown summary of that chat. Click the hand in your menu bar, click the chat, and paste the handoff into a new Claude Code chat to keep going.

**한국어**

Claude Code는 대화마다 캐시를 저장해서 답변을 빠르고 저렴하게 유지합니다. 대화를 너무 오래 두면 캐시가 만료되고, 다음 메시지는 대화 전체를 정가로 다시 읽습니다.

캐시가 만료되면 Claude Code 입력창에 빨간 시계가 나타납니다. 마우스를 올리면 위 그림처럼 "Prompt cache likely expired (idle 1h 2m)"라고 표시됩니다.

HandoffBar는 그 전에 대비합니다. 캐시가 만료되기 몇 분 전에 **핸드오프**를 저장합니다. 핸드오프는 그 대화를 짧게 정리한 Markdown 요약입니다. 메뉴 막대의 손 아이콘을 누르고 대화를 클릭한 다음, 새 Claude Code 대화에 붙여넣으면 이어서 작업할 수 있습니다.

## Features · 기능

- **Saves handoffs on time.** Each chat's handoff is written a few minutes before its cache expires. HandoffBar works out per chat whether the cache lasts 5 minutes or 1 hour.
- **One click to copy.** Click a chat and its handoff prompt is on your clipboard, ready to paste.
- **Search.** Type to filter by chat title, project, or chat id. Search covers every saved handoff.
- **Your tab names.** Chats show the name you gave the tab, even if you rename it after the handoff was saved.
- **Easy to scan.** Chats are grouped by day, with the project and how long ago. Hover a chat to see your last request.
- **Open at login.** One checkbox keeps it running after a restart.
- **Light and dark mode.** Follows your Mac's setting.
- **Local only.** No network calls, no account, no model calls.

**한국어**

- **제때 저장.** 캐시가 만료되기 몇 분 전에 대화별 핸드오프를 저장합니다. 대화마다 캐시가 5분인지 1시간인지 직접 확인합니다.
- **클릭 한 번으로 복사.** 대화를 클릭하면 핸드오프 프롬프트가 클립보드에 복사됩니다.
- **검색.** 대화 제목, 프로젝트, 대화 ID로 걸러 볼 수 있습니다. 저장된 모든 핸드오프를 검색합니다.
- **내가 붙인 탭 이름.** 핸드오프를 저장한 뒤에 탭 이름을 바꿔도 새 이름으로 보입니다.
- **한눈에 보기.** 날짜별로 묶고, 프로젝트와 경과 시간을 함께 보여줍니다. 대화에 마우스를 올리면 마지막 요청이 보입니다.
- **로그인 시 실행.** 체크박스 하나로 Mac을 다시 켜도 계속 실행됩니다.
- **라이트·다크 모드.** Mac 설정을 따릅니다.
- **로컬 전용.** 네트워크 호출, 계정, 모델 호출이 없습니다.

## What a handoff contains · 핸드오프에 담기는 내용

- The chat's title (the name you gave the tab, or the title Claude Code generated)
- The working folder, git branch, and path to the old chat file
- Your first request and your last 10 requests
- The files the chat edited
- Claude's last reply

Handoffs are saved in `~/.claude/handoffs/`, one file per chat, named by chat id.

**한국어**

- 대화 제목 (탭에 붙인 이름, 또는 Claude Code가 만든 제목)
- 작업 폴더, git 브랜치, 이전 대화 파일 경로
- 첫 요청과 최근 요청 10개
- 대화에서 수정한 파일
- Claude의 마지막 답변

핸드오프는 `~/.claude/handoffs/`에 대화마다 파일 하나씩, 대화 ID를 파일 이름으로 저장됩니다.

## When handoffs are written · 핸드오프 저장 시점

Each Claude Code chat gets a cache that lasts either 5 minutes or 1 hour. HandoffBar checks your chat files in `~/.claude/projects/` once a minute and reads which cache each chat got from the usage data Claude Code saves. Then it writes the handoff:

- 5 minutes before a 1-hour cache expires
- 2 minutes before a 5-minute cache expires

A new reply in that chat resets the timer. Chats started in a temp folder (usually scripts running Claude Code) are skipped.

**한국어**

Claude Code 대화의 캐시는 5분 또는 1시간 동안 유지됩니다. HandoffBar는 1분마다 `~/.claude/projects/`의 대화 파일을 확인하고, Claude Code가 저장한 사용량 데이터에서 대화별 캐시 길이를 읽습니다. 그리고 다음 시점에 핸드오프를 저장합니다.

- 1시간 캐시: 만료 5분 전
- 5분 캐시: 만료 2분 전

그 대화에 새 답변이 오면 타이머가 다시 시작됩니다. 임시 폴더에서 시작된 대화(보통 Claude Code를 실행하는 스크립트)는 건너뜁니다.

## Privacy · 개인정보

Everything happens on your Mac. HandoffBar makes no network calls, needs no account, and calls no model. It only reads the chat files Claude Code already keeps and writes Markdown files next to them.

**한국어**

모든 작업은 내 Mac 안에서만 이루어집니다. 네트워크 호출, 계정, 모델 호출이 없습니다. Claude Code가 이미 저장하고 있는 대화 파일만 읽고, 그 옆에 Markdown 파일을 씁니다.

## Install · 설치

1. Download [HandoffBar.dmg](https://github.com/Proxylang/handoff-bar/releases/latest/download/HandoffBar.dmg).
2. Open it and drag HandoffBar into Applications.
3. Open HandoffBar, click the hand in your menu bar, and tick **Open at login**.

Needs macOS 13 or later. Works on Apple Silicon and Intel. The app is signed and notarized by Apple.

If you use a menu bar manager such as Ice or Bartender, it may hide the new icon. Drag it into the visible part of the menu bar.

**한국어**

1. [HandoffBar.dmg](https://github.com/Proxylang/handoff-bar/releases/latest/download/HandoffBar.dmg)를 다운로드합니다.
2. 파일을 열고 HandoffBar를 응용 프로그램 폴더로 끌어다 놓습니다.
3. HandoffBar를 실행하고, 메뉴 막대의 손 아이콘을 누른 뒤 **Open at login**을 체크합니다.

macOS 13 이상이 필요하며 Apple Silicon과 Intel을 모두 지원합니다. Apple의 서명과 공증을 받은 앱입니다.

Ice나 Bartender 같은 메뉴 막대 관리 앱을 쓰면 새 아이콘이 숨겨질 수 있습니다. 아이콘을 메뉴 막대의 보이는 쪽으로 끌어다 놓으세요.

## Build from source · 소스에서 빌드

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

**한국어**

`./build.sh`는 앱을 빌드하고 서명한 뒤 `~/Applications`에 복사해서 실행합니다. Apple 명령줄 도구가 필요합니다(`xcode-select --install`). Developer ID 인증서가 없으면 빌드한 Mac에서만 실행되도록 서명됩니다.

공증된 설치 파일을 만들려면 먼저 notarytool 키체인 프로필을 저장하고 `./build.sh release <프로필 이름>`을 실행합니다. 설치 파일은 `dist/HandoffBar.dmg`에, 앱 zip 파일은 그 옆에 생깁니다.

앱 아이콘은 위의 두 명령으로 다시 그릴 수 있습니다. 웹사이트는 정적 파일로 된 `site/` 폴더입니다.

## Made by Proxylang · 만든 곳

HandoffBar is made by [Proxylang](https://proxylang.dev). Proxylang translates websites into 77+ languages. Add one line of code and your site is live in other languages in about a minute, with per-language SEO built in.

HandoffBar is not affiliated with Anthropic. MIT licensed.

**한국어**

HandoffBar는 [Proxylang](https://proxylang.dev)이 만들었습니다. Proxylang은 웹사이트를 77개 이상의 언어로 번역합니다. 코드 한 줄만 추가하면 약 1분 만에 다른 언어로 사이트가 열리고, 언어별 SEO도 기본으로 들어갑니다.

HandoffBar는 Anthropic과 관련이 없습니다. MIT 라이선스입니다.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chatTitle, pickChat, projectFolderName, tabLabel, type ChatFile } from '../src/chats'

const chat = (id: string, title: string, mtimeMs: number, isVSCode = true): ChatFile => ({
  id,
  path: `/p/${id}.jsonl`,
  mtimeMs,
  title,
  isVSCode,
})

test('the project folder is the working folder with every other character as a dash', () => {
  assert.equal(projectFolderName('/Users/me/Documents/github/WORKING_DOCS'), '-Users-me-Documents-github-WORKING-DOCS')
})

test('the tab label is the title cut the way the Claude extension cuts it', () => {
  assert.equal(tabLabel('Short title'), 'Short title')
  assert.equal(tabLabel('x'.repeat(25)), 'x'.repeat(25))
  assert.equal(tabLabel('x'.repeat(26)), `${'x'.repeat(24)}…`)
})

test('a name the user gave the tab beats the AI title', () => {
  const text = [
    { type: 'ai-title', aiTitle: 'AI name' },
    { type: 'custom-title', customTitle: 'My name' },
    { type: 'ai-title', aiTitle: 'Later AI name' },
  ]
    .map(row => JSON.stringify(row))
    .join('\n')
  assert.equal(chatTitle(text), 'My name')
  assert.equal(chatTitle(JSON.stringify({ type: 'ai-title', aiTitle: 'Only AI' })), 'Only AI')
  assert.equal(chatTitle('not json\n'), '')
})

test('the chat whose title matches the tab wins over a newer chat', () => {
  const chats = [chat('a', 'Fix login', 1), chat('b', 'Other work', 2)]
  assert.equal(pickChat(chats, 'Fix login')?.id, 'a')
})

test('two chats with the same title: the newest wins', () => {
  const chats = [chat('a', 'Fix login', 1), chat('b', 'Fix login', 3), chat('c', 'Fix login', 2)]
  assert.equal(pickChat(chats, 'Fix login')?.id, 'b')
})

test('no title match, or the tab still says Claude Code: the newest VS Code chat', () => {
  const chats = [chat('a', 'One', 1), chat('b', 'Two', 2), chat('c', 'Three', 3, false)]
  assert.equal(pickChat(chats, 'Nothing like it')?.id, 'b')
  assert.equal(pickChat(chats, 'Claude Code')?.id, 'b')
  assert.equal(pickChat(chats, undefined)?.id, 'b')
  assert.equal(pickChat([], undefined), undefined)
})

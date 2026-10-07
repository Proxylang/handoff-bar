// Writes a handoff file for each Claude Code chat whose prompt cache is about to expire.
// No model call, no network: everything comes from the chat files in ~/.claude/projects.
import Foundation

let claudeDir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude")
let projectsDir = claudeDir.appendingPathComponent("projects")
let handoffDir = claudeDir.appendingPathComponent("handoffs")

// How often to check the chat files. One minute is fine-grained enough for a 2-5 minute warning.
let scanInterval: TimeInterval = 60
// The longest cache Anthropic offers. A chat file untouched for longer has no live cache.
let longestCache: TimeInterval = 3600
// Chats with a 5-minute cache (Pro, API) get a shorter warning than 1-hour chats (Max),
// or the handoff would be written the moment each reply lands.
func warnSeconds(cache: TimeInterval) -> TimeInterval { cache >= longestCache ? 300 : 120 }
// Enough of the file end to hold the last few replies and their cache usage.
let tailBytes = 512 * 1024
// Claude Code names a chat's project folder after its working folder. These are temp folders,
// used by scripts that run helper chats. Those are not the user's chats.
let tempProjectPrefixes = ["-private-var-folders-", "-private-tmp", "-tmp"]

// Recent prompts show where the chat is heading. Ten is enough without bloat.
let recentPrompts = 10
// Cut each prompt so one pasted log cannot fill the file.
let promptChars = 500
let lastReplyChars = 1500
let maxFiles = 40

final class HandoffWriter {
    private let queue = DispatchQueue(label: "handoff-writer", qos: .utility)
    private var timer: DispatchSourceTimer?
    // Chat file path -> the last request a handoff was written for. A new reply re-arms the chat.
    private var written: [String: Date] = [:]
    private let onWrite: () -> Void

    init(onWrite: @escaping () -> Void) { self.onWrite = onWrite }

    func start() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: scanInterval)
        t.setEventHandler { [weak self] in self?.scan() }
        t.resume()
        timer = t
    }

    private func scan() {
        let now = Date()
        let fm = FileManager.default
        var wrote = false
        let projects = (try? fm.contentsOfDirectory(atPath: projectsDir.path)) ?? []
        for project in projects where !tempProjectPrefixes.contains(where: project.hasPrefix) {
            let dir = projectsDir.appendingPathComponent(project)
            // Top-level chat files only. Subagent files sit in subfolders.
            let chats = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            for chat in chats where chat.pathExtension == "jsonl" {
                guard let mtime = try? chat.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                      now.timeIntervalSince(mtime) < longestCache,
                      let (lastRequest, cache) = cacheState(chat) else { continue }
                let left = lastRequest.addingTimeInterval(cache).timeIntervalSince(now)
                guard left > 0, left <= warnSeconds(cache: cache), written[chat.path] != lastRequest else { continue }
                written[chat.path] = lastRequest
                if writeHandoff(chat) { wrote = true }
            }
        }
        if wrote { DispatchQueue.main.async(execute: onWrite) }
    }
}

// MARK: - Reading chat files

private let isoDate: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

private func jsonLines(_ data: Data) -> [[String: Any]] {
    data.split(separator: UInt8(ascii: "\n")).compactMap {
        try? JSONSerialization.jsonObject(with: Data($0)) as? [String: Any]
    }
}

/// Time of the last reply and the chat's cache length, read from the end of the chat file.
/// The API reports which cache a request wrote: `ephemeral_1h_input_tokens` or `ephemeral_5m_input_tokens`.
func cacheState(_ chat: URL) -> (Date, TimeInterval)? {
    guard let handle = try? FileHandle(forReadingFrom: chat) else { return nil }
    defer { try? handle.close() }
    let size = (try? handle.seekToEnd()) ?? 0
    try? handle.seek(toOffset: size > UInt64(tailBytes) ? size - UInt64(tailBytes) : 0)
    guard let data = try? handle.readToEnd() else { return nil }

    var lastRequest: Date?
    var cache: TimeInterval?
    for o in jsonLines(data).reversed() where o["type"] as? String == "assistant" && o["isSidechain"] as? Bool != true {
        if lastRequest == nil, let ts = o["timestamp"] as? String { lastRequest = isoDate.date(from: ts) }
        let usage = (o["message"] as? [String: Any])?["usage"] as? [String: Any]
        let created = usage?["cache_creation"] as? [String: Any]
        if (created?["ephemeral_1h_input_tokens"] as? Int ?? 0) > 0 { cache = 3600 }
        else if (created?["ephemeral_5m_input_tokens"] as? Int ?? 0) > 0 { cache = 300 }
        if lastRequest != nil, cache != nil { break }
    }
    guard let lastRequest else { return nil }
    // No cache write in the file end means only cache reads. The default API cache is 5 minutes.
    return (lastRequest, cache ?? 300)
}

// Blocks the harness adds to user messages. They are not the user's words.
private let harnessBlocks = try! NSRegularExpression(
    pattern: "<(system-reminder|browser_instruction|local-command-caveat)>.*?</\\1>",
    options: [.dotMatchesLineSeparators])
// Skill bodies and background-task events arrive as user messages but are not the user's words.
private let notUserPrefixes = ["[Request interrupted", "Base directory for this skill", "<task-notification>"]

private func userText(_ o: [String: Any]) -> String {
    let content = (o["message"] as? [String: Any])?["content"]
    let parts: [String]
    if let s = content as? String {
        parts = [s]
    } else {
        parts = (content as? [[String: Any]] ?? []).filter { $0["type"] as? String == "text" }.map { $0["text"] as? String ?? "" }
    }
    let joined = parts.joined(separator: "\n")
    let text = harnessBlocks.stringByReplacingMatches(
        in: joined, range: NSRange(joined.startIndex..., in: joined), withTemplate: ""
    ).trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty || notUserPrefixes.contains(where: text.hasPrefix) || text.contains("[SYSTEM NOTIFICATION") { return "" }
    return text
}

private func cut(_ s: String, _ n: Int) -> String { s.count <= n ? s : s.prefix(n) + " ..." }

/// Builds ~/.claude/handoffs/<chat id>.md. Returns false if the file could not be read or written.
func writeHandoff(_ chat: URL) -> Bool {
    guard let data = try? Data(contentsOf: chat) else { return false }
    var title = "", customTitle = "", cwd = "", branch = "", lastReply = ""
    var prompts: [String] = []
    var files: [String] = []  // oldest first, each path once

    for o in jsonLines(data) {
        let sidechain = o["isSidechain"] as? Bool == true
        switch o["type"] as? String {
        case "ai-title":
            title = o["aiTitle"] as? String ?? title
        case "custom-title":
            // The name the user typed when renaming the tab. Beats the AI title.
            customTitle = o["customTitle"] as? String ?? customTitle
        case "user" where !sidechain:
            // First folder, not the last: the chat may cd into a subfolder later.
            if cwd.isEmpty { cwd = o["cwd"] as? String ?? "" }
            if branch.isEmpty { branch = o["gitBranch"] as? String ?? "" }
            let text = userText(o)
            if !text.isEmpty { prompts.append(text) }
        case "assistant" where !sidechain:
            for b in (o["message"] as? [String: Any])?["content"] as? [[String: Any]] ?? [] {
                if b["type"] as? String == "text", let t = b["text"] as? String,
                   !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    lastReply = t.trimmingCharacters(in: .whitespacesAndNewlines)
                } else if b["type"] as? String == "tool_use", ["Edit", "Write"].contains(b["name"] as? String),
                          let p = (b["input"] as? [String: Any])?["file_path"] as? String {
                    files.removeAll { $0 == p }
                    files.append(p)
                }
            }
        default:
            break
        }
    }

    let session = chat.deletingPathExtension().lastPathComponent
    if !customTitle.isEmpty { title = customTitle }
    var lines = [
        "# Handoff: \(title.isEmpty ? session : title)",
        "",
        "Continue the work from an earlier chat that ran out of cache. Read this, then ask the user what to do first.",
        "",
        "- Folder: \(cwd)",
        "- Branch: \(branch.isEmpty ? "none" : branch)",
        "- Old chat file: \(chat.path)",
        "",
    ]
    if let first = prompts.first {
        lines += ["## First request", "", cut(first, promptChars * 2), ""]
        lines += ["## Recent requests, oldest first", ""]
        lines += prompts.suffix(recentPrompts).enumerated().map { "\($0.offset + 1). \(cut($0.element, promptChars))" }
        lines.append("")
    }
    if !files.isEmpty {
        lines += ["## Files changed in the old chat, oldest first", ""]
        lines += files.suffix(maxFiles).map { "- \($0)" }
        lines.append("")
    }
    if !lastReply.isEmpty {
        lines += ["## Last reply from the old chat", "", cut(lastReply, lastReplyChars), ""]
    }
    try? FileManager.default.createDirectory(at: handoffDir, withIntermediateDirectories: true)
    let out = handoffDir.appendingPathComponent(session + ".md")
    return (try? lines.joined(separator: "\n").write(to: out, atomically: true, encoding: .utf8)) != nil
}

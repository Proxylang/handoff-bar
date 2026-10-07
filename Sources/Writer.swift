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
// Claude's own summary of a chat that ran out of room. Long chats produce ~20,000 characters;
// the first part holds the goal and decisions, the rest is detail the new chat can read itself.
let summaryChars = 8000
// A reply this short is an answer to a choice ("A", "2"). Longer answers must start like one.
let decisionAnswerChars = 3
let maxDecisions = 8
let questionChars = 200
// "Pick one:" is followed by the options; keep that many so the answer makes sense.
let maxOptions = 4
let optionChars = 140
let maxBackgroundCommands = 6
let commandChars = 160
let maxNextSteps = 10
// An error followed by more tool results than this was most likely fixed already.
let recentErrorWindow = 3
let errorChars = 600

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

private func oneLine(_ s: String) -> String {
    s.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces)
}

private func blockText(_ content: Any?) -> String {
    if let s = content as? String { return s }
    return (content as? [[String: Any]] ?? []).compactMap { $0["text"] as? String }.joined(separator: "\n")
}

// A line that asks the user to choose: ends in "?", or says pick / choose / which / reply "X" or "Y".
private let questionLine = try! NSRegularExpression(
    pattern: #"\?[*_]*\s*$|\b(pick one|choose|which one)\b|reply\s+["“][^"”]{1,20}["”]\s+or\b"#,
    options: [.caseInsensitive])
// A heading that starts a list of next steps.
private let nextStepsHeading = try! NSRegularExpression(
    pattern: #"^[#*\s]*(next steps?|what you need to do next|to-?do)\b"#, options: [.caseInsensitive])
private let listItem = try! NSRegularExpression(pattern: #"^\s*([-*•]|\d+[.)])\s+"#)

private func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
    re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
}

// Starts like an answer to a choice: "A", "2", "yes", "B, please", "option 1".
private let answerStart = try! NSRegularExpression(
    pattern: #"^\s*(option\s*)?([a-d]|[1-5]|yes|yep|yeah|no|nope|ok|okay|sure|both|neither)\b"#,
    options: [.caseInsensitive])

private func plain(_ line: String) -> String {
    line.replacingOccurrences(of: #"^\s*([-*•]|\d+[.)])\s+"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: "**", with: "")
        .trimmingCharacters(in: .whitespaces)
}

/// The last line in a reply that asks the user to choose. Options listed right under it
/// ("Pick one:", "How should I land it?") come along.
private func question(in reply: String) -> String? {
    let lines = reply.split(whereSeparator: \.isNewline).map(String.init)
    // Quoted lines are drafts shown to the user, not questions to them.
    let asks = lines.indices.filter { !lines[$0].hasPrefix(">") && matches(questionLine, lines[$0]) }
    func options(after i: Int) -> ArraySlice<String> {
        lines[(i + 1)...].drop { $0.trimmingCharacters(in: .whitespaces).isEmpty }
            .prefix { matches(listItem, $0) }.prefix(maxOptions)
    }
    // "Pick one:" with its options beats a later bare "Reply A or B" that only points back at them.
    guard let i = asks.last(where: { !options(after: $0).isEmpty }) ?? asks.last else { return nil }
    var found = Array(options(after: i))
    // A bare "Reply A or B": the lettered options are elsewhere in the reply.
    if found.isEmpty { found = Array(lines.filter { matches(letteredOption, $0) }.prefix(maxOptions)) }
    return cut(plain(lines[i]), questionChars) + found.map { "\n    - " + cut(plain($0), optionChars) }.joined()
}

// "A. Wait.", "**B. Build it now.**", "- **A.** ...": a lettered option.
private let letteredOption = try! NSRegularExpression(pattern: #"^\s*(-\s+)?(\*\*)?[A-D][.):](\*\*)?\s"#)

private func isAnswer(_ text: String) -> Bool {
    text.count <= decisionAnswerChars || (text.count <= 80 && matches(answerStart, text))
}

/// The list under a "Next steps" style heading in a reply.
private func nextSteps(in reply: String) -> [String] {
    let lines = reply.split(whereSeparator: \.isNewline).map(String.init)
    guard let start = lines.lastIndex(where: { matches(nextStepsHeading, $0) }) else { return [] }
    return Array(lines[(start + 1)...].drop { $0.trimmingCharacters(in: .whitespaces).isEmpty }
        .prefix { matches(listItem, $0) }
        .prefix(maxNextSteps))
}

/// Builds ~/.claude/handoffs/<chat id>.md. Returns false if the file could not be read or written.
func writeHandoff(_ chat: URL) -> Bool {
    guard let data = try? Data(contentsOf: chat) else { return false }
    var title = "", customTitle = "", cwd = "", branch = "", lastReply = "", summary = ""
    var prompts: [String] = []
    var files: [String] = []  // oldest first, each path once
    var decisions: [String] = []
    var background: [String] = []
    var commands: [String: String] = [:]  // tool use id -> what it ran
    var lastError = "", resultsSinceError = Int.max

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
            let content = (o["message"] as? [String: Any])?["content"]
            if o["isCompactSummary"] as? Bool == true {
                // Claude Code's own summary, written when the chat ran out of room.
                summary = blockText(content)
                continue
            }
            for b in content as? [[String: Any]] ?? [] where b["type"] as? String == "tool_result" {
                resultsSinceError = resultsSinceError == Int.max ? Int.max : resultsSinceError + 1
                guard b["is_error"] as? Bool == true else { continue }
                let text = blockText(b["content"])
                // The user turning down a tool call is a choice, not a failure.
                if text.contains("doesn't want to proceed") { continue }
                let what = commands[b["tool_use_id"] as? String ?? ""].map { "\($0)\n" } ?? ""
                lastError = what + cut(text.trimmingCharacters(in: .whitespacesAndNewlines), errorChars)
                resultsSinceError = 0
            }
            let text = userText(o)
            guard !text.isEmpty else { continue }
            prompts.append(text)
            if isAnswer(text), let q = question(in: lastReply) {
                let entry = "- Asked: \(q)\n  Answer: \(oneLine(text))"
                // A message sent twice is one choice.
                if decisions.last != entry { decisions.append(entry) }
            }
        case "assistant" where !sidechain:
            for b in (o["message"] as? [String: Any])?["content"] as? [[String: Any]] ?? [] {
                let input = b["input"] as? [String: Any] ?? [:]
                if b["type"] as? String == "text", let t = b["text"] as? String,
                   !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    lastReply = t.trimmingCharacters(in: .whitespacesAndNewlines)
                } else if b["type"] as? String == "tool_use" {
                    let name = b["name"] as? String ?? ""
                    if ["Edit", "Write"].contains(name), let p = input["file_path"] as? String {
                        files.removeAll { $0 == p }
                        files.append(p)
                    }
                    if name == "Bash", let cmd = input["command"] as? String {
                        let line = cut(oneLine(cmd), commandChars)
                        commands[b["id"] as? String ?? ""] = "Command: `\(line)`"
                        if input["run_in_background"] as? Bool == true {
                            let label = (input["description"] as? String).map { "\($0): " } ?? ""
                            background.removeAll { $0.hasSuffix("`\(line)`") }
                            background.append("- \(label)`\(line)`")
                        }
                    } else if !name.isEmpty {
                        commands[b["id"] as? String ?? ""] = "Tool: \(name)"
                    }
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
    if !summary.isEmpty {
        lines += ["## Claude's summary of the earlier part of the chat", "", cut(summary, summaryChars), ""]
    }
    if let first = prompts.first {
        lines += ["## First request", "", cut(first, promptChars * 2), ""]
        lines += ["## Recent requests, oldest first", ""]
        lines += prompts.suffix(recentPrompts).enumerated().map { "\($0.offset + 1). \(cut($0.element, promptChars))" }
        lines.append("")
    }
    if !decisions.isEmpty {
        lines += ["## Choices the user made, oldest first. Do not reopen them.", ""]
        lines += decisions.suffix(maxDecisions)
        lines.append("")
    }
    let steps = nextSteps(in: lastReply)
    if !steps.isEmpty {
        lines += ["## Next steps listed at the end of the old chat", ""]
        lines += steps
        lines.append("")
    }
    if !background.isEmpty {
        lines += ["## Started in the background in the old chat. Check if still running.", ""]
        lines += background.suffix(maxBackgroundCommands)
        lines.append("")
    }
    if !lastError.isEmpty, resultsSinceError < recentErrorWindow {
        lines += ["## Last error in the old chat", "", "```", lastError, "```", ""]
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

// Reads the handoff files for the menu bar list.
import Foundation

// More than a day of busy work. Search still finds older handoffs.
let maxRows = 100
// Claude Code appends a rename to the end of the chat file. If many replies follow it,
// the chat's cache refreshes and a new handoff carries the new name anyway.
let renameTailBytes = 64 * 1024

struct Handoff: Identifiable {
    let id: String
    let url: URL
    let date: Date
    let title: String
    /// True when the tab was renamed after the handoff was written.
    let renamed: Bool
    let project: String
    let lastRequest: String
    let fromTempFolder: Bool

    init(url: URL) {
        self.url = url
        date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
        id = url.deletingPathExtension().lastPathComponent
        let lines = ((try? String(contentsOf: url, encoding: .utf8)) ?? "").components(separatedBy: "\n")
        // Line 1 is "# Handoff: <title>". A chat with no title gets its id there.
        let raw = lines.first?.replacingOccurrences(of: "# Handoff: ", with: "") ?? ""
        let chat = lines.first { $0.hasPrefix("- Old chat file: ") }.map { URL(fileURLWithPath: String($0.dropFirst(17))) }
        if let chat, let latest = latestCustomTitle(chat), latest != raw {
            title = latest
            renamed = true
        } else {
            title = raw.isEmpty || raw == id ? "Untitled chat" : raw
            renamed = false
        }
        let folder = String(lines.first { $0.hasPrefix("- Folder: ") }?.dropFirst(10) ?? "")
        fromTempFolder = !folder.hasPrefix(NSHomeDirectory())
        project = fromTempFolder ? "" : (folder as NSString).lastPathComponent
        // The last numbered line under "Recent requests" is the newest ask. Shown on hover.
        lastRequest = lines.drop { !$0.hasPrefix("## Recent requests") }
            .prefix { !$0.hasPrefix("## Files") && !$0.hasPrefix("## Last reply") }
            .last { $0.first?.isNumber == true } ?? ""
    }
}

/// The newest tab name in the end of a chat file, if the user renamed the tab.
func latestCustomTitle(_ chat: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: chat) else { return nil }
    defer { try? handle.close() }
    let size = (try? handle.seekToEnd()) ?? 0
    try? handle.seek(toOffset: size > UInt64(renameTailBytes) ? size - UInt64(renameTailBytes) : 0)
    guard let data = try? handle.readToEnd() else { return nil }
    for line in data.split(separator: UInt8(ascii: "\n")).reversed() {
        guard let o = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
              o["type"] as? String == "custom-title",
              let title = o["customTitle"] as? String, !title.isEmpty else { continue }
        return title
    }
    return nil
}

/// Newest first. Handoffs from temp-folder helper chats are left out; older versions of
/// the writer saved those too.
func loadHandoffs() -> [Handoff] {
    let files = (try? FileManager.default.contentsOfDirectory(
        at: handoffDir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    return files.filter { $0.pathExtension == "md" }
        .map(Handoff.init)
        .filter { !$0.fromTempFolder }
        .sorted { $0.date > $1.date }
}

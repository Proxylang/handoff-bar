// Reads the handoff files for the menu bar list.
import Foundation

// More than a day of busy work. Search still finds older handoffs.
let maxRows = 100

struct Handoff: Identifiable {
    let id: String
    let url: URL
    let date: Date
    let title: String
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
        title = raw.isEmpty || raw == id ? "Untitled chat" : raw
        let folder = String(lines.first { $0.hasPrefix("- Folder: ") }?.dropFirst(10) ?? "")
        fromTempFolder = !folder.hasPrefix(NSHomeDirectory())
        project = fromTempFolder ? "" : (folder as NSString).lastPathComponent
        // The last numbered line under "Recent requests" is the newest ask. Shown on hover.
        lastRequest = lines.drop { !$0.hasPrefix("## Recent requests") }
            .prefix { !$0.hasPrefix("## Files") && !$0.hasPrefix("## Last reply") }
            .last { $0.first?.isNumber == true } ?? ""
    }
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

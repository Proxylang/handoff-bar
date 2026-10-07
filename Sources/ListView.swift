// The popover shown when the menu bar hand is clicked.
import AppKit
import ServiceManagement
import SwiftUI

let popoverWidth: CGFloat = 380
// Past this height the list scrolls instead of growing.
let maxListHeight: CGFloat = 520
// Row and day-header heights, used to size the list before it scrolls.
let rowHeight: CGFloat = 60
let dayHeaderHeight: CGFloat = 26

final class Store: ObservableObject {
    @Published var handoffs: [Handoff] = []
    @Published var copiedID: String?
    @Published var openAtLogin = SMAppService.mainApp.status == .enabled
    @Published var query = ""
    /// The newer version GitHub reported, if any.
    @Published var update: String?

    /// Search covers every handoff on disk; the list shows the newest matches.
    var visible: [Handoff] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let matches = q.isEmpty ? handoffs : handoffs.filter {
            $0.title.localizedCaseInsensitiveContains(q) || $0.project.localizedCaseInsensitiveContains(q)
                || $0.id.localizedCaseInsensitiveContains(q)
        }
        return Array(matches.prefix(maxRows))
    }

    func reload() {
        handoffs = loadHandoffs()
        openAtLogin = SMAppService.mainApp.status == .enabled
    }

    func setOpenAtLogin(_ on: Bool) {
        try? on ? SMAppService.mainApp.register() : SMAppService.mainApp.unregister()
        openAtLogin = SMAppService.mainApp.status == .enabled
    }

    var days: [(label: String, items: [Handoff])] {
        var out: [(label: String, items: [Handoff])] = []
        for h in visible {
            let label = dayLabel(h.date)
            if out.last?.label == label { out[out.count - 1].items.append(h) } else { out.append((label, [h])) }
        }
        return out
    }
}

func dayLabel(_ date: Date) -> String {
    let cal = Calendar.current
    if cal.isDateInToday(date) { return "Today" }
    if cal.isDateInYesterday(date) { return "Yesterday" }
    return date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
}

func ago(_ date: Date) -> String {
    let f = RelativeDateTimeFormatter()
    f.unitsStyle = .short
    return f.localizedString(for: date, relativeTo: Date())
}

struct ListView: View {
    @ObservedObject var store: Store
    let onCopy: (Handoff) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let version = store.update {
                UpdateBar(version: version)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Handoffs").font(.system(size: 14, weight: .bold))
                Text("Click a chat to copy its handoff prompt.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)

            if !store.handoffs.isEmpty {
                SearchField(text: $store.query)
                    .padding(.horizontal, 12).padding(.bottom, 10)
            }

            Divider()

            if store.handoffs.isEmpty {
                Text("No handoffs yet. A chat shows up here a few minutes before its cache runs out.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                    .padding(16)
            } else if store.visible.isEmpty {
                Text("No chats match \u{201C}\(store.query)\u{201D}.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                    .padding(16)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(store.days, id: \.label) { day in
                            Text(day.label.uppercased())
                                .font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                                .frame(height: dayHeaderHeight, alignment: .bottomLeading)
                                .padding(.horizontal, 12)
                            ForEach(day.items) { h in
                                Row(handoff: h, copied: store.copiedID == h.id) { onCopy(h) }
                            }
                        }
                    }
                    .padding(.horizontal, 6).padding(.bottom, 6)
                }
                .frame(height: listHeight)
            }

            Divider()

            HStack(spacing: 14) {
                Toggle("Open at login", isOn: Binding(get: { store.openAtLogin }, set: store.setOpenAtLogin))
                    .toggleStyle(.checkbox).font(.system(size: 12))
                Spacer()
                FooterButton(symbol: "folder", help: "Open the handoffs folder", action: openFolder)
                FooterButton(symbol: "power", help: "Quit HandoffBar", action: quit)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .frame(width: popoverWidth)
    }

    var listHeight: CGFloat {
        let content = CGFloat(store.visible.count) * rowHeight + CGFloat(store.days.count) * dayHeaderHeight + 6
        return min(content, maxListHeight)
    }

    func openFolder() { NSWorkspace.shared.open(handoffDir) }
    func quit() { NSApp.terminate(nil) }
}

struct Row: View {
    let handoff: Handoff
    let copied: Bool
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: copied ? "checkmark.circle.fill" : "text.bubble.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(copied ? Color.green : Color.accentColor)
                    .frame(width: 20).padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(handoff.title)
                        .font(.system(size: 13, weight: .semibold)).lineLimit(1).truncationMode(.tail)
                    Text(copied ? "Copied to clipboard" : meta)
                        .font(.system(size: 11)).foregroundStyle(copied ? Color.green : Color.secondary)
                    Text(handoff.id)
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: rowHeight)
            .background(RoundedRectangle(cornerRadius: 8).fill(hover ? Color.primary.opacity(0.08) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(handoff.lastRequest.isEmpty ? "Click to copy" : "Last ask: \(handoff.lastRequest)")
    }

    var meta: String {
        [handoff.project, ago(handoff.date)].filter { !$0.isEmpty }.joined(separator: "  ·  ")
    }
}

struct UpdateBar: View {
    let version: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.down.circle.fill").font(.system(size: 14)).foregroundStyle(Color.accentColor)
            Text("Version \(version) is available").font(.system(size: 12, weight: .medium))
            Spacer()
            // Drawn by hand: the system's prominent button turns white when the panel is not the active window.
            Button(action: download) {
                Text("Download").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 12).frame(height: 24)
                    .background(Capsule().fill(Color.accentColor))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(Color.accentColor.opacity(0.1))
    }

    // Opens the new DMG in the browser. Installing it replaces this copy of the app.
    func download() { NSWorkspace.shared.open(latestDownload) }
}

struct SearchField: View {
    @Binding var text: String
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(.secondary)
            TextField("Search chats", text: $text)
                .textFieldStyle(.plain).font(.system(size: 13))
                .focused($focused)
            if !text.isEmpty {
                Button(action: clear) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 12)).foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Clear search")
            }
        }
        .padding(.horizontal, 10).frame(height: 30)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.06)))
        // Ready to type each time the panel opens.
        .onReceive(NotificationCenter.default.publisher(for: NSPopover.didShowNotification)) { _ in focused = true }
    }

    func clear() { text = "" }
}

struct FooterButton: View {
    let symbol: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 13)).foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

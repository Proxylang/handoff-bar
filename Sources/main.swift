// HandoffBar: a menu bar list of Claude Code chat handoffs.
// Writes a handoff when a chat's prompt cache is about to expire; click a row to copy it.
import AppKit
import SwiftUI

// How long the thumbs-up stays in the menu bar after a copy.
let copiedIconSeconds = 1.5

func barSymbol(_ name: String) -> NSImage? {
    let image = NSImage(systemSymbolName: name, accessibilityDescription: "Handoffs")?
        .withSymbolConfiguration(.init(pointSize: 14, weight: .medium))
    image?.isTemplate = true
    return image
}

final class App: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let popover = NSPopover()
    let store = Store()
    let icon = barSymbol("hand.point.right.fill")
    let copiedIcon = barSymbol("hand.thumbsup.fill")
    lazy var writer = HandoffWriter { [weak self] in self?.store.reload() }

    func applicationDidFinishLaunching(_ note: Notification) {
        item.button?.image = icon
        item.button?.toolTip = "Chat handoffs"
        item.button?.action = #selector(toggle)
        item.button?.target = self

        let host = NSHostingController(rootView: ListView(store: store, onCopy: copy))
        host.sizingOptions = [.preferredContentSize]
        popover.contentViewController = host
        popover.behavior = .transient

        writer.start()
    }

    @objc func toggle() {
        guard let button = item.button else { return }
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        store.copiedID = nil
        store.reload()
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    }

    func copy(_ h: Handoff) {
        guard let text = try? String(contentsOf: h.url, encoding: .utf8) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        store.copiedID = h.id
        item.button?.image = copiedIcon
        DispatchQueue.main.asyncAfter(deadline: .now() + copiedIconSeconds) { self.item.button?.image = self.icon }
    }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

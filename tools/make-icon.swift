// Draws AppIcon.icns: a white pointing hand on a rounded orange square.
// Run from the repo root: swift tools/make-icon.swift
import AppKit

let out = URL(fileURLWithPath: "AppIcon.iconset")
try? FileManager.default.removeItem(at: out)
try! FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px) / 1024

    // macOS icon grid: an 824-point rounded square centred on a 1024 canvas.
    let tile = NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
    let shape = NSBezierPath(roundedRect: tile, xRadius: 185 * s, yRadius: 185 * s)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.3)
    shadow.shadowOffset = NSSize(width: 0, height: -10 * s)
    shadow.shadowBlurRadius = 20 * s
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor.black.setFill()
    shape.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGradient(starting: NSColor(red: 1.00, green: 0.62, blue: 0.36, alpha: 1),
               ending: NSColor(red: 0.85, green: 0.33, blue: 0.24, alpha: 1))!.draw(in: shape, angle: -90)

    let config = NSImage.SymbolConfiguration(pointSize: 470 * s, weight: .regular)
        .applying(.init(paletteColors: [.white]))
    let hand = NSImage(systemSymbolName: "hand.point.right.fill", accessibilityDescription: nil)!
        .withSymbolConfiguration(config)!
    let handShadow = NSShadow()
    handShadow.shadowColor = NSColor.black.withAlphaComponent(0.18)
    handShadow.shadowOffset = NSSize(width: 0, height: -8 * s)
    handShadow.shadowBlurRadius = 16 * s
    handShadow.set()
    hand.draw(in: NSRect(x: 512 * s - hand.size.width / 2, y: 512 * s - hand.size.height / 2,
                         width: hand.size.width, height: hand.size.height))

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    try! draw(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
    try! draw(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}

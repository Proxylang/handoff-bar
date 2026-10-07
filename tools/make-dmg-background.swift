// Draws the installer window background: "Drag to Applications" with an arrow
// between the app icon (left) and the Applications folder (right).
// Run from the repo root: swift tools/make-dmg-background.swift <out.png>
import AppKit

// Window size in points. build.sh places the two icons to match.
let width: CGFloat = 640, height: CGFloat = 400
let scale: CGFloat = 2

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: width, height: height)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

NSGradient(starting: NSColor(red: 1.00, green: 0.97, blue: 0.94, alpha: 1),
           ending: NSColor(red: 0.99, green: 0.90, blue: 0.84, alpha: 1))!
    .draw(in: NSRect(x: 0, y: 0, width: width, height: height), angle: -90)

let title = NSAttributedString(string: "Drag HandoffBar into Applications", attributes: [
    .font: NSFont.systemFont(ofSize: 20, weight: .semibold),
    .foregroundColor: NSColor(red: 0.25, green: 0.16, blue: 0.13, alpha: 1)])
title.draw(at: NSPoint(x: (width - title.size().width) / 2, y: height - 70))

let sub = NSAttributedString(string: "Then open it and click the hand in your menu bar.", attributes: [
    .font: NSFont.systemFont(ofSize: 13),
    .foregroundColor: NSColor(red: 0.45, green: 0.33, blue: 0.28, alpha: 1)])
sub.draw(at: NSPoint(x: (width - sub.size().width) / 2, y: height - 96))

// Arrow between the icon centres at x=170 and x=470, y=200 from the top.
let y = height - 205
let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 262, y: y))
arrow.line(to: NSPoint(x: 370, y: y))
arrow.move(to: NSPoint(x: 356, y: y + 13))
arrow.line(to: NSPoint(x: 372, y: y))
arrow.line(to: NSPoint(x: 356, y: y - 13))
arrow.lineWidth = 5
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
NSColor(red: 0.89, green: 0.42, blue: 0.27, alpha: 1).setStroke()
arrow.stroke()

let footer = NSAttributedString(string: "Made by Proxylang.dev", attributes: [
    .font: NSFont.systemFont(ofSize: 11, weight: .medium),
    .foregroundColor: NSColor(red: 0.55, green: 0.42, blue: 0.36, alpha: 1)])
footer.draw(at: NSPoint(x: (width - footer.size().width) / 2, y: 24))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))

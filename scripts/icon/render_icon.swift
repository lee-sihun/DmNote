import AppKit

// 앱 번들의 시스템 렌더 아이콘을 PNG로 뽑는다
// 사용: render_icon <app> <out.png> <size> [--crop]
// --crop: 컨테이너 경계 기준으로 잘라 윈도우용 정사각 캔버스에 맞춘다
let args = CommandLine.arguments.filter { !$0.hasPrefix("-AppleIcon") && !$0.hasPrefix("Regular") && !$0.hasPrefix("Clear") && !$0.hasPrefix("Tinted") }
guard args.count >= 4, let size = Int(args[3]) else {
    FileHandle.standardError.write("usage: render_icon <app> <out.png> <size> [--crop]\n".data(using: .utf8)!)
    exit(2)
}
let appPath = args[1]
let outPath = args[2]
let crop = args.contains("--crop")

func bitmap(_ px: Int) -> NSBitmapImageRep {
    NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
}

let icon = NSWorkspace.shared.icon(forFile: appPath)
icon.size = NSSize(width: size, height: size)
let full = bitmap(size)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: full)
NSGraphicsContext.current?.imageInterpolation = .high
icon.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)
NSGraphicsContext.restoreGraphicsState()

var result = full
if crop {
    // 불투명 픽셀의 경계가 컨테이너, 여백은 섀도가 들어갈 만큼만
    var minX = size, minY = size, maxX = 0, maxY = 0
    for y in 0..<size {
        for x in 0..<size where (full.colorAt(x: x, y: y)?.alphaComponent ?? 0) >= 0.98 {
            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
        }
    }
    let box = maxX - minX + 1
    let pad = Int((Double(box) * 0.032).rounded())
    let side = box + pad * 2
    let origin = NSPoint(x: minX - pad, y: size - (maxY + 1) - pad)
    let out = bitmap(size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: out)
    NSGraphicsContext.current?.imageInterpolation = .high
    let src = NSImage(size: NSSize(width: size, height: size))
    src.addRepresentation(full)
    src.draw(in: NSRect(x: 0, y: 0, width: size, height: size),
             from: NSRect(x: origin.x, y: origin.y, width: CGFloat(side), height: CGFloat(side)),
             operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    result = out
}

let data = result.representation(using: .png, properties: [:])!
try! data.write(to: URL(fileURLWithPath: outPath))

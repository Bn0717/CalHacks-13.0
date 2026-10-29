// Takes screenshots of the main display for CalHack, leaving out CalHack's own windows (the bar, Stride, the pointer).
// So the person's screen recordings show CalHack, but the AI only ever sees the person's screen.
//
// Runs as a small server: CalHack starts it once with its own process id, then writes one request per line:
//   "<width> jpeg" or "<width> png"
// Each answer is a 4-byte big-endian length, then that many bytes of image. Length 0 means it failed (reason on stderr).
// Built once with swiftc into ~/.cache/calhack (see src/mac/capture.ts). Needs the Screen Recording permission.
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

let calhackPid = Int32(CommandLine.arguments.dropFirst().first ?? "") ?? -1

struct CaptureError: Error, CustomStringConvertible {
  let description: String
}

func capture(width: Int, png: Bool) async throws -> Data {
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  let mainID = CGMainDisplayID()
  guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first else {
    throw CaptureError(description: "no display")
  }
  // Leave out every window that belongs to CalHack (and to this helper).
  let mine = content.applications.filter { $0.processID == calhackPid || $0.processID == getpid() }
  let filter = SCContentFilter(display: display, excludingApplications: mine, exceptingWindows: [])
  let config = SCStreamConfiguration()
  let w = max(16, min(width, display.width * 2))
  config.width = w
  config.height = max(16, Int((Double(w) * Double(display.height) / Double(display.width)).rounded()))
  config.showsCursor = false
  let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)

  let out = NSMutableData()
  let type = (png ? UTType.png : UTType.jpeg).identifier as CFString
  guard let dest = CGImageDestinationCreateWithData(out, type, 1, nil) else { throw CaptureError(description: "no encoder") }
  let options = png ? [:] as CFDictionary : [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary
  CGImageDestinationAddImage(dest, image, options)
  guard CGImageDestinationFinalize(dest) else { throw CaptureError(description: "encode failed") }
  return out as Data
}

final class Box: @unchecked Sendable {
  var data: Data?
  var error = ""
}

func send(_ data: Data) {
  var n = UInt32(data.count).bigEndian
  let header = Data(bytes: &n, count: 4)
  FileHandle.standardOutput.write(header + data)
}

while let line = readLine() {
  let parts = line.split(separator: " ")
  let width = Int(parts.first ?? "") ?? 1456
  let png = parts.count > 1 && parts[1] == "png"
  let box = Box()
  let done = DispatchSemaphore(value: 0)
  Task.detached {
    do { box.data = try await capture(width: width, png: png) } catch { box.error = "\(error)" }
    done.signal()
  }
  if done.wait(timeout: .now() + 8) == .timedOut { box.error = "timed out" }
  if let data = box.data {
    send(data)
  } else {
    FileHandle.standardError.write(("capture failed: " + box.error + "\n").data(using: .utf8)!)
    send(Data())
  }
}

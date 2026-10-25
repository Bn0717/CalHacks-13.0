// Listens for a shortcut made only of modifier keys (default ⌥⌘): press them together, let go, and it prints "fire".
// It ignores the press if any other key or a mouse click happens while they're held, so ⌥⌘Esc, ⌥⌘-click and
// other shortcuts keep working. Usage: hotkey [command,option,control,shift]
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let names: [String: CGEventFlags] = [
  "command": .maskCommand, "cmd": .maskCommand,
  "option": .maskAlternate, "alt": .maskAlternate,
  "control": .maskControl, "ctrl": .maskControl,
  "shift": .maskShift,
]
let watched: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift]
var wanted: CGEventFlags = []
for part in (CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "command,option").split(separator: ",") {
  if let f = names[part.lowercased()] { wanted.insert(f) }
}
if wanted.isEmpty { print("{\"error\":\"no keys\"}"); exit(1) }

// A tap that's held longer than this is someone holding the keys, not a shortcut.
let maxHold: TimeInterval = 1.2
var armed = false
var spoiled = false
var armedAt = Date()

func onEvent(_ type: CGEventType, _ event: CGEvent) {
  switch type {
  case .flagsChanged:
    let now = event.flags.intersection(watched)
    if now == wanted {
      if !armed { armed = true; spoiled = false; armedAt = Date() }
    } else if now.isEmpty {
      if armed && !spoiled && Date().timeIntervalSince(armedAt) <= maxHold { print("fire") }
      armed = false
    } else if armed && !now.isSubset(of: wanted) {
      spoiled = true // another modifier joined in: a different shortcut
    }
  case .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel:
    if armed { spoiled = true }
  default:
    break
  }
}

var tap: CFMachPort?
let types: [CGEventType] = [.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]
let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask,
  callback: { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let t = tap { CGEvent.tapEnable(tap: t, enable: true) }
    } else {
      onEvent(type, event)
    }
    return Unmanaged.passUnretained(event)
  }, userInfo: nil)

guard let t = tap else {
  print("{\"error\":\"no-permission\"}")
  exit(2)
}
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: t, enable: true)
print("ready")
// Quit when CalHack does (stdin closes).
FileHandle.standardInput.readabilityHandler = { h in if h.availableData.isEmpty { exit(0) } }
CFRunLoopRun()

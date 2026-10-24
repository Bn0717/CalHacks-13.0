// CalHack's "hands" for Mac apps: reads a window's buttons, rows and fields by name (like Playwright reads a web page),
// and presses, selects or types into one of them directly. No screenshot, no mouse.
//
//   ui-elements list [app name]              → JSON: the app's front window, one entry per item you can act on
//   ui-elements act  <app name> <path> <role> <name> <press|select|focus|increase|decrease>
//   ui-elements type <app name> <path> <role> <name> <text>
//   ui-elements closesheet <app name> <Done|OK|Cancel>   → closes the panel in front, checks it closed
//
// "path" is the item's position in the window ("0.3.1"), from list. Before acting, the item at that path must still have
// the same role and name; if it moved, it is looked up again by role and name. Password boxes are never typed into.
// Needs the Accessibility permission (the same one CalHack's clicks need).
import Cocoa
import ApplicationServices

func out(_ obj: Any) {
  let data = try! JSONSerialization.data(withJSONObject: obj, options: [])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
func fail(_ message: String, _ code: Int32 = 1) -> Never {
  out(["ok": false, "error": message])
  exit(code)
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: list | act | type", 2) }
guard AXIsProcessTrusted() else { fail("not allowed assistive access (-25211)") }

func attr(_ e: AXUIElement, _ a: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil
}
func str(_ e: AXUIElement, _ a: String) -> String { (attr(e, a) as? String) ?? "" }
func children(_ e: AXUIElement) -> [AXUIElement] { (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func role(_ e: AXUIElement) -> String { str(e, kAXRoleAttribute) }
/** The words a person sees for an item: its title, else its text, else its label. */
func name(_ e: AXUIElement) -> String {
  for k in [kAXTitleAttribute, kAXDescriptionAttribute] { let s = str(e, k); if !s.isEmpty { return s } }
  if let v = attr(e, kAXValueAttribute) as? String, !v.isEmpty, role(e) != "AXTextField", role(e) != "AXSecureTextField" { return v }
  if let t = attr(e, kAXTitleUIElementAttribute) { return str(t as! AXUIElement, kAXValueAttribute) }
  return ""
}
/** Names are shortened to 80 characters in the list, so they are compared shortened too. */
func shortName(_ e: AXUIElement) -> String { String(name(e).prefix(80)) }
func frame(_ e: AXUIElement) -> [String: Int] {
  var p = CGPoint.zero, s = CGSize.zero
  if let pv = attr(e, kAXPositionAttribute) { AXValueGetValue(pv as! AXValue, .cgPoint, &p) }
  if let sv = attr(e, kAXSizeAttribute) { AXValueGetValue(sv as! AXValue, .cgSize, &s) }
  return ["x": Int(p.x), "y": Int(p.y), "w": Int(s.width), "h": Int(s.height)]
}
func actions(_ e: AXUIElement) -> [String] {
  var a: CFArray?
  AXUIElementCopyActionNames(e, &a)
  return (a as? [String]) ?? []
}

func appNamed(_ n: String?) -> NSRunningApplication? {
  if let n = n, !n.isEmpty { return NSWorkspace.shared.runningApplications.first { $0.localizedName == n } }
  return NSWorkspace.shared.frontmostApplication
}
func frontWindow(_ app: NSRunningApplication) -> AXUIElement? {
  let root = AXUIElementCreateApplication(app.processIdentifier)
  if let w = attr(root, kAXFocusedWindowAttribute) { return (w as! AXUIElement) }
  return children(root).first { role($0) == "AXWindow" }
}

// Roles worth listing: things a person clicks, picks or types into, plus text that names them.
let ACTABLE: Set<String> = ["AXButton", "AXRow", "AXCell", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXMenuItem",
  "AXTextField", "AXSecureTextField", "AXSearchField", "AXComboBox", "AXSlider", "AXTab", "AXLink", "AXDisclosureTriangle", "AXImage", "AXStaticText", "AXSwitch", "AXToggle"]

func at(_ window: AXUIElement, _ path: String) -> AXUIElement? {
  var e = window
  for part in path.split(separator: ".") {
    guard let i = Int(part) else { return nil }
    let c = children(e)
    if i < 0 || i >= c.count { return nil }
    e = c[i]
  }
  return e
}
func find(_ window: AXUIElement, role want: String, name n: String) -> AXUIElement? {
  var hit: AXUIElement?
  func walk(_ e: AXUIElement, _ d: Int) {
    if hit != nil || d > 40 { return }
    if role(e) == want && shortName(e) == n { hit = e; return }
    for c in children(e) { walk(c, d + 1) }
  }
  walk(window, 0)
  return hit
}

let cmd = args[1]

// Control Center switches that have no setting anywhere else (Do Not Disturb). Opens the panel, opens a module,
// sets one switch on or off, reads it back, and closes the panel again.
//   ui-elements controlcenter <module id> <switch id> <on|off|status>
if cmd == "controlcenter" {
  guard args.count >= 5 else { fail("usage: controlcenter <module id> <switch id> <on|off|status>", 2) }
  guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.executableURL?.lastPathComponent == "ControlCenter" }) else { fail("Control Center isn't running.") }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  guard let bar = attr(root, "AXExtrasMenuBar"), let icon = children(bar as! AXUIElement).first(where: { str($0, "AXIdentifier") == "com.apple.menuextra.controlcenter" }) else { fail("I couldn't find Control Center in the menu bar.") }
  func byId(_ e: AXUIElement, _ id: String) -> AXUIElement? {
    if str(e, "AXIdentifier") == id { return e }
    for c in children(e) { if let f = byId(c, id) { return f } }
    return nil
  }
  func panels() -> [AXUIElement] { children(root).filter { role($0) == "AXWindow" } }
  func waitFor(_ id: String) -> AXUIElement? {
    for _ in 0..<40 { if let f = panels().compactMap({ byId($0, id) }).first { return f }; Thread.sleep(forTimeInterval: 0.05) }
    return nil
  }
  func closePanel() { for _ in 0..<3 where !panels().isEmpty { AXUIElementPerformAction(icon, kAXPressAction as CFString); Thread.sleep(forTimeInterval: 0.3) } }
  let (moduleId, switchId, want) = (args[2], args[3], args[4])
  if panels().isEmpty { AXUIElementPerformAction(icon, kAXPressAction as CFString) }
  guard let module = waitFor(moduleId) else { closePanel(); fail("I couldn't find that part of Control Center.") }
  AXUIElementPerformAction(module, kAXPressAction as CFString)
  guard let sw = waitFor(switchId) else { closePanel(); fail("I couldn't find that switch in Control Center.") }
  let before = (attr(sw, kAXValueAttribute) as? Int) ?? -1
  if want != "status" && (before == 1) != (want == "on") {
    AXUIElementPerformAction(sw, kAXPressAction as CFString)
    Thread.sleep(forTimeInterval: 0.4)
  }
  let after = (attr(waitFor(switchId) ?? sw, kAXValueAttribute) as? Int) ?? -1
  closePanel()
  out(["ok": true, "before": before, "after": after])
  exit(0)
}

// Closes the panel (sheet) in front of an app's window by pressing one of its closing buttons, then checks it closed.
//   ui-elements closesheet <app name> <Done|OK|Cancel>
// Only these three names are ever pressed, and only inside a panel: never "Forget This Network…" or anything else.
// System Settings leaves the panel's default and cancel buttons unset, so the button is found by its exact name.
// Escape is not used: it keeps changes on panels that apply them right away (Text Size), so it isn't a real Cancel.
let CLOSE_NAMES: Set<String> = ["Done", "OK", "Cancel"]
if cmd == "closesheet" {
  guard args.count >= 4 else { fail("usage: closesheet <app> <Done|OK|Cancel>", 2) }
  let want = args[3]
  guard CLOSE_NAMES.contains(want) else { fail("Only Done, OK or Cancel close a panel.") }
  guard let app = appNamed(args[2]) else { fail("That app isn't running.") }
  guard let sheet = frontWindow(app), role(sheet) == "AXSheet" else { out(["ok": true, "pressed": NSNull(), "closed": true]); exit(0) }
  var button: AXUIElement?
  func look(_ e: AXUIElement, _ d: Int) {
    if button != nil || d > 40 { return }
    if role(e) == "AXButton" && name(e) == want { button = e; return }
    for c in children(e) { look(c, d + 1) }
  }
  look(sheet, 0)
  guard let b = button else { fail("The panel has no \(want) button.") }
  let r = AXUIElementPerformAction(b, kAXPressAction as CFString)
  if r != .success { fail("Pressing \(want) didn't work (\(r.rawValue)).") }
  // The panel takes a moment to slide away: closed once the app's focused window is no longer a panel.
  var closed = false
  for _ in 0..<30 {
    Thread.sleep(forTimeInterval: 0.05)
    if let w = frontWindow(app), role(w) == "AXSheet" { continue }
    closed = true
    break
  }
  if closed { out(["ok": true, "pressed": want, "closed": true]) }
  else { out(["ok": false, "pressed": want, "closed": false, "error": "I pressed \(want), but the panel is still open."]) }
  exit(0)
}

if cmd == "list" {
  guard let app = appNamed(args.count > 2 ? args[2] : nil) else { fail("That app isn't running.") }
  guard let window = frontWindow(app) else { fail("\(app.localizedName ?? "The app") has no open window.") }
  var items: [[String: Any]] = []
  func walk(_ e: AXUIElement, _ path: String, _ d: Int) {
    if d > 40 || items.count >= 400 { return }
    let r = role(e)
    let n = name(e)
    let acts = actions(e)
    let secure = r == "AXSecureTextField" || str(e, kAXSubroleAttribute) == "AXSecureTextField"
    if ACTABLE.contains(r) && (!n.isEmpty || secure || r == "AXTextField" || r == "AXSearchField") && (r != "AXStaticText" || !n.isEmpty) {
      var item: [String: Any] = ["path": path, "role": r, "name": shortName(e), "frame": frame(e), "actions": acts]
      if secure { item["secure"] = true }
      if let sel = attr(e, kAXSelectedAttribute) as? Bool, sel { item["selected"] = true }
      if let en = attr(e, kAXEnabledAttribute) as? Bool, !en { item["disabled"] = true }
      if let v = attr(e, kAXValueAttribute) as? NSNumber, ["AXCheckBox", "AXSwitch", "AXRadioButton", "AXToggle", "AXSlider"].contains(r) { item["value"] = v }
      items.append(item)
    }
    for (i, c) in children(e).enumerated() { walk(c, path.isEmpty ? "\(i)" : "\(path).\(i)", d + 1) }
  }
  walk(window, "", 0)
  // A panel (sheet) in front is the app's focused window: then only the panel's items are listed.
  out(["ok": true, "app": app.localizedName ?? "", "window": str(window, kAXTitleAttribute), "sheet": role(window) == "AXSheet", "items": items])
  exit(0)
}

guard args.count >= 7 else { fail("usage: act|type <app> <path> <role> <name> <action|text>", 2) }
guard let app = appNamed(args[2]), let window = frontWindow(app) else { fail("That app or its window isn't there any more.") }
let (path, wantRole, wantName, last) = (args[3], args[4], args[5], args[6])
// The item must still be the same one; if the window changed, look it up again by role and name.
var target = at(window, path)
if target == nil || role(target!) != wantRole || shortName(target!) != wantName { target = find(window, role: wantRole, name: wantName) }
guard var e = target else { fail("I couldn't find \(wantName.isEmpty ? wantRole : wantName) any more.") }
let secure = role(e) == "AXSecureTextField" || str(e, kAXSubroleAttribute) == "AXSecureTextField"

// Sliders (pointer size, text size, volume…): one step up or down, like pressing the arrow keys on them.
if last == "increase" || last == "decrease" {
  guard role(e) == "AXSlider" else { fail("Only a slider can be made bigger or smaller this way.") }
  let action = last == "increase" ? kAXIncrementAction : kAXDecrementAction
  let r = AXUIElementPerformAction(e, action as CFString)
  if r != .success { fail("Moving the slider didn't work (\(r.rawValue)).") }
  out(["ok": true, "did": last, "value": (attr(e, kAXValueAttribute) as? NSNumber) ?? 0])
  exit(0)
}

if cmd == "type" {
  if secure { fail("That's a password box. Only the person types there.") }
  AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  let r = AXUIElementSetAttributeValue(e, kAXValueAttribute as CFString, last as CFString)
  if r != .success { fail("Typing didn't work (\(r.rawValue)).") }
  AXUIElementPerformAction(e, kAXConfirmAction as CFString)
  out(["ok": true, "did": "typed"])
  exit(0)
}

// act: press a button, select a row (a row's text is selected through its row), or focus a field.
func perform(_ e: AXUIElement, _ how: String) -> String? {
  let r = role(e)
  if how == "focus" || r == "AXTextField" || r == "AXSearchField" || r == "AXSecureTextField" {
    return AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success ? "focused" : nil
  }
  if r == "AXRow" || (how == "select" && attr(e, kAXSelectedAttribute) != nil) {
    if AXUIElementSetAttributeValue(e, kAXSelectedAttribute as CFString, kCFBooleanTrue) == .success { return "selected" }
  }
  if actions(e).contains(kAXPressAction as String), AXUIElementPerformAction(e, kAXPressAction as CFString) == .success, r != "AXStaticText", r != "AXCell" { return "pressed" }
  return nil
}
// Text and cells often only show a name: act on the row or button that holds them.
var did: String? = nil
for _ in 0..<5 {
  if let d = perform(e, last) { did = d; break }
  guard let p = attr(e, kAXParentAttribute), role(p as! AXUIElement) != "AXWindow" else { break }
  e = p as! AXUIElement
}
guard let done = did else { fail("\(wantName.isEmpty ? wantRole : wantName) can't be clicked this way.") }
out(["ok": true, "did": done, "role": role(e)])

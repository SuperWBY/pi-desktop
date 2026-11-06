import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import Vision
import ImageIO

struct Rect: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct Element: Encodable {
    let id: String
    let role: String
    let title: String?
    let description: String?
    let value: String?
    let identifier: String?
    let enabled: Bool
    let focused: Bool
    let secure: Bool
    let bounds: Rect?
    let depth: Int
}

struct OcrLine: Encodable {
    let text: String
    let bounds: Rect
    let confidence: Double
}

struct Snapshot: Encodable {
    let app: String
    let bundleId: String?
    let active: Bool
    let windowTitle: String?
    let windowBounds: Rect?
    let windowId: Int?
    let captureMode: String
    let screenshot: String?
    let screenWidth: Double
    let screenHeight: Double
    let accessibility: Bool
    let screenRecording: Bool
    let elements: [Element]
    let ocr: [OcrLine]
}

func emit(_ object: [String: Any], code: Int32 = 0) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    }
    exit(code)
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    emit(["ok": false, "error": message], code: code)
}

func axValue(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute, &value)
    return result == .success ? value : nil
}

func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
    guard let value = axValue(element, attribute) else { return nil }
    if let text = value as? String { return text }
    if let number = value as? NSNumber { return number.stringValue }
    return nil
}

func axBool(_ element: AXUIElement, _ attribute: CFString) -> Bool {
    (axValue(element, attribute) as? NSNumber)?.boolValue ?? false
}

func axPoint(_ element: AXUIElement, _ attribute: CFString) -> CGPoint? {
    guard let raw = axValue(element, attribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    guard AXValueGetValue(raw as! AXValue, .cgPoint, &point) else { return nil }
    return point
}

func axSize(_ element: AXUIElement, _ attribute: CFString) -> CGSize? {
    guard let raw = axValue(element, attribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    var size = CGSize.zero
    guard AXValueGetValue(raw as! AXValue, .cgSize, &size) else { return nil }
    return size
}

func axBounds(_ element: AXUIElement) -> Rect? {
    guard let point = axPoint(element, kAXPositionAttribute as CFString),
          let size = axSize(element, kAXSizeAttribute as CFString) else { return nil }
    return Rect(x: point.x, y: point.y, width: size.width, height: size.height)
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    guard let raw = axValue(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else { return [] }
    return raw
}

func roleOf(_ element: AXUIElement) -> String {
    axString(element, kAXRoleAttribute as CFString) ?? ""
}

func isSecure(_ element: AXUIElement) -> Bool {
    let role = roleOf(element)
    return role == "AXSecureTextField" || role == "AXTextField" && axBool(element, "AXIsSecure" as CFString)
}

func collect(_ element: AXUIElement, depth: Int, maxDepth: Int, maxElements: Int, into elements: inout [Element], seen: inout Set<String>) {
    if elements.count >= maxElements { return }
    let role = roleOf(element)
    if role.hasPrefix("AXMenu") { return }
    let title = axString(element, kAXTitleAttribute as CFString)
    let description = axString(element, kAXDescriptionAttribute as CFString)
    let interesting =
        role == "AXWindow" || role == "AXWebArea" ||
        role.contains("Button") || role.contains("TextField") || role.contains("TextArea") ||
        role.contains("MenuItem") || role.contains("CheckBox") || role.contains("RadioButton") ||
        role.contains("PopUpButton") || role.contains("Link") || role.contains("Tab") ||
        role.contains("Row") || role.contains("Cell") || role.contains("Slider") ||
        role.contains("ScrollBar") || role.contains("StaticText")
    if !role.isEmpty && interesting && (title != nil || description != nil || role.contains("Button") || role.contains("TextField") || role.contains("TextArea") || role.contains("Link") || role.contains("StaticText") || role.contains("Tab")) {
        let secure = isSecure(element)
        let enabledRaw = axValue(element, "AXEnabled" as CFString)
        let enabled = enabledRaw == nil ? true : (enabledRaw as? NSNumber)?.boolValue ?? true
        let bounds = axBounds(element)
        let key = "\(role)|\(title ?? "")|\(description ?? "")|\(bounds?.x ?? -1),\(bounds?.y ?? -1),\(bounds?.width ?? -1),\(bounds?.height ?? -1)"
        if !seen.contains(key) {
            seen.insert(key)
            elements.append(Element(
                id: "e\(elements.count + 1)",
                role: role,
                title: title,
                description: description,
                value: secure ? nil : axString(element, kAXValueAttribute as CFString),
                identifier: axString(element, kAXIdentifierAttribute as CFString),
                enabled: enabled,
                focused: axBool(element, kAXFocusedAttribute as CFString),
                secure: secure,
                bounds: bounds,
                depth: depth
            ))
        }
    }
    if depth >= maxDepth { return }
    for child in children(element) {
        collect(child, depth: depth + 1, maxDepth: maxDepth, maxElements: maxElements, into: &elements, seen: &seen)
        if elements.count >= maxElements { return }
    }
}

func runningApplication(_ name: String?) -> NSRunningApplication? {
    guard let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return NSWorkspace.shared.frontmostApplication
    }
    let normalized = name.lowercased()
    return NSWorkspace.shared.runningApplications.first {
        !$0.isTerminated &&
        (($0.localizedName ?? "").lowercased() == normalized ||
         ($0.bundleIdentifier ?? "").lowercased() == normalized ||
         ($0.bundleURL?.deletingPathExtension().lastPathComponent.lowercased() ?? "") == normalized)
    }
}

func screenSize() -> CGSize {
    let frame = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
    return frame.size
}

func findWindowId(pid: pid_t, title: String?, bounds: Rect?) -> Int? {
    guard let infos = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else { return nil }
    var matches: [(id: Int, area: Double)] = []
    var fallback: [(id: Int, area: Double)] = []
    for info in infos {
        guard let ownerPid = info[kCGWindowOwnerPID as String] as? pid_t, ownerPid == pid else { continue }
        let layer = info[kCGWindowLayer as String] as? Int ?? -1
        if layer != 0 { continue }
        let rawBounds = info[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let width = rawBounds["Width"] as? Double ?? 0
        let height = rawBounds["Height"] as? Double ?? 0
        if width < 120 || height < 120 { continue }
        guard let id = info[kCGWindowNumber as String] as? Int else { continue }
        let windowTitle = info[kCGWindowName as String] as? String
        if let title, !title.isEmpty, let windowTitle, !windowTitle.isEmpty,
           title == windowTitle || title.contains(windowTitle) || windowTitle.contains(title) {
            matches.append((id, width * height))
        }
        fallback.append((id, width * height))
    }
    if let title, !title.isEmpty {
        // Title is the strongest signal. Never fall back to an arbitrary
        // window when a named AX window does not have a CGWindow counterpart.
        return matches.sorted { $0.area > $1.area }.first?.id
    }
    if let bounds {
        // The caller has no title, so only accept a same-size window.
        return fallback.first(where: { abs($0.area - bounds.width * bounds.height) < 5_000 })?.id
    }
    return fallback.sorted { $0.area > $1.area }.first?.id
}

func imageSize(path: String) -> CGSize? {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
          let width = properties[kCGImagePropertyPixelWidth as String] as? Double,
          let height = properties[kCGImagePropertyPixelHeight as String] as? Double else { return nil }
    return CGSize(width: width, height: height)
}

func recognizeText(path: String, origin: Rect?) -> [OcrLine] {
    guard let imageSize = imageSize(path: path), imageSize.width > 0, imageSize.height > 0 else { return [] }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    let handler = VNImageRequestHandler(url: URL(fileURLWithPath: path), options: [:])
    guard (try? handler.perform([request])) != nil else { return [] }
    let baseX = origin?.x ?? 0
    let baseY = origin?.y ?? 0
    var lines: [OcrLine] = []
    for observation in request.results ?? [] {
        guard let text = observation.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else { continue }
        let box = observation.boundingBox
        let rect = Rect(
            x: baseX + box.minX * imageSize.width,
            y: baseY + (1 - box.maxY) * imageSize.height,
            width: box.width * imageSize.width,
            height: box.height * imageSize.height
        )
        let confidence = Double(observation.topCandidates(1).first?.confidence ?? 0)
        lines.append(OcrLine(text: String(text.prefix(160)), bounds: rect, confidence: confidence))
        if lines.count >= 120 { break }
    }
    return lines
}

func captureContext(_ appName: String?, screenshotPath: String?) -> Snapshot {
    let app = runningApplication(appName)
    let pid = app?.processIdentifier ?? 0
    let appElement = AXUIElementCreateApplication(pid)
    AXUIElementSetAttributeValue(appElement, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    var windowTitle: String?
    var windowBounds: Rect?
    if pid != 0 {
        var selectedWindow: AXUIElement?
        if let raw = axValue(appElement, kAXFocusedWindowAttribute as CFString),
           CFGetTypeID(raw) == AXUIElementGetTypeID() {
            selectedWindow = (raw as! AXUIElement)
        }
        if let windows = axValue(appElement, kAXWindowsAttribute as CFString) as? [AXUIElement] {
            if selectedWindow == nil || axBounds(selectedWindow!) == nil {
                selectedWindow = windows.first(where: { (axBounds($0)?.width ?? 0) > 100 }) ?? windows.first
            }
        }
        if let selectedWindow {
            windowTitle = axString(selectedWindow, kAXTitleAttribute as CFString)
            windowBounds = axBounds(selectedWindow)
        }
    }
    let windowId = pid != 0 ? findWindowId(pid: pid, title: windowTitle, bounds: windowBounds) : nil
    let captureMode = windowBounds != nil ? "region" : (windowId != nil ? "window" : "display")
    var elements: [Element] = []
    if pid != 0 && AXIsProcessTrusted() {
        var root = appElement
        if let raw = axValue(appElement, kAXFocusedWindowAttribute as CFString),
           CFGetTypeID(raw) == AXUIElementGetTypeID() {
            root = raw as! AXUIElement
        }
        var seen = Set<String>()
        collect(root, depth: 0, maxDepth: 8, maxElements: 250, into: &elements, seen: &seen)
    }
    if let screenshotPath {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        if let windowBounds {
            process.arguments = ["-x", "-R\(Int(windowBounds.x)),\(Int(windowBounds.y)),\(Int(windowBounds.width)),\(Int(windowBounds.height))", screenshotPath]
        } else if let windowId {
            process.arguments = ["-x", "-l\(windowId)", screenshotPath]
        } else {
            process.arguments = ["-x", screenshotPath]
        }
        try? process.run()
        process.waitUntilExit()
        let resizeTarget = windowBounds.map { CGSize(width: $0.width, height: $0.height) } ?? screenSize()
        let resize = Process()
        resize.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
        resize.arguments = ["-z", String(Int(resizeTarget.height)), String(Int(resizeTarget.width)), screenshotPath]
        resize.standardOutput = FileHandle.nullDevice
        resize.standardError = FileHandle.nullDevice
        try? resize.run()
        resize.waitUntilExit()
    }
    let ocrLines = screenshotPath.map { recognizeText(path: $0, origin: windowBounds) } ?? []
    let size = screenSize()
    return Snapshot(
        app: app?.localizedName ?? appName ?? "frontmost",
        bundleId: app?.bundleIdentifier,
        active: app?.isActive ?? false,
        windowTitle: windowTitle,
        windowBounds: windowBounds,
        windowId: windowId,
        captureMode: captureMode,
        screenshot: screenshotPath,
        screenWidth: size.width,
        screenHeight: size.height,
        accessibility: AXIsProcessTrusted(),
        screenRecording: CGPreflightScreenCaptureAccess(),
        elements: elements,
        ocr: ocrLines
    )
}

func listApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications
        .filter { !$0.isTerminated && $0.activationPolicy == .regular }
        .sorted { ($0.localizedName ?? "") < ($1.localizedName ?? "") }
        .map { app in
            [
                "name": app.localizedName ?? "",
                "bundleId": app.bundleIdentifier ?? "",
                "pid": Int(app.processIdentifier),
                "active": app.isActive
            ]
        }
}

func activate(_ name: String) {
    runningApplication(name)?.activate(options: [.activateIgnoringOtherApps])
    usleep(120_000)
}

func click(x: Double, y: Double, button: CGMouseButton = .left, count: Int = 1) {
    let point = CGPoint(x: x, y: y)
    for index in 0..<count {
        let down = CGEvent(mouseEventSource: nil, mouseType: button == .left ? .leftMouseDown : .rightMouseDown, mouseCursorPosition: point, mouseButton: button)
        let up = CGEvent(mouseEventSource: nil, mouseType: button == .left ? .leftMouseUp : .rightMouseUp, mouseCursorPosition: point, mouseButton: button)
        down?.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
        up?.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
        down?.post(tap: .cghidEventTap)
        usleep(35_000)
        up?.post(tap: .cghidEventTap)
        if index + 1 < count { usleep(80_000) }
    }
}

func flags(from modifiers: String) -> CGEventFlags {
    var flags: CGEventFlags = []
    if modifiers.contains("command") || modifiers.contains("cmd") { flags.insert(.maskCommand) }
    if modifiers.contains("shift") { flags.insert(.maskShift) }
    if modifiers.contains("option") || modifiers.contains("alt") { flags.insert(.maskAlternate) }
    if modifiers.contains("control") || modifiers.contains("ctrl") { flags.insert(.maskControl) }
    return flags
}

func keyCode(_ key: String) -> CGKeyCode? {
    let map: [String: CGKeyCode] = [
        "return": 36, "enter": 36, "tab": 48, "escape": 53, "esc": 53,
        "delete": 51, "backspace": 51, "space": 49,
        "up": 126, "down": 125, "left": 123, "right": 124,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4,
        "i": 34, "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31,
        "p": 35, "q": 12, "r": 15, "s": 1, "t": 17, "u": 32, "v": 9,
        "w": 13, "x": 7, "y": 16, "z": 6
    ]
    return map[key.lowercased()]
}

func press(key: String, modifiers: String) {
    guard let code = keyCode(key) else { fail("Unknown key: \(key)") }
    let eventFlags = flags(from: modifiers)
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    down?.flags = eventFlags
    up?.flags = eventFlags
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

func typeText(_ text: String) {
    let pasteboard = NSPasteboard.general
    let previous = pasteboard.string(forType: .string)
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
    press(key: "v", modifiers: "command")
    usleep(80_000)
    if let previous {
        pasteboard.clearContents()
        pasteboard.setString(previous, forType: .string)
    }
}

func scroll(x: Double, y: Double, delta: Int32) {
    let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
    move?.post(tap: .cghidEventTap)
    let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0)
    event?.post(tap: .cghidEventTap)
}

func argument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[index + 1]
}

func axDebug(_ appName: String?) -> [String: Any] {
    let app = runningApplication(appName)
    let pid = app?.processIdentifier ?? 0
    var result: [String: Any] = [
        "frontmost": NSWorkspace.shared.frontmostApplication?.localizedName ?? "",
        "accessibility": AXIsProcessTrusted(),
        "screenRecording": CGPreflightScreenCaptureAccess(),
        "target": app?.localizedName ?? appName ?? "frontmost",
        "pid": Int(pid),
        "active": app?.isActive ?? false,
        "hidden": app?.isHidden ?? false
    ]
    guard pid != 0 else { return result }
    let element = AXUIElementCreateApplication(pid)
    for (name, attribute) in [
        ("title", kAXTitleAttribute),
        ("windows", kAXWindowsAttribute),
        ("focusedWindow", kAXFocusedWindowAttribute),
        ("mainWindow", kAXMainWindowAttribute),
        ("children", kAXChildrenAttribute)
    ] {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        var item: [String: Any] = ["error": Int(error.rawValue), "type": value.map { Int(CFGetTypeID($0)) } ?? 0]
        if let array = value as? [AXUIElement] { item["count"] = array.count }
        result[name] = item
    }
    if let raw = axValue(element, kAXFocusedWindowAttribute as CFString),
       CFGetTypeID(raw) == AXUIElementGetTypeID() {
        let window = raw as! AXUIElement
        result["focusedTitle"] = axString(window, kAXTitleAttribute as CFString) ?? ""
        result["focusedBounds"] = axBounds(window).map { ["x": $0.x, "y": $0.y, "width": $0.width, "height": $0.height] } ?? [:]
    }
    result["windowId"] = findWindowId(pid: pid, title: result["focusedTitle"] as? String, bounds: nil).map { $0 } ?? 0
    return result
}

let command = CommandLine.arguments.dropFirst().first ?? "check"
switch command {
case "check":
    emit([
        "ok": true,
        "accessibility": AXIsProcessTrusted(),
        "screenRecording": CGPreflightScreenCaptureAccess()
    ])
case "apps":
    emit(["ok": true, "apps": listApps()])
case "ax-debug":
    emit(["ok": true, "debug": axDebug(argument("--app"))])
case "activate":
    guard let app = argument("--app") else { fail("Missing --app") }
    activate(app)
    emit(["ok": true])
case "ocr":
    guard let image = argument("--image") else { fail("Missing --image") }
    let lines = recognizeText(path: image, origin: nil)
    let encoded = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(lines))
    emit(["ok": true, "lines": encoded])
case "observe":
    let app = argument("--app")
    let screenshot = argument("--screenshot")
    // Observation must not steal focus: activating an app can switch the
    // focused AX window to a lazy/empty window. Callers can opt in when
    // they explicitly want a foreground app.
    if CommandLine.arguments.contains("--activate"), let app { activate(app) }
    let snapshot = captureContext(app, screenshotPath: screenshot)
    emit(["ok": true, "snapshot": try! JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot))])
case "click":
    guard let x = Double(argument("--x") ?? ""), let y = Double(argument("--y") ?? "") else { fail("Missing coordinates") }
    let button = argument("--button") == "right" ? CGMouseButton.right : CGMouseButton.left
    let count = Int(argument("--count") ?? "1") ?? 1
    click(x: x, y: y, button: button, count: count)
    emit(["ok": true])
case "type":
    guard let text = argument("--text") else { fail("Missing text") }
    typeText(text)
    emit(["ok": true])
case "key":
    guard let key = argument("--key") else { fail("Missing key") }
    press(key: key, modifiers: argument("--modifiers") ?? "")
    emit(["ok": true])
case "scroll":
    guard let x = Double(argument("--x") ?? ""), let y = Double(argument("--y") ?? "") else { fail("Missing coordinates") }
    let delta = Int32(argument("--delta") ?? "0") ?? 0
    scroll(x: x, y: y, delta: delta)
    emit(["ok": true])
default:
    fail("Unknown command: \(command)")
}

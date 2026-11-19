import AppKit
import Foundation
class Controller: NSObject {
 let path = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("fixture-evidence.txt").path
 @objc func clicked(_ sender: NSButton) {
  let previous = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
  try? (previous + "completed\n").write(toFile: path, atomically: true, encoding: .utf8)
  sender.title = "Pi Fixture Done"
 }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let controller = Controller()
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 220), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Pi Computer Use Local Fixture"
window.center()
let button = NSButton(frame: NSRect(x: 100, y: 85, width: 220, height: 45))
button.title = "Pi Fixture Start"
button.target = controller
button.action = #selector(Controller.clicked(_:))
window.contentView?.addSubview(button)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()

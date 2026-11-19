#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
if (process.platform !== 'darwin') { console.log('SKIP macOS named pasteboard'); process.exit(0) }
const root = resolve(import.meta.dirname, '..')
const source = readFileSync(join(root,'extensions/computer-use/src/ComputerUseHelper.swift'),'utf8')
const start = source.indexOf('func typeText('), end = source.indexOf('\nfunc windowIsTopmostAtPoint(',start)
assert.ok(start >= 0 && end > start)
const subject = source.slice(start,end).replace('NSPasteboard.general','testBoard')
const dir = mkdtempSync(join(tmpdir(),'pi-pasteboard-test-'))
try {
  const swift = `import AppKit\nimport Foundation\nlet testBoard = NSPasteboard(name: NSPasteboard.Name("pi-test-" + UUID().uuidString))\nvar onPress: () -> Void = {}\nfunc press(key: String, modifiers: String) { onPress() }\nfunc fail(_ message: String) -> Never { fputs(message + "\\n", stderr); exit(1) }\n${subject}\nfunc check(_ condition: Bool, _ message: String) { if !condition { fputs("FAIL: " + message + "\\n", stderr); exit(1) } }\nlet rich = NSPasteboard.PasteboardType.rtf\nlet image = NSPasteboard.PasteboardType.png\nlet blob = Data([1,2,3,4])\nlet richData = try! NSAttributedString(string: "original").data(from: NSRange(location:0,length:8), documentAttributes:[.documentType:NSAttributedString.DocumentType.rtf])\nlet item = NSPasteboardItem()\nitem.setString("original", forType: .string)\nitem.setData(richData, forType: rich)\nlet second = NSPasteboardItem()\nsecond.setData(blob, forType: image)\ntestBoard.clearContents()\ncheck(testBoard.writeObjects([item,second]), "prepare named pasteboard")\ntypeText("temporary")\ncheck(testBoard.pasteboardItems?.count == 2, "preserve multiple pasteboard items")\ncheck(testBoard.pasteboardItems?[0].data(forType: rich) == richData, "preserve rich text")\ncheck(testBoard.pasteboardItems?[1].data(forType: image) == blob, "preserve image data")\nonPress = { testBoard.clearContents(); testBoard.setString("new user copy", forType: .string) }\ntypeText("another temporary")\ncheck(testBoard.string(forType: .string) == "new user copy", "do not overwrite newer clipboard content")\ntestBoard.releaseGlobally()\nprint("PASS isolated pasteboard preserves formats and newer user content")\n`
  const file=join(dir,'main.swift'), binary=join(dir,'test')
  writeFileSync(file,swift)
  execFileSync('swiftc',[file,'-o',binary],{stdio:'inherit'})
  const result=spawnSync(binary,[],{encoding:'utf8'})
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exitCode=result.status ?? 1
} finally { rmSync(dir,{recursive:true,force:true}) }

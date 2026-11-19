import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
if(process.platform!=='darwin'){console.log('SKIP macOS window hit test');process.exit(0)}
const source=readFileSync(new URL('../extensions/computer-use/src/ComputerUseHelper.swift',import.meta.url),'utf8')
const start=source.indexOf('func windowIsTopmostAtPoint('),end=source.indexOf('\nfunc validateCoordinateWindow(',start)
assert.ok(start>=0 && end>start,'native coordinate window hit check must exist')
const subject=source.slice(start,end)
const temp=mkdtempSync(join(tmpdir(),'pi-window-hit-'))
try{
const swift=`import Foundation\nimport CoreGraphics\n${subject}\nfunc win(_ id: Int,_ x:Double,_ y:Double,_ w:Double,_ h:Double,_ alpha:Double = 1,_ layer:Int = 0) -> [String:Any] { [kCGWindowNumber as String:id,kCGWindowLayer as String:layer,kCGWindowBounds as String:["X":x,"Y":y,"Width":w,"Height":h],kCGWindowAlpha as String:alpha] }\nfunc check(_ condition:Bool,_ message:String) { if !condition { fputs(message+"\\n",stderr); exit(1) } }\nlet target=win(42,10,10,100,100)\ncheck(windowIsTopmostAtPoint([target],expectedID:42,x:40,y:40),"visible target rejected")\ncheck(!windowIsTopmostAtPoint([win(9,30,30,40,40),target],expectedID:42,x:40,y:40),"occlusion accepted")\ncheck(windowIsTopmostAtPoint([win(9,30,30,40,40,0),target],expectedID:42,x:40,y:40),"transparent window blocked")\ncheck(windowIsTopmostAtPoint([win(10,0,0,1000,1000,1,20),target],expectedID:42,x:40,y:40),"system overlay blocks window-order check")\ncheck(!windowIsTopmostAtPoint([target],expectedID:42,x:150,y:40),"outside target accepted")\ncheck(!windowIsTopmostAtPoint([],expectedID:42,x:40,y:40),"missing window accepted")\nprint("PASS native window hit test: visibility and occlusion")\n`
writeFileSync(join(temp,'main.swift'),swift)
execFileSync('swiftc',[join(temp,'main.swift'),'-o',join(temp,'test')],{stdio:'inherit'})
execFileSync(join(temp,'test'),[],{stdio:'inherit'})
}finally{rmSync(temp,{recursive:true,force:true})}

#!/usr/bin/env node
// Creates a local, isolated macOS fixture. It does not change trust or launch apps.
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw Error('The native fixture requires macOS.')
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const workspace=await mkdtemp(join(tmpdir(),'pi-cua-live-'))
const fixture=join(workspace,'Pi CU Fixture.app'), contents=join(fixture,'Contents')
await mkdir(join(contents,'MacOS'),{recursive:true})
await mkdir(join(workspace,'.pi','extensions'),{recursive:true})
await writeFile(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Pi CU Fixture</string><key>CFBundleIdentifier</key><string>dev.pi.desktop.cua-fixture</string><key>CFBundleName</key><string>Pi CU Fixture</string><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>`)
const source=join(root,'scripts','fixtures','computer-use-live','fixture.swift')
await copyFile(source,join(workspace,'fixture.swift'))
execFileSync('swiftc',[source,'-o',join(contents,'MacOS','Pi CU Fixture')],{stdio:'inherit'})
const template=await readFile(join(root,'scripts','fixtures','computer-use-live','extension.template.txt'),'utf8')
const extension=template.replace('__COMPUTER_USE_MODULE__',JSON.stringify(join(root,'extensions','computer-use','index.ts'))).replaceAll('__EVIDENCE_PATH__',JSON.stringify(join(workspace,'fixture-evidence.txt'))).replaceAll('__RESULT_PATH__',JSON.stringify(join(workspace,'result.json')))
await writeFile(join(workspace,'.pi','extensions','live-fixture.ts'),extension)
const coordinateTemplate=await readFile(join(root,'scripts','fixtures','computer-use-live','coordinate-guard.template.txt'),'utf8')
const coordinateExtension=coordinateTemplate.replace('__HELPER_PATH__',JSON.stringify(join(root,'extensions','computer-use','bin','computer-use-helper')))
await writeFile(join(workspace,'.pi','extensions','native-guard-probe.ts'),coordinateExtension)
const occlusionTemplate=await readFile(join(root,'scripts','fixtures','computer-use-live','occlusion-rejection.template.txt'),'utf8')
const occlusionExtension=occlusionTemplate.replace('__COMPUTER_USE_MODULE__',JSON.stringify(join(root,'extensions','computer-use','index.ts'))).replace('__JOURNAL_MODULE__',JSON.stringify(join(root,'extensions','computer-use','src','browser-action-journal.ts')))
await writeFile(join(workspace,'.pi','extensions','occlusion-rejection.ts'),occlusionExtension)
console.log(JSON.stringify({workspace,fixture,evidence:join(workspace,'fixture-evidence.txt'),result:join(workspace,'result.json'),command:'/pi-cua-local-fixture',coordinateCommand:'/pi-coordinate-probe',coordinateResult:join(workspace,'native-guard-result.json'),occlusionCommand:'/pi-occlusion-rejection',occlusionResult:join(workspace,'occlusion-result.json')},null,2))

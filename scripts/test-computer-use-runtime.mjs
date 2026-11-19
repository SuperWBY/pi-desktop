import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareComputerUseRuntime } from '../src/main/computer-use-runtime.ts'

const root = await mkdtemp(join(tmpdir(), 'pi-runtime-test-'))
try {
  const source = join(root, 'source')
  const data = join(root, 'data')
  await mkdir(join(source, 'skills', 'computer-use'), { recursive: true })
  await mkdir(join(source, 'bin'), { recursive: true })
  await writeFile(join(source, 'index.ts'), 'version one')
  await writeFile(join(source, 'skills', 'computer-use', 'SKILL.md'), 'skill')
  await writeFile(join(source, 'bin', 'computer-use-helper'), 'helper')
  const first = prepareComputerUseRuntime(source, data)
  assert.equal(await readFile(join(first, 'index.ts'), 'utf8'), 'version one')
  assert.equal(prepareComputerUseRuntime(source, data), first, 'same package is reused')
  await writeFile(join(source, 'index.ts'), 'version two')
  const second = prepareComputerUseRuntime(source, data)
  assert.notEqual(second, first, 'updates get a new immutable runtime')
  assert.equal(await readFile(join(first, 'index.ts'), 'utf8'), 'version one', 'running sessions keep their original runtime')
  assert.equal(await readFile(join(second, 'index.ts'), 'utf8'), 'version two')
  console.log('PASS bundled computer use: isolated runtime and safe updates')
} finally { await rm(root, { recursive: true, force: true }) }

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

function packageHash(root: string): string {
  const hash = createHash('sha256')
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name)
      hash.update(`${name}\0`)
      if (entry.isDirectory()) visit(name)
      else if (entry.isFile()) hash.update(readFileSync(join(root, name)))
      else throw new Error('Unsupported entry in computer use runtime.')
    }
  }
  visit('')
  return hash.digest('hex')
}

export function prepareComputerUseRuntime(source: string, userData: string): string {
  const hash = packageHash(source)
  const root = join(userData, 'computer-use-runtimes')
  const destination = join(root, hash)
  mkdirSync(root, { recursive: true })
  if (existsSync(destination)) {
    if (packageHash(destination) !== hash) throw new Error('Bundled computer use runtime failed integrity validation.')
    return destination
  }
  const temporary = mkdtempSync(join(root, '.prepare-'))
  try {
    cpSync(source, temporary, { recursive: true })
    if (packageHash(temporary) !== hash) throw new Error('Failed to copy the computer use runtime.')
    try { renameSync(temporary, destination) }
    catch (error) {
      if (!existsSync(destination) || packageHash(destination) !== hash) throw error
    }
  } finally { rmSync(temporary, { recursive: true, force: true }) }
  return destination
}


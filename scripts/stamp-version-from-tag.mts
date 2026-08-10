import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

async function gitTagVersion(): Promise<string | null> {
  const envTag = process.env.GITHUB_REF_NAME
  if (typeof envTag === 'string' && TAG_RE.test(envTag)) {
    return envTag.replace(/^v/, '')
  }

  try {
    const { stdout } = await execFileAsync('git', ['tag', '--points-at', 'HEAD'])
    const tags = stdout
      .split(/\r?\n/)
      .map((tag) => tag.trim())
      .filter(Boolean)

    const matching = tags.find((tag) => TAG_RE.test(tag))
    return matching ? matching.replace(/^v/, '') : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const version = await gitTagVersion()
  if (!version) {
    console.log('stamp-version-from-tag: no exact v* tag found on HEAD; package version unchanged.')
    return
  }

  const raw = await readFile('package.json', 'utf8')
  const pkg = JSON.parse(raw)
  if (pkg.version === version) {
    console.log(`stamp-version-from-tag: package version already ${version}`)
    return
  }

  pkg.version = version
  await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log(`stamp-version-from-tag: stamped package.json version ${version}`)
}

main().catch((error) => {
  console.error('stamp-version-from-tag: failed', error)
  process.exit(1)
})

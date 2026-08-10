// dist-stamped — run electron-builder with the REAL version stamped in, for local builds.
//
// package.json carries `0.1.0` forever on purpose (AGENTS.md, Shipping): the tag IS the version,
// and the tag job stamps it in CI (`npm version --no-git-tag-version`, build.yml) so the two can
// never drift. That leaves LOCAL builds reading 0.1.0, which is not a cosmetic problem — three
// things downstream derive from it, and all three were wrong:
//
//   * `directories.output: release/${version}`  → artifacts land in release/0.1.0/
//   * `artifactName: ...-${version}.${ext}`     → everquest-companion-0.1.0.AppImage
//   * latest*.yml                               → an update feed advertising 0.1.0, which never
//                                                 offers an upgrade to anybody
//
// WHERE THE VERSION COMES FROM: the newest entry in src/shared/releaseNotes.ts, not a git tag.
// A local build has no tag — that is the whole difference from CI — but the notes are committed
// source and the repo already guarantees the newest entry IS the running version of every
// published build (the tag job refuses a tag with no entry: scripts/check-release-notes.mjs).
// So the notes are the one version fact a checkout can read without inventing anything.
//
// THE SHAPE CHECK RUNS FIRST, before anything is written. `latestReleaseVersion()` is only
// trustworthy if the notes parse, and a malformed version string would otherwise become a
// directory name and an update-feed field.
//
// package.json IS RESTORED BYTE-FOR-BYTE in a finally block, including on Ctrl-C. It is edited by
// a targeted replace of the version line rather than by `npm version` (CI's tool) for exactly
// that reason: `npm version` reformats the file and also rewrites package-lock.json, so a build
// interrupted at the wrong moment would leave a dirty tree that looks like real work. The
// contract this script must never break is that the version NEVER lands in a commit.
//
// Usage: node --import tsx scripts/dist-stamped.mjs [electron-builder args...]
//   e.g. node --import tsx scripts/dist-stamped.mjs --linux
//        node --import tsx scripts/dist-stamped.mjs --win --dir

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { latestReleaseVersion, releaseNotesProblems } from '../src/shared/releaseNotes.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')

const problems = releaseNotesProblems()
if (problems.length > 0) {
  console.error('refusing to build: release notes check FAILED:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const version = latestReleaseVersion()

// The same guard CI applies to a tag, for the same reason: everything downstream turns this
// string into a path and an update-feed field, so a junk value must fail loudly right here.
if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`refusing to build: '${version}' is not a MAJOR.MINOR.PATCH semver version`)
  process.exit(1)
}

// Read as raw TEXT, not as parsed JSON — restoring means writing these exact bytes back, and a
// JSON round-trip would silently normalize the indentation and the missing trailing newline.
const original = readFileSync(pkgPath, 'utf8')
const stamped = original.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
if (stamped === original) {
  console.error(`refusing to build: no "version" field to stamp in ${pkgPath}`)
  process.exit(1)
}

let restored = false
const restore = () => {
  if (restored) return
  restored = true
  writeFileSync(pkgPath, original)
}

// Ctrl-C during a multi-minute package must not leave the version behind. `process.on('exit')`
// alone does not cover SIGINT/SIGTERM, which kill the process without running exit handlers.
process.on('exit', restore)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restore()
    process.exit(1)
  })
}

try {
  writeFileSync(pkgPath, stamped)
  console.log(`Stamped version from release notes: ${version}`)

  const result = spawnSync('npx', ['electron-builder', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  restore()
}

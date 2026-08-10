import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

async function findTaggedVersion(): Promise<string | null> {
  const envTag = process.env.GITHUB_REF_NAME
  if (typeof envTag === 'string' && TAG_RE.test(envTag)) {
    return envTag.replace(/^v/, '')
  }

  try {
    const { stdout } = await execFileAsync('git', ['tag', '--points-at', 'HEAD'])
    const tags = stdout.split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean)
    const matching = tags.find((tag) => TAG_RE.test(tag))
    return matching ? matching.replace(/^v/, '') : null
  } catch {
    return null
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    args.push('--win')
  }

  const version = await findTaggedVersion()
  if (version) {
    console.log(`dist: using tagged version ${version}`)
  } else {
    console.log('dist: no tagged version found; using package.json version')
  }

  await run('npm', ['run', 'build'])

  const builderArgs = [...args]
  if (version) {
    builderArgs.push(`--config.extraMetadata.version=${version}`)
  }

  await run('npx', ['electron-builder', ...builderArgs])
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ResolveAppIconPathOptions {
    cwd?: string
    resourcesPath?: string
    appPath?: string
}

export function resolveAppIconPath(options: ResolveAppIconPathOptions = {}): string | undefined {
    const cwd = options.cwd ?? process.cwd()
    const resourcesPath = options.resourcesPath ?? process.resourcesPath
    const appPath = options.appPath
    const extraResourcesPath = process.env.ELECTRON_EXTRA_RESOURCES_PATH

    const candidates: string[] = []
    const addCandidate = (value?: string): void => {
        if (value) candidates.push(value)
    }

    addCandidate(join(cwd, 'build', 'icon.png'))
    addCandidate(join(cwd, 'build', 'icon.ico'))

    if (extraResourcesPath) {
        addCandidate(join(extraResourcesPath, 'icon.png'))
        addCandidate(join(extraResourcesPath, 'icon.ico'))
        addCandidate(join(extraResourcesPath, 'build', 'icon.png'))
        addCandidate(join(extraResourcesPath, 'build', 'icon.ico'))
    }

    if (resourcesPath) {
        addCandidate(join(resourcesPath, 'icon.png'))
        addCandidate(join(resourcesPath, 'icon.ico'))
        addCandidate(join(resourcesPath, 'app-icon.png'))
        addCandidate(join(resourcesPath, 'app-icon.ico'))
        addCandidate(join(resourcesPath, 'build', 'icon.png'))
        addCandidate(join(resourcesPath, 'build', 'icon.ico'))
    }

    if (appPath) {
        addCandidate(join(appPath, 'build', 'icon.png'))
        addCandidate(join(appPath, 'build', 'icon.ico'))
    }

    return candidates.find((candidate) => existsSync(candidate))
}

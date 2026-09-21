/** Release-artifact packaging matrix and publication transaction, without executing a build. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('Release app workflow', () => {
  it('publishes artifacts only from a published release', () => {
    const workflow = releaseAppWorkflow()
    expect(workflowEvent(workflow, 'release')).toMatchObject({ types: ['published'] })
    expect(workflowEvent(workflow, 'workflow_dispatch')).toBeDefined()
    expect(workflow.permissions).toEqual({ contents: 'write' })
  })

  it('never cancels a publication transaction', () => {
    expect(releaseAppWorkflow().concurrency).toMatchObject({ 'cancel-in-progress': false })
  })

  it('packages every supported platform on its own architecture', () => {
    const matrix = matrixEntries(packageJob())
    // Electron and the bundled dsh runtime execute on the build host, so each
    // target needs a runner of its own platform and architecture.
    expect(matrixColumn(matrix, 'target')).toEqual([
      'win-x64', 'mac-arm64', 'mac-x64', 'linux-x64', 'linux-arm64',
    ])
    expect(matrixColumn(matrix, 'runner')).toEqual([
      'windows-latest', 'macos-14', 'macos-15-intel', 'ubuntu-24.04', 'ubuntu-24.04-arm',
    ])
    expect(matrixColumn(matrix, 'script')).toEqual([
      'package:ci:win:x64', 'package:ci:mac:arm64', 'package:ci:mac:x64',
      'package:ci:linux:x64', 'package:ci:linux:arm64',
    ])
    expect(matrixColumn(matrix, 'extension')).toEqual(['exe', 'dmg', 'dmg', 'AppImage', 'AppImage'])
  })

  it('disables macOS signing auto-discovery so the ad-hoc identity is used', () => {
    expect(packageJob().env).toMatchObject({ CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  })

  it('uploads each installer to the release tag it was published for', () => {
    const steps = packageSteps()
    const resolveTag = stepNamed(steps, 'Resolve the release tag')
    expect(resolveTag.run).toContain('github.event.release.tag_name')
    expect(resolveTag.run).toContain('inputs.tag')

    const upload = stepNamed(steps, 'Upload to the release')
    expect(upload.env).toMatchObject({ GH_TOKEN: '${{ github.token }}' })
    expect(upload.run).toContain('gh release upload')
    // A re-run replaces the assets it already uploaded instead of failing on the duplicate name.
    expect(upload.run).toContain('--clobber')
    expect(upload.run).toContain('produced no')
  })

  it('verifies the ad-hoc signature on every macOS disk image', () => {
    const verify = stepNamed(packageSteps(), 'Verify the ad-hoc macOS signature')
    expect(verify.if).toBe("runner.os == 'macOS'")
    expect(verify.run).toContain('codesign --verify')
  })

  it('installs dependencies immutably from a runner-private pnpm setup', () => {
    const steps = packageSteps()
    const setup = steps.find(step => typeof step.uses === 'string' && step.uses.startsWith('pnpm/action-setup@'))
    expect(steps.find(step => step.run === 'pnpm install --frozen-lockfile')).toBeDefined()
    // Credentials stay out of the checkout: the upload step uses the injected token.
    const checkout = steps.find(step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
    if (setup === undefined) throw new TypeError('the package job must install pnpm')
    if (checkout === undefined) throw new TypeError('the package job must check out the repository')
    expect(stepStringInput(setup, 'dest')).toMatch(
      /^\$\{\{ runner\.temp \}\}\/setup-pnpm-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-\$\{\{ github\.job \}\}$/u,
    )
    expect(stepInput(checkout, 'persist-credentials')).toBe(false)
  })
})

/**
 * Read one input from a step that uses an action.
 * @param step - Step that declares the input.
 * @param key - Input name to read.
 * @returns Input value as YAML parsed it.
 */
function stepInput(step: Record<string, unknown>, key: string): string | boolean {
  const inputs: unknown = step.with
  if (!isRecord(inputs)) throw new TypeError('every action step must declare inputs')
  const value: unknown = inputs[key]
  if (typeof value !== 'string' && typeof value !== 'boolean') {
    throw new TypeError(`every action step must declare the ${key} input`)
  }
  return value
}

/**
 * Read one string input from a step that uses an action.
 * @param step - Step that declares the input.
 * @param key - Input name to read.
 * @returns Input value as written in the workflow.
 */
function stepStringInput(step: Record<string, unknown>, key: string): string {
  const value = stepInput(step, key)
  if (typeof value !== 'string') throw new TypeError(`the ${key} input must be a string`)
  return value
}

/** Parsed release-app workflow document. */
function releaseAppWorkflow(): Record<string, unknown> {
  const workflow: unknown = load(readFileSync(resolve(root, '.github/workflows/release-app.yml'), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError('release-app.yml must define a workflow')
  return workflow
}

/**
 * Read one event entry from a workflow document.
 * @param workflow - Parsed workflow document.
 * @param event - Event name to read.
 * @returns Event entry, or an empty record when the event carries no options.
 */
function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on)) throw new TypeError('release-app.yml must define triggers')
  const entry: unknown = workflow.on[event]
  if (entry === null) return {}
  if (!isRecord(entry)) throw new TypeError(`release-app.yml must define the ${event} trigger as a mapping`)
  return entry
}

/** Packaging job that owns every release target. */
function packageJob(): Record<string, unknown> {
  const workflow = releaseAppWorkflow()
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs.package)) {
    throw new TypeError('release-app.yml must define the package job')
  }
  return workflow.jobs.package
}

/** Steps declared by the packaging job. */
function packageSteps(): Array<Record<string, unknown>> {
  const steps: unknown = packageJob().steps
  if (!Array.isArray(steps)) throw new TypeError('the package job must define steps')
  return steps.filter(isRecord)
}

/**
 * Find one step by its display name.
 * @param steps - Steps declared by the packaging job.
 * @param name - Step name to find.
 * @returns The named step.
 */
function stepNamed(steps: ReadonlyArray<Record<string, unknown>>, name: string): Record<string, unknown> {
  const step = steps.find(candidate => candidate.name === name)
  if (step === undefined) throw new TypeError(`the package job must define a ${name} step`)
  return step
}

/** Matrix include entries declared by the packaging job. */
function matrixEntries(job: Record<string, unknown>): Array<Record<string, unknown>> {
  const strategy: unknown = job.strategy
  if (!isRecord(strategy) || !isRecord(strategy.matrix)) {
    throw new TypeError('the package job must define a matrix')
  }
  const include: unknown = strategy.matrix.include
  if (!Array.isArray(include)) throw new TypeError('the package matrix must define include entries')
  return include.filter(isRecord)
}

/**
 * Read one column from the matrix include entries.
 * @param entries - Matrix include entries.
 * @param key - Column name to read.
 * @returns Column values in matrix order.
 */
function matrixColumn(entries: ReadonlyArray<Record<string, unknown>>, key: string): string[] {
  return entries.map((entry) => {
    const value: unknown = entry[key]
    if (typeof value !== 'string') throw new TypeError(`every matrix entry must define ${key}`)
    return value
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

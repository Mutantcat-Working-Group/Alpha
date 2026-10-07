import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const workflow = yaml.load(readFileSync(resolve(import.meta.dirname, '../.github/workflows/build-preview-cloudflare.yml'), 'utf8')) as {
  on: unknown
  permissions: unknown
  concurrency: unknown
  env: Record<string, string>
  jobs: Record<string, {
    'runs-on'?: string
    needs?: unknown
    if?: string
    outputs?: Record<string, string>
    steps: Array<{ name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> }>
  }>
}
const preview = workflow.jobs.preview

describe('PR preview workflow', () => {
  it('keeps every PR author on the selected GitHub-hosted runner', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['credentials', 'preview'])
    expect(preview['runs-on']).toBe('ubuntu-24.04')
    expect(workflow.on).toEqual({ pull_request: { types: ['opened', 'synchronize', 'reopened'] } })
    expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' })
    expect(preview.steps.find(step => step.uses === 'actions/checkout@v6')?.with).toEqual({ 'persist-credentials': false })
  })

  it('skips the upload when the Cloudflare credentials are unconfigured', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['credentials', 'preview'])
    const credentials = workflow.jobs.credentials
    const check = credentials.steps.find(step => step.name === 'Check preview credentials')!
    expect(check.env).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
      CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
      CF_ACCESS_CLIENT_ID: '${{ secrets.CF_ACCESS_CLIENT_ID }}',
      CF_ACCESS_CLIENT_SECRET: '${{ secrets.CF_ACCESS_CLIENT_SECRET }}',
    })
    // A declared credential that the script never reads would pass silently.
    const guarded = /for name in ([^;]+);/.exec(check.run!)![1].trim().split(/\s+/)
    expect(guarded).toEqual(Object.keys(check.env ?? {}))
    expect(check.run).toContain('${!name}')
    expect(check.run).toContain("echo 'ready=false'")
    expect(credentials.outputs).toEqual({ ready: '${{ steps.check.outputs.ready }}' })
    // The secrets context is unavailable in a job condition, so the gate reads
    // the credentials job output instead.
    expect(preview.needs).toBe('credentials')
    expect(preview.if).toBe("${{ needs.credentials.outputs.ready == 'true' }}")
  })

  it('previews the Alpha brand rather than the upstream one', () => {
    expect(workflow.env.CF_PROJECT).toBe('alpha-build-preview')
    expect(preview.steps.find(step => step.name === 'Build the preview page and pack the VFS image')?.env)
      .toMatchObject({ DSH_CLIENT_TITLE: 'Alpha preview pr-${{ github.event.pull_request.number }}' })
    expect(preview.steps.find(step => step.name === 'Comment the preview URL')?.run)
      .toContain('<!-- alpha-preview-url -->')
  })

  it('retains per-PR deployment, protected image verification, and idempotent URL comments', () => {
    expect(workflow.concurrency).toEqual({
      group: 'build-preview-cloudflare-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    })
    const shape = preview.steps.find(step => step.name === 'Shape the upload')!
    expect(shape.run).toContain("find apps/web/dist -name '*.map' -delete")
    expect(shape.run).toContain('cp apps/web/dist/preview.html apps/web/dist/index.html')
    const deploy = preview.steps.find(step => step.name === 'Upload to Cloudflare Pages')!
    expect(deploy.run).toContain('npx --yes wrangler@4 pages deploy apps/web/dist')
    expect(deploy.run).toContain('--branch "pr-${{ github.event.pull_request.number }}"')
    const verify = preview.steps.find(step => step.name === 'Verify the protected deployment serves the image')!
    expect(verify.run).toContain('/preview/vfs-image.tar.gz')
    expect(verify.run).toContain('"$code" != "200"')
    expect(verify.run).toContain('content-encoding:')
    expect(verify.run).toContain('"$magic" != "1f8b"')
    expect(verify.env?.CF_ACCESS_CLIENT_SECRET).toBe('${{ secrets.CF_ACCESS_CLIENT_SECRET }}')
    const comment = preview.steps.find(step => step.name === 'Comment the preview URL')!
    expect(comment.run).toContain('gh pr comment "$PR" --body-file -')
  })

  it('keeps the immutable full build and restore-only dependency cache', () => {
    expect(workflow.env.PRIMARY_NODE_VERSION).toBe('24')
    expect(workflow.env.DSH_TELEMETRY_DISABLED).toBe('1')
    const commands = preview.steps.map(step => step.run)
    expect(commands).toContain('pnpm install --frozen-lockfile')
    expect(commands).toContain('pnpm run build')
    expect(commands).toContain('pnpm --filter @mutantcat/dsh-web-frontend run build:preview')
    expect(commands.indexOf('pnpm run build')).toBeLessThan(commands.indexOf('pnpm --filter @mutantcat/dsh-web-frontend run build:preview'))
    expect(preview.steps.filter(step => step.uses?.startsWith('actions/cache'))).toHaveLength(1)
    expect(preview.steps.find(step => step.uses === 'actions/cache/restore@v4')?.with).toMatchObject({
      key: "${{ runner.os }}-node-${{ env.PRIMARY_NODE_VERSION }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}",
    })
  })

  it('keeps the PR comment idempotent across pushes', () => {
    expect(preview.steps.find(step => step.name === 'Comment the preview URL')?.run)
      .toContain('if [ -n "$existing" ]; then')
  })
})

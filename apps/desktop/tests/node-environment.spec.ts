import { delimiter } from 'node:path'
import { expect, it } from 'vitest'
import { desktopNodeEnvironment } from '../src/node-environment.ts'

it('keeps the caller environment unchanged when no launcher directory is supplied', () => {
  const environment = { PATH: '/user/bin', HOME: '/user' }
  expect(desktopNodeEnvironment(undefined, environment)).toEqual(environment)
  expect(environment).toEqual({ PATH: '/user/bin', HOME: '/user' })
})

it('prepends the launcher directory to PATH for package installation processes', () => {
  expect(desktopNodeEnvironment('/bundled/bin', { PATH: '/user/bin' })).toEqual({
    PATH: `/bundled/bin${delimiter}/user/bin`,
  })
})

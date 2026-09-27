import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@mutantcat/dsh-api-terminal-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)

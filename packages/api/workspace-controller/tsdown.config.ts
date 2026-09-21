import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@mutantcat/dsh-api-workspace-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)

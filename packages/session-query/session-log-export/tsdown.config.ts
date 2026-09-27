import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@mutantcat/dsh-session-log-export',
  ['lib/types/index.js'],
  { hostPhase: true },
)

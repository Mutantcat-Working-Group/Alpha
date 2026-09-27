import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@mutantcat/dsh-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)

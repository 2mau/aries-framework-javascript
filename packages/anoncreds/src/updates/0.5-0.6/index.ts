import type { BaseAgent } from '@credo-ts/core'

import { storeAnonCredsInW3cFormatV0_5 } from './anonCredsCredentialRecord'

export async function partialUpdatesForV0_5ToV0_6<Agent extends BaseAgent>(agent: Agent): Promise<boolean> {
  return await storeAnonCredsInW3cFormatV0_5(agent)
}

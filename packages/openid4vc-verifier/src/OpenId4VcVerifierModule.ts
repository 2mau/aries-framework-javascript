import type { DependencyManager, Module } from '@aries-framework/core'

import { AgentConfig } from '@aries-framework/core'

import { OpenId4VcVerifierApi } from './OpenId4VcVerifierApi'
import { OpenId4VcVerifierService } from './OpenId4VcVerifierService'

/**
 * @public
 */
export class OpenId4VcVerifierModule implements Module {
  public readonly api = OpenId4VcVerifierApi

  /**
   * Registers the dependencies of the question answer module on the dependency manager.
   */
  public register(dependencyManager: DependencyManager) {
    // Warn about experimental module
    dependencyManager
      .resolve(AgentConfig)
      .logger.warn(
        "The '@aries-framework/openid4vc-verifier' module is experimental and could have unexpected breaking changes. When using this module, make sure to use strict versions for all @aries-framework packages."
      )

    // Api
    dependencyManager.registerContextScoped(OpenId4VcVerifierApi)

    // Services
    dependencyManager.registerSingleton(OpenId4VcVerifierService)
  }
}
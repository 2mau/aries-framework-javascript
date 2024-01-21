import type { OpenId4VcVerifierModuleConfigOptions } from './OpenId4VcVerifierModuleConfig'
import type { OpenId4VcVerificationRequest } from './router'
import type { AgentContext, DependencyManager, Module } from '@aries-framework/core'

import { AgentConfig } from '@aries-framework/core'

import { getAgentContextForActorId, getRequestContext, importExpress } from '../shared/router'

import { OpenId4VcVerifierApi } from './OpenId4VcVerifierApi'
import { OpenId4VcVerifierModuleConfig } from './OpenId4VcVerifierModuleConfig'
import { OpenId4VcVerifierService } from './OpenId4VcVerifierService'
import { OpenId4VcVerifierRepository } from './repository'
import { configureAuthorizationEndpoint } from './router'

/**
 * @public
 */
export class OpenId4VcVerifierModule implements Module {
  public readonly api = OpenId4VcVerifierApi
  public readonly config: OpenId4VcVerifierModuleConfig

  public constructor(options: OpenId4VcVerifierModuleConfigOptions) {
    this.config = new OpenId4VcVerifierModuleConfig(options)
  }

  /**
   * Registers the dependencies of the question answer module on the dependency manager.
   */
  public register(dependencyManager: DependencyManager) {
    // Warn about experimental module
    const logger = dependencyManager.resolve(AgentConfig).logger
    logger.warn(
      "The '@aries-framework/openid4vc' Verifier module is experimental and could have unexpected breaking changes. When using this module, make sure to use strict versions for all @aries-framework packages."
    )

    // Register config
    dependencyManager.registerInstance(OpenId4VcVerifierModuleConfig, this.config)

    // Api
    dependencyManager.registerContextScoped(OpenId4VcVerifierApi)

    // Services
    dependencyManager.registerSingleton(OpenId4VcVerifierService)

    // Repository
    dependencyManager.registerSingleton(OpenId4VcVerifierRepository)
  }

  public async initialize(rootAgentContext: AgentContext): Promise<void> {
    this.configureRouter(rootAgentContext)
  }

  /**
   * Registers the endpoints on the router passed to this module.
   */
  private configureRouter(rootAgentContext: AgentContext) {
    const { Router, json, urlencoded } = importExpress()

    // We use separate context router and endpoint router. Context router handles the linking of the request
    // to a specific agent context. Endpoint router only knows about a single context
    const endpointRouter = Router()
    const contextRouter = this.config.router

    // parse application/x-www-form-urlencoded
    contextRouter.use(urlencoded({ extended: false }))
    // parse application/json
    contextRouter.use(json())

    contextRouter.param('verifierId', async (req: OpenId4VcVerificationRequest, _res, next, verifierId: string) => {
      if (!verifierId) {
        _res.status(404).send('Not found')
      }

      let agentContext: AgentContext | undefined = undefined

      try {
        agentContext = await getAgentContextForActorId(rootAgentContext, verifierId)
        const verifierApi = agentContext.dependencyManager.resolve(OpenId4VcVerifierApi)
        const verifier = await verifierApi.getByVerifierId(verifierId)

        req.requestContext = {
          agentContext,
          verifier,
        }
      } catch (error) {
        agentContext?.config.logger.error(
          'Failed to correlate incoming openid request to existing tenant and verifier',
          {
            error,
          }
        )
        // If the opening failed
        await agentContext?.endSession()
        return _res.status(404).send('Not found')
      }

      next()
    })

    contextRouter.use('/:verifierId', endpointRouter)

    // Configure endpoints
    configureAuthorizationEndpoint(endpointRouter, this.config.authorizationEndpoint)

    // FIXME: Will this be called when an error occurs / 404 is returned earlier on?
    contextRouter.use(async (req: OpenId4VcVerificationRequest, _res, next) => {
      const { agentContext } = getRequestContext(req)
      await agentContext.endSession()
      next()
    })
  }
}
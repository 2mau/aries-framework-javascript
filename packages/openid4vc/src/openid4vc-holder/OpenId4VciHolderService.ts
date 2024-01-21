import type {
  OpenId4VciCredentialOfferPayload,
  OpenId4VciCredentialSupported,
  OpenId4VciCredentialSupportedWithId,
  OpenId4VciIssuerMetadata,
} from '../shared'
import type { AgentContext, JwaSignatureAlgorithm, W3cVerifiableCredential, Key, JwkJson } from '@aries-framework/core'
import type { SdJwtVcModule, SdJwtVc } from '@aries-framework/sd-jwt-vc'
import type {
  AccessTokenResponse,
  CredentialResponse,
  Jwt,
  OpenIDResponse,
  PushedAuthorizationResponse,
  AuthorizationDetails,
  AuthorizationDetailsJwtVcJson,
} from '@sphereon/oid4vci-common'

import {
  getJwkFromJson,
  DidsApi,
  AriesFrameworkError,
  Hasher,
  InjectionSymbols,
  JsonEncoder,
  JwsService,
  Logger,
  SignatureSuiteRegistry,
  TypedArrayEncoder,
  W3cCredentialService,
  W3cJsonLdVerifiableCredential,
  W3cJwtVerifiableCredential,
  getJwkClassFromJwaSignatureAlgorithm,
  getJwkFromKey,
  getKeyFromVerificationMethod,
  getSupportedVerificationMethodTypesFromKeyType,
  inject,
  injectable,
  parseDid,
  getApiForModuleByName,
} from '@aries-framework/core'
import {
  AccessTokenClient,
  CredentialRequestClientBuilder,
  ProofOfPossessionBuilder,
  formPost,
  OpenID4VCIClient,
} from '@sphereon/oid4vci-client'
import { CodeChallengeMethod, ResponseType, convertJsonToURI, JsonURIMode } from '@sphereon/oid4vci-common'

import { OpenId4VciCredentialFormatProfile } from '../shared'
import {
  getTypesFromCredentialSupported,
  handleAuthorizationDetails,
  getOfferedCredentials,
} from '../shared/issuerMetadataUtils'
import { getSupportedJwaSignatureAlgorithms } from '../shared/utils'

import {
  type AuthCodeFlowOptions,
  type AcceptCredentialOfferOptions,
  type ProofOfPossessionRequirements,
  type CredentialBindingResolver,
  type ResolvedCredentialOffer,
  type ResolvedAuthorizationRequest,
  type ResolvedAuthorizationRequestWithCode,
  type SupportedCredentialFormats,
  supportedCredentialFormats,
} from './OpenId4VciHolderServiceOptions'

// FIXME: this is also defined in the sphereon lib, is there a reason we don't use that one?
async function createAuthorizationRequestUri(options: {
  credentialOffer: OpenId4VciCredentialOfferPayload
  metadata: ResolvedCredentialOffer['metadata']
  clientId: string
  codeChallenge: string
  codeChallengeMethod: CodeChallengeMethod
  authDetails?: AuthorizationDetails | AuthorizationDetails[]
  redirectUri: string
  scope?: string[]
}) {
  const { scope, authDetails, metadata, clientId, codeChallenge, codeChallengeMethod, redirectUri } = options
  let nonEmptyScope = !scope || scope.length === 0 ? undefined : scope
  const nonEmptyAuthDetails = !authDetails || authDetails.length === 0 ? undefined : authDetails

  // Scope and authorization_details can be used in the same authorization request
  // https://datatracker.ietf.org/doc/html/draft-ietf-oauth-rar-23#name-relationship-to-scope-param
  if (!nonEmptyScope && !nonEmptyAuthDetails) {
    throw new AriesFrameworkError(`Please provide a 'scope' or 'authDetails' via the options.`)
  }

  // Authorization servers supporting PAR SHOULD include the URL of their pushed authorization request endpoint in their authorization server metadata document
  // Note that the presence of pushed_authorization_request_endpoint is sufficient for a client to determine that it may use the PAR flow.
  const parEndpoint = metadata.credentialIssuerMetadata.pushed_authorization_request_endpoint

  const authorizationEndpoint = metadata.credentialIssuerMetadata?.authorization_endpoint

  if (!authorizationEndpoint && !parEndpoint) {
    throw new AriesFrameworkError(
      "Server metadata does not contain an 'authorization_endpoint' which is required for the 'Authorization Code Flow'"
    )
  }

  // add 'openid' scope if not present
  if (nonEmptyScope && !nonEmptyScope?.includes('openid')) {
    nonEmptyScope = ['openid', ...nonEmptyScope]
  }

  const queryObj: Record<string, string> = {
    client_id: clientId,
    response_type: ResponseType.AUTH_CODE,
    code_challenge_method: codeChallengeMethod,
    code_challenge: codeChallenge,
    redirect_uri: redirectUri,
  }

  if (nonEmptyScope) queryObj['scope'] = nonEmptyScope.join(' ')

  if (nonEmptyAuthDetails)
    queryObj['authorization_details'] = JSON.stringify(handleAuthorizationDetails(nonEmptyAuthDetails, metadata))

  const issuerState = options.credentialOffer.grants?.authorization_code?.issuer_state
  if (issuerState) queryObj['issuer_state'] = issuerState

  if (parEndpoint) {
    const body = new URLSearchParams(queryObj)
    const response = await formPost<PushedAuthorizationResponse>(parEndpoint, body)
    if (!response.successBody) {
      throw new AriesFrameworkError(`Could not acquire the authorization request uri from '${parEndpoint}'`)
    }
    return convertJsonToURI(
      { request_uri: response.successBody.request_uri, client_id: clientId, response_type: ResponseType.AUTH_CODE },
      {
        baseUrl: authorizationEndpoint,
        uriTypeProperties: ['request_uri', 'client_id', 'response_type'],
        mode: JsonURIMode.X_FORM_WWW_URLENCODED,
      }
    )
  } else {
    return convertJsonToURI(queryObj, {
      baseUrl: authorizationEndpoint,
      uriTypeProperties: ['redirect_uri', 'scope', 'authorization_details', 'issuer_state'],
      mode: JsonURIMode.X_FORM_WWW_URLENCODED,
    })
  }
}

@injectable()
export class OpenId4VciHolderService {
  private logger: Logger
  private w3cCredentialService: W3cCredentialService
  private jwsService: JwsService

  public constructor(
    @inject(InjectionSymbols.Logger) logger: Logger,
    w3cCredentialService: W3cCredentialService,
    jwsService: JwsService
  ) {
    this.w3cCredentialService = w3cCredentialService
    this.jwsService = jwsService
    this.logger = logger
  }

  public async resolveCredentialOffer(credentialOffer: string): Promise<ResolvedCredentialOffer> {
    const client = await OpenID4VCIClient.fromURI({
      uri: credentialOffer,
      resolveOfferUri: true,
      retrieveServerMetadata: true,
    })

    if (!client.credentialOffer?.credential_offer) {
      throw new AriesFrameworkError(`Could not resolve credential offer from '${credentialOffer}'`)
    }
    const credentialOfferPayload: OpenId4VciCredentialOfferPayload = client.credentialOffer?.credential_offer

    const metadata = await client.retrieveServerMetadata()
    if (!metadata.credentialIssuerMetadata) {
      throw new AriesFrameworkError(`Could not retrieve issuer metadata from '${metadata.issuer}'`)
    }
    const issuerMetadata = metadata.credentialIssuerMetadata as OpenId4VciIssuerMetadata

    this.logger.info('Fetched server metadata', {
      issuer: metadata.issuer,
      credentialEndpoint: metadata.credential_endpoint,
      tokenEndpoint: metadata.token_endpoint,
    })

    this.logger.debug('Full server metadata', metadata)

    return {
      metadata: {
        ...metadata,
        credentialIssuerMetadata: issuerMetadata,
      },
      credentialOfferPayload,
      offeredCredentials: getOfferedCredentials(
        credentialOfferPayload.credentials,
        issuerMetadata.credentials_supported
      ),
      version: client.version(),
    }
  }

  private getAuthDetailsFromOfferedCredential(
    offeredCredential: OpenId4VciCredentialSupported,
    authDetailsLocation: string | undefined
  ): AuthorizationDetails | undefined {
    const { format } = offeredCredential
    const type = 'openid_credential'

    const locations = authDetailsLocation ? [authDetailsLocation] : undefined
    if (format === OpenId4VciCredentialFormatProfile.JwtVcJson) {
      return { type, format, types: offeredCredential.types, locations } satisfies AuthorizationDetailsJwtVcJson
    } else if (
      format === OpenId4VciCredentialFormatProfile.LdpVc ||
      format === OpenId4VciCredentialFormatProfile.JwtVcJsonLd
    ) {
      const credential_definition = {
        '@context': offeredCredential['@context'],
        credentialSubject: offeredCredential.credentialSubject,
        types: offeredCredential.types,
      }

      return { type, format, locations, credential_definition }
    } else if (format === OpenId4VciCredentialFormatProfile.SdJwtVc) {
      return {
        type,
        format,
        locations,
        vct: offeredCredential.vct,
        claims: offeredCredential.claims,
      }
    } else {
      throw new AriesFrameworkError(`Cannot create authorization_details. Unsupported credential format '${format}'.`)
    }
  }

  // FIXME: this is an oid4vci authorization request
  // while we also support siop/oid4vp authorization requests
  // need to make sure difference is clear
  public async resolveAuthorizationRequest(
    agentContext: AgentContext,
    resolvedCredentialOffer: ResolvedCredentialOffer,
    authCodeFlowOptions: AuthCodeFlowOptions
  ): Promise<ResolvedAuthorizationRequest> {
    const { credentialOfferPayload, metadata, offeredCredentials } = resolvedCredentialOffer
    const codeVerifier = `${await agentContext.wallet.generateNonce()}${await agentContext.wallet.generateNonce()}`
    const codeVerifierSha256 = Hasher.hash(TypedArrayEncoder.fromString(codeVerifier), 'sha2-256')
    const codeChallenge = TypedArrayEncoder.toBase64URL(codeVerifierSha256)

    this.logger.debug('Converted code_verifier to code_challenge', {
      codeVerifier: codeVerifier,
      sha256: codeVerifierSha256.toString(),
      base64Url: codeChallenge,
    })

    const authDetailsLocation = metadata.credentialIssuerMetadata.authorization_server
      ? metadata.credentialIssuerMetadata.authorization_server
      : undefined
    const authDetails = offeredCredentials
      .map((credential) => this.getAuthDetailsFromOfferedCredential(credential, authDetailsLocation))
      .filter((authDetail): authDetail is AuthorizationDetails => authDetail !== undefined)

    const { clientId, redirectUri, scope } = authCodeFlowOptions
    const authorizationRequestUri = await createAuthorizationRequestUri({
      clientId,
      codeChallenge,
      redirectUri,
      credentialOffer: credentialOfferPayload,
      codeChallengeMethod: CodeChallengeMethod.SHA256,
      // TODO: Read HAIP SdJwtVc's should always be requested via scopes
      // TODO: should we now always use scopes instead of authDetails? or both????
      scope: scope ?? [],
      authDetails,
      metadata,
    })

    return {
      ...authCodeFlowOptions,
      codeVerifier,
      authorizationRequestUri,
    }
  }

  public async acceptCredentialOffer(
    agentContext: AgentContext,
    options: {
      resolvedCredentialOffer: ResolvedCredentialOffer
      acceptCredentialOfferOptions: AcceptCredentialOfferOptions
      resolvedAuthorizationRequestWithCode?: ResolvedAuthorizationRequestWithCode
    }
  ) {
    const { resolvedCredentialOffer, acceptCredentialOfferOptions, resolvedAuthorizationRequestWithCode } = options
    const { credentialOfferPayload, metadata, version, offeredCredentials } = resolvedCredentialOffer

    const { credentialsToRequest, userPin, credentialBindingResolver, verifyCredentialStatus } =
      acceptCredentialOfferOptions

    if (credentialsToRequest?.length === 0) {
      this.logger.warn(`Accepting 0 credential offers. Returning`)
      return []
    }

    this.logger.info(`Accepting the following credential offers '${credentialsToRequest}'`)

    const supportedJwaSignatureAlgorithms = getSupportedJwaSignatureAlgorithms(agentContext)

    const allowedProofOfPossessionSigAlgs = acceptCredentialOfferOptions.allowedProofOfPossessionSignatureAlgorithms
    const possibleProofOfPossessionSigAlgs = allowedProofOfPossessionSigAlgs
      ? allowedProofOfPossessionSigAlgs.filter((algorithm) => supportedJwaSignatureAlgorithms.includes(algorithm))
      : supportedJwaSignatureAlgorithms

    if (possibleProofOfPossessionSigAlgs.length === 0) {
      throw new AriesFrameworkError(
        [
          `No possible proof of possession signature algorithm found.`,
          `Signature algorithms supported by the Agent '${supportedJwaSignatureAlgorithms.join(', ')}'`,
          `Allowed Signature algorithms '${allowedProofOfPossessionSigAlgs?.join(', ')}'`,
        ].join('\n')
      )
    }

    // acquire the access token
    let accessTokenResponse: OpenIDResponse<AccessTokenResponse>

    const accessTokenClient = new AccessTokenClient()
    if (resolvedAuthorizationRequestWithCode) {
      const { code, codeVerifier, redirectUri } = resolvedAuthorizationRequestWithCode
      accessTokenResponse = await accessTokenClient.acquireAccessToken({
        metadata: metadata,
        credentialOffer: { credential_offer: credentialOfferPayload },
        pin: userPin,
        code,
        codeVerifier,
        redirectUri,
      })
    } else {
      accessTokenResponse = await accessTokenClient.acquireAccessToken({
        metadata: metadata,
        credentialOffer: { credential_offer: credentialOfferPayload },
        pin: userPin,
      })
    }

    if (!accessTokenResponse.successBody) {
      throw new AriesFrameworkError(`could not acquire access token from '${metadata.issuer}'.`)
    }

    this.logger.debug('Requested OpenId4VCI Access Token.')

    const accessToken = accessTokenResponse.successBody
    const receivedCredentials: Array<W3cVerifiableCredential | SdJwtVc> = []
    let newCNonce: string | undefined

    for (const offeredCredential of credentialsToRequest ?? offeredCredentials) {
      // Get all options for the credential request (such as which kid to use, the signature algorithm, etc)
      const { credentialBinding, signatureAlgorithm } = await this.getCredentialRequestOptions(agentContext, {
        possibleProofOfPossessionSignatureAlgorithms: possibleProofOfPossessionSigAlgs,
        offeredCredential,
        credentialBindingResolver,
      })

      // Create the proof of possession
      const proofOfPossessionBuilder = ProofOfPossessionBuilder.fromAccessTokenResponse({
        accessTokenResponse: accessToken,
        callbacks: { signCallback: this.proofOfPossessionSignCallback(agentContext) },
        version,
      })
        .withEndpointMetadata(metadata)
        .withAlg(signatureAlgorithm)

      if (credentialBinding.method === 'did') {
        proofOfPossessionBuilder.withClientId(parseDid(credentialBinding.didUrl).did).withKid(credentialBinding.didUrl)
      } else if (credentialBinding.method === 'jwk') {
        proofOfPossessionBuilder.withJWK(credentialBinding.jwk.toJson())
      }

      if (newCNonce) proofOfPossessionBuilder.withAccessTokenNonce(newCNonce)

      const proofOfPossession = await proofOfPossessionBuilder.build()
      this.logger.debug('Generated JWS', proofOfPossession)

      // Acquire the credential
      const credentialRequestBuilder = new CredentialRequestClientBuilder()
      credentialRequestBuilder
        .withVersion(version)
        .withCredentialEndpoint(metadata.credential_endpoint)
        .withTokenFromResponse(accessToken)

      const credentialRequestClient = credentialRequestBuilder.build()
      const credentialResponse = await credentialRequestClient.acquireCredentialsUsingProof({
        proofInput: proofOfPossession,
        credentialTypes: getTypesFromCredentialSupported(offeredCredential),
        format: offeredCredential.format,
      })

      newCNonce = credentialResponse.successBody?.c_nonce

      // Create credential, but we don't store it yet (only after the user has accepted the credential)
      const credential = await this.handleCredentialResponse(agentContext, credentialResponse, {
        verifyCredentialStatus: verifyCredentialStatus ?? false,
      })

      this.logger.debug('Full credential', credential)
      receivedCredentials.push(credential)
    }

    return receivedCredentials
  }

  /**
   * Get the options for the credential request. Internally this will resolve the proof of possession
   * requirements, and based on that it will call the proofOfPossessionVerificationMethodResolver to
   * allow the caller to select the correct verification method based on the requirements for the proof
   * of possession.
   */
  private async getCredentialRequestOptions(
    agentContext: AgentContext,
    options: {
      credentialBindingResolver: CredentialBindingResolver
      possibleProofOfPossessionSignatureAlgorithms: JwaSignatureAlgorithm[]
      offeredCredential: OpenId4VciCredentialSupportedWithId
    }
  ) {
    const { signatureAlgorithm, supportedDidMethods, supportsAllDidMethods, supportsJwk } =
      this.getProofOfPossessionRequirements(agentContext, {
        credentialToRequest: options.offeredCredential,
        possibleProofOfPossessionSignatureAlgorithms: options.possibleProofOfPossessionSignatureAlgorithms,
      })

    const JwkClass = getJwkClassFromJwaSignatureAlgorithm(signatureAlgorithm)
    if (!JwkClass) {
      throw new AriesFrameworkError(
        `Could not determine JWK key type of the JWA signature algorithm '${signatureAlgorithm}'`
      )
    }

    const supportedVerificationMethods = getSupportedVerificationMethodTypesFromKeyType(JwkClass.keyType)

    const format = options.offeredCredential.format as SupportedCredentialFormats

    // Now we need to determine how the credential will be bound to us
    const credentialBinding = await options.credentialBindingResolver({
      credentialFormat: format,
      signatureAlgorithm,
      supportedVerificationMethods,
      keyType: JwkClass.keyType,
      supportedCredentialId: options.offeredCredential.id,
      supportsAllDidMethods,
      supportedDidMethods,
      supportsJwk,
    })

    // Make sure the issuer of proof of possession is valid according to openid issuer metadata
    if (
      credentialBinding.method === 'did' &&
      !supportsAllDidMethods &&
      // If supportedDidMethods is undefined, it means the issuer didn't include the binding methods in the metadata
      // The user can still select a verification method, but we can't validate it
      supportedDidMethods !== undefined &&
      !supportedDidMethods.find((supportedDidMethod) => credentialBinding.didUrl.startsWith(supportedDidMethod))
    ) {
      const { method } = parseDid(credentialBinding.didUrl)
      const supportedDidMethodsString = supportedDidMethods.join(', ')
      throw new AriesFrameworkError(
        `Resolved credential binding for proof of possession uses did method '${method}', but issuer only supports '${supportedDidMethodsString}'`
      )
    } else if (credentialBinding.method === 'jwk' && !supportsJwk) {
      throw new AriesFrameworkError(
        `Resolved credential binding for proof of possession uses jwk, but openid issuer does not support 'jwk' cryptographic binding method`
      )
    }

    // FIXME: we don't have the verification method here
    // Make sure the verification method uses a supported verification method type
    // if (!supportedVerificationMethods.includes(verificationMethod.type)) {
    //   const supportedVerificationMethodsString = supportedVerificationMethods.join(', ')
    //   throw new AriesFrameworkError(
    //     `Verification method uses verification method type '${verificationMethod.type}', but only '${supportedVerificationMethodsString}' verification methods are supported for key type '${JwkClass.keyType}'`
    //   )
    // }

    return { credentialBinding, signatureAlgorithm }
  }

  /**
   * Get the requirements for creating the proof of possession. Based on the allowed
   * credential formats, the allowed proof of possession signature algorithms, and the
   * credential type, this method will select the best credential format and signature
   * algorithm to use, based on the order of preference.
   */
  private getProofOfPossessionRequirements(
    agentContext: AgentContext,
    options: {
      credentialToRequest: OpenId4VciCredentialSupportedWithId
      possibleProofOfPossessionSignatureAlgorithms: JwaSignatureAlgorithm[]
    }
  ): ProofOfPossessionRequirements {
    const { credentialToRequest } = options

    if (!supportedCredentialFormats.includes(credentialToRequest.format as SupportedCredentialFormats)) {
      throw new AriesFrameworkError(
        [
          `Requested credential with format '${credentialToRequest.format}',`,
          `for the credential with id '${credentialToRequest.id},`,
          `but the wallet only supports the following formats '${supportedCredentialFormats.join(', ')}'`,
        ].join('\n')
      )
    }

    // For each of the supported algs, find the key types, then find the proof types
    const signatureSuiteRegistry = agentContext.dependencyManager.resolve(SignatureSuiteRegistry)

    let signatureAlgorithm: JwaSignatureAlgorithm | undefined

    const issuerSupportedCryptographicSuites = credentialToRequest.cryptographic_suites_supported
    const issuerSupportedBindingMethods = credentialToRequest.cryptographic_binding_methods_supported

    // If undefined, it means the issuer didn't include the cryptographic suites in the metadata
    // We just guess that the first one is supported
    if (issuerSupportedCryptographicSuites === undefined) {
      signatureAlgorithm = options.possibleProofOfPossessionSignatureAlgorithms[0]
    } else {
      switch (credentialToRequest.format) {
        case OpenId4VciCredentialFormatProfile.JwtVcJson:
        case OpenId4VciCredentialFormatProfile.JwtVcJsonLd:
        case OpenId4VciCredentialFormatProfile.SdJwtVc:
          signatureAlgorithm = options.possibleProofOfPossessionSignatureAlgorithms.find((signatureAlgorithm) =>
            issuerSupportedCryptographicSuites.includes(signatureAlgorithm)
          )
          break
        case OpenId4VciCredentialFormatProfile.LdpVc:
          signatureAlgorithm = options.possibleProofOfPossessionSignatureAlgorithms.find((signatureAlgorithm) => {
            const JwkClass = getJwkClassFromJwaSignatureAlgorithm(signatureAlgorithm)
            if (!JwkClass) return false

            const matchingSuite = signatureSuiteRegistry.getByKeyType(JwkClass.keyType)
            if (matchingSuite.length === 0) return false

            return issuerSupportedCryptographicSuites.includes(matchingSuite[0].proofType)
          })
          break
        default:
          throw new AriesFrameworkError(`Unsupported credential format.`)
      }
    }

    if (!signatureAlgorithm) {
      throw new AriesFrameworkError(
        `Could not establish signature algorithm for format ${credentialToRequest.format} and id ${credentialToRequest.id}`
      )
    }

    const supportsAllDidMethods = issuerSupportedBindingMethods?.includes('did') ?? false
    const supportedDidMethods = issuerSupportedBindingMethods?.filter((method) => method.startsWith('did:'))
    const supportsJwk = issuerSupportedBindingMethods?.includes('jwk') ?? false

    return {
      signatureAlgorithm,
      supportedDidMethods,
      supportsAllDidMethods,
      supportsJwk,
    }
  }

  private async handleCredentialResponse(
    agentContext: AgentContext,
    credentialResponse: OpenIDResponse<CredentialResponse>,
    options: { verifyCredentialStatus: boolean }
  ): Promise<SdJwtVc | W3cVerifiableCredential> {
    const { verifyCredentialStatus } = options
    this.logger.debug('Credential request response', credentialResponse)

    if (!credentialResponse.successBody || !credentialResponse.successBody.credential) {
      throw new AriesFrameworkError('Did not receive a successful credential response.')
    }

    const format = credentialResponse.successBody.format
    if (format === OpenId4VciCredentialFormatProfile.SdJwtVc) {
      if (typeof credentialResponse.successBody.credential !== 'string')
        throw new AriesFrameworkError(
          `Received a credential of format ${
            OpenId4VciCredentialFormatProfile.SdJwtVc
          }, but the credential is not a string. ${JSON.stringify(credentialResponse.successBody.credential)}`
        )

      const sdJwtVcApi = getApiForModuleByName<SdJwtVcModule>(agentContext, 'SdJwtVcModule')
      if (!sdJwtVcApi) throw new AriesFrameworkError(`Could not find the SdJwtVcApi`)
      const { verification, sdJwtVc } = await sdJwtVcApi.verify({
        compactSdJwtVc: credentialResponse.successBody.credential,
      })

      if (!verification.isValid) {
        agentContext.config.logger.error('Failed to validate credential', { verification })
        throw new AriesFrameworkError(
          `Failed to validate sd-jwt-vc credential. Results = ${JSON.stringify(verification)}`
        )
      }

      return sdJwtVc
    } else if (
      format === OpenId4VciCredentialFormatProfile.JwtVcJson ||
      format === OpenId4VciCredentialFormatProfile.JwtVcJsonLd
    ) {
      const credential = W3cJwtVerifiableCredential.fromSerializedJwt(
        credentialResponse.successBody.credential as string
      )
      const result = await this.w3cCredentialService.verifyCredential(agentContext, {
        credential,
        verifyCredentialStatus,
      })
      if (!result.isValid) {
        agentContext.config.logger.error('Failed to validate credential', { result })
        throw new AriesFrameworkError(`Failed to validate credential, error = ${result.error?.message ?? 'Unknown'}`)
      }

      return credential
    } else if (format === OpenId4VciCredentialFormatProfile.LdpVc) {
      const credential = W3cJsonLdVerifiableCredential.fromJson(
        credentialResponse.successBody.credential as Record<string, unknown>
      )
      const result = await this.w3cCredentialService.verifyCredential(agentContext, {
        credential,
        verifyCredentialStatus,
      })
      if (!result.isValid) {
        agentContext.config.logger.error('Failed to validate credential', { result })
        throw new AriesFrameworkError(`Failed to validate credential, error = ${result.error?.message ?? 'Unknown'}`)
      }

      return credential
    }

    throw new AriesFrameworkError(`Unsupported credential format ${credentialResponse.successBody.format}`)
  }

  private proofOfPossessionSignCallback(agentContext: AgentContext) {
    return async (jwt: Jwt, kid?: string) => {
      if (!jwt.header) throw new AriesFrameworkError('No header present on JWT')
      if (!jwt.payload) throw new AriesFrameworkError('No payload present on JWT')
      if (kid && jwt.header.jwk) {
        throw new AriesFrameworkError('Both KID and JWK are present in the callback. Only one can be present')
      }

      let key: Key

      if (kid) {
        if (!kid.startsWith('did:')) {
          throw new AriesFrameworkError(`kid '${kid}' is not a DID. Only dids are supported for kid`)
        } else if (!kid.includes('#')) {
          throw new AriesFrameworkError(
            `kid '${kid}' does not contain a fragment. kid MUST point to a specific key in the did document.`
          )
        }

        const didsApi = agentContext.dependencyManager.resolve(DidsApi)
        const didDocument = await didsApi.resolveDidDocument(kid)
        const verificationMethod = didDocument.dereferenceKey(kid, ['authentication'])

        key = getKeyFromVerificationMethod(verificationMethod)
      } else if (jwt.header.jwk) {
        key = getJwkFromJson(jwt.header.jwk as JwkJson).key
      } else {
        throw new AriesFrameworkError('No KID or JWK is present in the callback')
      }

      const jwk = getJwkFromKey(key)
      if (!jwk.supportsSignatureAlgorithm(jwt.header.alg)) {
        throw new AriesFrameworkError(
          `key type '${jwk.keyType}', does not support the JWS signature alg '${jwt.header.alg}'`
        )
      }

      // We don't support these properties, remove them, so we can pass all other header properties to the JWS service
      if (jwt.header.x5c) throw new AriesFrameworkError('x5c is not supported')

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { x5c: _x5c, ...supportedHeaderOptions } = jwt.header

      const jws = await this.jwsService.createJwsCompact(agentContext, {
        key,
        payload: JsonEncoder.toBuffer(jwt.payload),
        protectedHeaderOptions: {
          ...supportedHeaderOptions,
          // only pass jwk if it was present in the header
          jwk: jwt.header.jwk ? jwk : undefined,
        },
      })

      return jws
    }
  }
}
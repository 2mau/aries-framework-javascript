/* eslint-disable @typescript-eslint/no-explicit-any */
import { AskarModule } from '@aries-framework/askar'
import {
  type ProofPayload,
  type ProofRequestMetadata,
  type CreateProofRequestOptions,
  Scope,
  SubjectType,
  ResponseType,
  SigningAlgo,
  PassBy,
} from '@aries-framework/openid4vc-verifier'
import { OpenId4VcVerifierModule } from '@aries-framework/openid4vc-verifier/src/OpenId4VcVerifierModule'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
import bodyParser from 'body-parser'

import { BaseAgent } from './BaseAgent'
import { Output, purpleText } from './OutputClass'

// create application/x-www-form-urlencoded parser
const urlencodedParser = bodyParser.urlencoded({ extended: false })

const universityDegreePresentationDefinition = {
  id: 'UniversityDegreeCredential',
  purpose: 'Present your UniversityDegreeCredential to verify your education level.',
  input_descriptors: [
    {
      id: 'UniversityDegreeCredential',
      // changed jwt_vc_json to jwt_vc
      format: { jwt_vc: { alg: ['EdDSA'] } },
      // changed $.type to $.vc.type
      constraints: {
        fields: [{ path: ['$.vc.type.*'], filter: { type: 'string', pattern: 'UniversityDegree' } }],
      },
    },
  ],
}

function getOpenIdVerifierModules() {
  return {
    askar: new AskarModule({ ariesAskar }),
    openId4VcVerifier: new OpenId4VcVerifierModule(),
  } as const
}

export class Verifier extends BaseAgent<ReturnType<typeof getOpenIdVerifierModules>> {
  private proofRequestMetadata?: ProofRequestMetadata
  private proofRequestOptions?: CreateProofRequestOptions

  public constructor(port: number, name: string) {
    super({ port, name, modules: getOpenIdVerifierModules() })
  }

  public static async build(): Promise<Verifier> {
    const verifier = new Verifier(4000, 'OpenId4VcVerifier' + Math.random().toString())
    await verifier.initializeAgent('96213c3d7fc8d4d6754c7a0fd969598f')

    verifier.app.post('/proofResponse', urlencodedParser, async (req, res) => {
      await verifier.verifyProofResponse({
        presentation_submission: JSON.parse(req.body.presentation_submission),
        id_token: req.body.id_token,
        vp_token: req.body.vp_token,
      })

      res.status(200).send()
    })

    return verifier
  }

  public async createUniversityDegreeProofRequest() {
    const createProofRequestOptions: CreateProofRequestOptions = {
      redirectUri: `http://localhost:${this.port}/proofResponse`,
      verificationMethod: this.verificationMethod,
      presentationDefinition: universityDegreePresentationDefinition,

      holderMetadata: {
        authorization_endpoint: 'openid:',
        subject_syntax_types_supported: ['did:key'],
        responseTypesSupported: [ResponseType.ID_TOKEN, ResponseType.VP_TOKEN],
        scopesSupported: [Scope.OPENID],
        subjectTypesSupported: [SubjectType.PAIRWISE],
        idTokenSigningAlgValuesSupported: [SigningAlgo.EDDSA],
        requestObjectSigningAlgValuesSupported: [SigningAlgo.EDDSA],
        passBy: PassBy.VALUE,
        vpFormatsSupported: { jwt_vc: { alg: [SigningAlgo.EDDSA] }, jwt_vp: { alg: [SigningAlgo.EDDSA] } },
      },
    }

    const { proofRequest, proofRequestMetadata } = await this.agent.modules.openId4VcVerifier.createProofRequest(
      createProofRequestOptions
    )

    this.proofRequestMetadata = proofRequestMetadata
    this.proofRequestOptions = createProofRequestOptions

    return proofRequest
  }

  public async verifyProofResponse(proofPayload: ProofPayload) {
    if (!this.proofRequestMetadata) throw new Error('No proofRequestMetadata found')
    if (!this.proofRequestOptions) throw new Error('No proofRequestOptions found')

    console.log(purpleText('verifying proof response'))

    const { idTokenPayload, submission } = await this.agent.modules.openId4VcVerifier.verifyProofResponse(
      proofPayload,
      {
        proofRequestMetadata: this.proofRequestMetadata,
        createProofRequestOptions: this.proofRequestOptions,
      }
    )

    console.log(purpleText('Verified!'))

    return { idTokenPayload, submission }
  }

  public async exit() {
    console.log(Output.Exit)
    await this.agent.shutdown()
    process.exit(0)
  }

  public async restart() {
    await this.agent.shutdown()
  }
}

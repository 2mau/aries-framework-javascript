import type { PresentationRequest, PresentationSubmission } from '@aries-framework/openid4vc-holder'

import { AskarModule } from '@aries-framework/askar'
import { W3cJwtVerifiableCredential } from '@aries-framework/core'
import { OpenId4VcHolderModule } from '@aries-framework/openid4vc-holder'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'

import { BaseAgent } from './BaseAgent'
import { Output } from './OutputClass'

function getOpenIdHolderModules() {
  return {
    askar: new AskarModule({ ariesAskar }),
    openId4VcHolder: new OpenId4VcHolderModule(),
  } as const
}

export class Holder extends BaseAgent<ReturnType<typeof getOpenIdHolderModules>> {
  private presentationRequest?: PresentationRequest
  private presentationSubmission?: PresentationSubmission

  public constructor(port: number, name: string) {
    super({ port, name, modules: getOpenIdHolderModules() })
  }

  public static async build(): Promise<Holder> {
    const holder = new Holder(3000, 'OpenId4VcHolder' + Math.random().toString())
    await holder.initializeAgent('96213c3d7fc8d4d6754c7a0fd969598e')

    const waltUniversityDegreeJwt =
      'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6ImRpZDprZXk6ejZNa29hYkE3TG10amVlQUFHS3FxY3BtaHNkYTZCczJaYXlWUzZMUmF5MmdiWFJKIn0.eyJpc3MiOiJkaWQ6a2V5Ono2TWtvYWJBN0xtdGplZUFBR0txcWNwbWhzZGE2QnMyWmF5VlM2TFJheTJnYlhSSiIsInN1YiI6ImRpZDprZXk6ejZNa3BHUjRnczRSYzNacGg0dmo4d1Juam5BeGdBUFN4Y1I4TUFWS3V0V3NwUXpjI3o2TWtwR1I0Z3M0UmMzWnBoNHZqOHdSbmpuQXhnQVBTeGNSOE1BVkt1dFdzcFF6YyIsInZjIjp7IkBjb250ZXh0IjpbImh0dHBzOi8vd3d3LnczLm9yZy8yMDE4L2NyZWRlbnRpYWxzL3YxIiwiaHR0cHM6Ly93d3cudzMub3JnLzIwMTgvY3JlZGVudGlhbHMvZXhhbXBsZXMvdjEiXSwiaWQiOiJ1cm46dXVpZDpmNTkyMzFhMS1jZWJkLTQyNDMtYjQwNy01OWFlOWYxYjRkMzciLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIiwiVW5pdmVyc2l0eURlZ3JlZSJdLCJpc3N1ZXIiOnsiaWQiOiJkaWQ6a2V5Ono2TWtvYWJBN0xtdGplZUFBR0txcWNwbWhzZGE2QnMyWmF5VlM2TFJheTJnYlhSSiJ9LCJpc3N1YW5jZURhdGUiOiIyMDIzLTExLTEwVDE0OjUxOjUxLjQ4NTYzNjY5M1oiLCJjcmVkZW50aWFsU3ViamVjdCI6eyJpZCI6ImRpZDprZXk6ejZNa3BHUjRnczRSYzNacGg0dmo4d1Juam5BeGdBUFN4Y1I4TUFWS3V0V3NwUXpjI3o2TWtwR1I0Z3M0UmMzWnBoNHZqOHdSbmpuQXhnQVBTeGNSOE1BVkt1dFdzcFF6YyIsImRlZ3JlZSI6eyJ0eXBlIjoiQmFjaGVsb3JEZWdyZWUiLCJuYW1lIjoiQmFjaGVsb3Igb2YgU2NpZW5jZSBhbmQgQXJ0cyJ9fX0sImp0aSI6InVybjp1dWlkOmY1OTIzMWExLWNlYmQtNDI0My1iNDA3LTU5YWU5ZjFiNGQzNyIsImlhdCI6MTY5OTYyNzkxMSwibmJmIjoxNjk5NjI3ODIxfQ.IvEhwCLBZ-zEyY1f1AV6T9tBG27f2PoFQi5rzvSNN1Io8x6f4PmtOmyNZsNLAD56pZFgyGKUJomQbQSP5thyBQ'
    await holder.agent.w3cCredentials.storeCredential({
      credential: W3cJwtVerifiableCredential.fromSerializedJwt(waltUniversityDegreeJwt),
    })

    return holder
  }

  public async resolveProofRequest(proofRequest: string) {
    const resolvedProofRequest = await this.agent.modules.openId4VcHolder.resolveProofRequest(proofRequest)

    if (resolvedProofRequest.proofType === 'authentication') throw new Error('We only support presentation requests')

    this.presentationRequest = resolvedProofRequest.presentationRequest
    this.presentationSubmission = resolvedProofRequest.presentationSubmission

    return {
      presentationRequest: resolvedProofRequest.presentationRequest,
      presentationSubmission: resolvedProofRequest.presentationSubmission,
    }
  }

  public getProofRequestData() {
    if (!this.presentationRequest || !this.presentationSubmission)
      throw new Error('You first need to resolve a proof request before you can accept it')
    return {
      presentationRequest: this.presentationRequest,
      presentationSubmission: this.presentationSubmission,
    }
  }

  public async acceptPresentationRequest(submissionEntryIndexes: number[]) {
    const { presentationRequest, presentationSubmission } = this.getProofRequestData()
    const submissionReslt = await this.agent.modules.openId4VcHolder.acceptPresentationRequest(presentationRequest, {
      submission: presentationSubmission,
      submissionEntryIndexes,
    })

    return submissionReslt.status
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

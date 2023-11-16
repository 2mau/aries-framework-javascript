import { clear } from 'console'
import { textSync } from 'figlet'
import { prompt } from 'inquirer'

import { BaseInquirer, ConfirmOptions } from './BaseInquirer'
import { Holder } from './Holder'
import { Title, greenText } from './OutputClass'

export const runHolder = async () => {
  clear()
  console.log(textSync('Holder', { horizontalLayout: 'full' }))
  const holder = await HolderInquirer.build()
  await holder.processAnswer()
}

enum PromptOptions {
  ResolveProofRequest = 'Resolve a proof request.',
  AcceptPresentationRequest = 'Accept the presentation request.',
  Exit = 'Exit',
  Restart = 'Restart',
}

export class HolderInquirer extends BaseInquirer {
  public holder: Holder
  public promptOptionsString: string[]

  public constructor(holder: Holder) {
    super()
    this.holder = holder
    this.promptOptionsString = Object.values(PromptOptions)
  }

  public static async build(): Promise<HolderInquirer> {
    const holder = await Holder.build()
    return new HolderInquirer(holder)
  }

  private async getPromptChoice() {
    return prompt([this.inquireOptions(this.promptOptionsString)])
  }

  public async processAnswer() {
    const choice = await this.getPromptChoice()

    switch (choice.options) {
      case PromptOptions.ResolveProofRequest:
        await this.resolveProofRequest()
        break
      case PromptOptions.AcceptPresentationRequest:
        await this.acceptPresentationRequest()
        break
      case PromptOptions.Exit:
        await this.exit()
        break
      case PromptOptions.Restart:
        await this.restart()
        return
    }
    await this.processAnswer()
  }

  public async exitUseCase(title: string) {
    const confirm = await prompt([this.inquireConfirmation(title)])
    if (confirm.options === ConfirmOptions.No) {
      return false
    } else if (confirm.options === ConfirmOptions.Yes) {
      return true
    }
  }

  public async resolveProofRequest() {
    const proofRequestUri = await prompt([this.inquireInput('Enter proof request: ')])
    const { presentationRequest, presentationSubmission } = await this.holder.resolveProofRequest(proofRequestUri.input)

    const presentationDefinition = presentationRequest.presentationDefinitions[0].definition

    console.log(greenText(`Presentation Purpose: '${presentationDefinition.purpose}'`))

    if (presentationSubmission.areRequirementsSatisfied) {
      console.log(greenText(`All requirements for creating the presentation are satisfied.`))
    } else {
      console.log(greenText(`No credentials available that satisfy the proof request.`))
    }
  }

  public async acceptPresentationRequest() {
    const { presentationSubmission } = this.holder.getProofRequestData()

    // we know that only one credential is in the wallet and it satisfies the proof request.
    // The submission entry index for this credential is 0.
    const credential = presentationSubmission.requirements[0].submissionEntry[0].verifiableCredentials[0]
    const submissionEntryIndexes = [0]

    console.log(greenText(`Accepting the presentation request, with the following credential.`))
    console.log(greenText(credential.credential.type.join(', ')))

    const status = await this.holder.acceptPresentationRequest(submissionEntryIndexes)

    if (status >= 200 && status < 300) {
      console.log(`received success status code '${status}'`)
    } else {
      console.log(`received error status code '${status}'`)
    }
  }

  public async exit() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.holder.exit()
    }
  }

  public async restart() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.processAnswer()
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.holder.restart()
      await runHolder()
    }
  }
}

void runHolder()

import { clear } from 'console'
import { textSync } from 'figlet'
import { prompt } from 'inquirer'

import { BaseInquirer, ConfirmOptions } from './BaseInquirer'
import { Title, purpleText } from './OutputClass'
import { Verifier } from './Verifier'

export const runVerifier = async () => {
  clear()
  console.log(textSync('Verifier', { horizontalLayout: 'full' }))
  const verifier = await VerifierInquirer.build()
  await verifier.processAnswer()
}

enum PromptOptions {
  CreateProofOffer = 'Request the presentation of the university degree credential.',
  Exit = 'Exit',
  Restart = 'Restart',
}

export class VerifierInquirer extends BaseInquirer {
  public verifier: Verifier
  public promptOptionsString: string[]

  public constructor(verifier: Verifier) {
    super()
    this.verifier = verifier
    this.promptOptionsString = Object.values(PromptOptions)
  }

  public static async build(): Promise<VerifierInquirer> {
    const verifier = await Verifier.build()
    return new VerifierInquirer(verifier)
  }

  private async getPromptChoice() {
    return prompt([this.inquireOptions(this.promptOptionsString)])
  }

  public async processAnswer() {
    const choice = await this.getPromptChoice()

    switch (choice.options) {
      case PromptOptions.CreateProofOffer:
        await this.createProofOffer()
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

  public async createProofOffer() {
    const proofRequest = await this.verifier.createUniversityDegreeProofRequest()

    console.log(purpleText(`university degree credential proof request: '${proofRequest}'`))
  }

  public async exit() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.verifier.exit()
    }
  }

  public async restart() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.processAnswer()
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.verifier.restart()
      await runVerifier()
    }
  }
}

void runVerifier()

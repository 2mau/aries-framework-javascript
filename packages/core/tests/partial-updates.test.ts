import type { Module } from '../src/plugins/Module'
import type { PartiallyApplicableUpdate } from '../src/storage/migration/updates'

import { askarModule } from '../../askar/tests/helpers'
import { StorageUpdateService, type Update } from '../src'
import { Agent } from '../src/agent/Agent'
import { UpdateAssistant } from '../src/storage/migration/UpdateAssistant'

import { getAgentOptions } from './helpers'

export class ExampleModule implements Module {
  public constructor(updates: Update[]) {
    this.updates = updates
  }
  public register() {
    // do nothing
  }

  public updates!: Update[]
}

describe('migration', () => {
  test('agent update fails if required partially applicable updates throw', async () => {
    const agentOptions = getAgentOptions(
      'Migration',
      {},
      {
        askar: askarModule,
        example: new ExampleModule([
          {
            fromVersion: '0.4',
            toVersion: '0.5',
            doUpdate: async () => {
              throw new Error('Update error')
            },
            type: 'partiallyApplicable',
          },
        ]),
      }
    )
    const agent = new Agent(agentOptions)

    const updateAssistant = new UpdateAssistant(agent, {
      v0_1ToV0_2: { mediationRoleUpdateStrategy: 'recipientIfEndpoint' },
    })

    await updateAssistant.initialize()
    await agent.context.dependencyManager.resolve(StorageUpdateService).setCurrentStorageVersion(agent.context, '0.4')
    await expect(updateAssistant.update({ backupBeforeStorageUpdate: false })).rejects.toThrow()
  })

  test('agent update fails if required partially applicable updates are not complete', async () => {
    const agentOptions = getAgentOptions(
      'Migration',
      {},
      {
        askar: askarModule,
        example: new ExampleModule([
          {
            fromVersion: '0.3',
            toVersion: '0.4',
            doUpdate: async () => false,
            type: 'partiallyApplicable',
          } as PartiallyApplicableUpdate,
        ]),
      }
    )
    const agent = new Agent(agentOptions)

    const updateAssistant = new UpdateAssistant(agent, {
      v0_1ToV0_2: { mediationRoleUpdateStrategy: 'recipientIfEndpoint' },
    })

    await updateAssistant.initialize()
    await agent.context.dependencyManager.resolve(StorageUpdateService).setCurrentStorageVersion(agent.context, '0.2')
    await expect(updateAssistant.update({ backupBeforeStorageUpdate: false })).rejects.toThrow()
  })

  test('agent update succeeds if required partially applicable updates are complete', async () => {
    const agentOptions = getAgentOptions(
      'Migration',
      {},
      {
        askar: askarModule,
        example: new ExampleModule([
          {
            fromVersion: '0.4',
            toVersion: '0.5',
            doUpdate: async () => true,
            type: 'partiallyApplicable',
          } as PartiallyApplicableUpdate,
        ]),
      }
    )
    const agent = new Agent(agentOptions)

    const updateAssistant = new UpdateAssistant(agent, {
      v0_1ToV0_2: { mediationRoleUpdateStrategy: 'recipientIfEndpoint' },
    })

    await updateAssistant.initialize()
    await agent.context.dependencyManager.resolve(StorageUpdateService).setCurrentStorageVersion(agent.context, '0.4')
    await updateAssistant.update({ backupBeforeStorageUpdate: false })
    await updateAssistant.runPartiallyApplicableUpdates({ backupBeforeStorageUpdate: false })

    await agent.initialize()
    await agent.shutdown()
    await agent.wallet.delete()
  })

  test('agent update succeeds if non-required partially applicable updates are not complete', async () => {
    const agentOptions = getAgentOptions(
      'Migration',
      {},
      {
        askar: askarModule,
        example: new ExampleModule([
          {
            fromVersion: '0.4',
            toVersion: '0.5',
            doUpdate: async () => true,
            type: 'partiallyApplicable',
          } as PartiallyApplicableUpdate,
          {
            fromVersion: '0.5',
            toVersion: '0.6',
            doUpdate: async () => false,
            type: 'partiallyApplicable',
          } as PartiallyApplicableUpdate,
        ]),
      }
    )
    const agent = new Agent(agentOptions)

    const updateAssistant = new UpdateAssistant(agent, {
      v0_1ToV0_2: { mediationRoleUpdateStrategy: 'recipientIfEndpoint' },
    })

    await updateAssistant.initialize()
    await agent.context.dependencyManager.resolve(StorageUpdateService).setCurrentStorageVersion(agent.context, '0.4')
    await updateAssistant.update({ backupBeforeStorageUpdate: false })
    await updateAssistant.runPartiallyApplicableUpdates({ backupBeforeStorageUpdate: false })

    await agent.initialize()
    await agent.shutdown()
    await agent.wallet.delete()
  })

  test('agent update fails if non-required partially applicable updates throw', async () => {
    const agentOptions = getAgentOptions(
      'Migration',
      {},
      {
        askar: askarModule,
        example: new ExampleModule([
          {
            fromVersion: '0.4',
            toVersion: '0.5',
            doUpdate: async () => true,
            type: 'partiallyApplicable',
          } as PartiallyApplicableUpdate,
          {
            fromVersion: '0.5',
            toVersion: '0.6',
            doUpdate: async () => {
              throw new Error('Update error')
            },
            type: 'partiallyApplicable',
          } as PartiallyApplicableUpdate,
        ]),
      }
    )
    const agent = new Agent(agentOptions)

    const updateAssistant = new UpdateAssistant(agent, {
      v0_1ToV0_2: { mediationRoleUpdateStrategy: 'recipientIfEndpoint' },
    })

    await updateAssistant.initialize()
    await agent.context.dependencyManager.resolve(StorageUpdateService).setCurrentStorageVersion(agent.context, '0.4')
    await updateAssistant.update({ backupBeforeStorageUpdate: false })
    await expect(updateAssistant.runPartiallyApplicableUpdates({ backupBeforeStorageUpdate: false })).rejects.toThrow()

    await agent.initialize()
    await agent.shutdown()
    await agent.wallet.delete()
  })
})

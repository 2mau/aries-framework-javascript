import type { PresentationDefinitionV1 } from '@sphereon/pex-models'

export const presentationDefinition: PresentationDefinitionV1 = {
  id: '5591656f-5b5d-40f8-ab5c-9041c8e3a6a0',
  name: 'Age Verification',
  purpose: 'We need to verify your age before entering a bar',
  input_descriptors: [
    {
      id: 'age-verification',
      name: 'A specific type of VC + Issuer',
      purpose: 'We want a VC of this type generated by this issuer',
      schema: [
        {
          uri: 'https://www.w3.org/2018/credentials/v1',
        },
      ],
      constraints: {
        limit_disclosure: 'required' as const,
        statuses: {
          active: {
            directive: 'required' as const,
          },
        },
        fields: [
          {
            path: ['$.issuer'],
            filter: {
              type: 'string',
              const: 'did:indy:local:LjgpST2rjsoxYegQDRm7EL',
            },
          },
          {
            path: ['$.credentialSubject.name'],
          },
          {
            path: ['$.credentialSubject.height'],
          },
          {
            path: ['$.credentialSubject.age'],
            predicate: 'preferred' as const,
            filter: {
              type: 'number',
              minimum: 18,
            },
          },
        ],
      },
    },
  ],
  format: {
    di_vc: {
      proof_type: ['DataIntegrityProof'],
      cryptosuite: ['anoncreds-2023', 'eddsa-rdfc-2022'],
    },
  },
}

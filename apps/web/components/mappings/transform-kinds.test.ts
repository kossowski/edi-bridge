import { describe, expect, it } from 'vitest'

import { draftTransformConfigSchemas, transformKinds } from '@edi-bridge/contracts'

import messagesDe from '../../messages/de.json'
import messagesEn from '../../messages/en.json'
import { defaultConfig, formFields, isRanged, transformKindFields } from './transform-kinds'

type Texts = Readonly<Record<string, Readonly<Record<string, string>>>>

describe('transformKindFields', () => {
  it('gives every kind a default config its Draft schema accepts', () => {
    for (const kind of transformKinds) {
      expect(draftTransformConfigSchemas[kind].safeParse(defaultConfig(kind)).success).toBe(true)
    }
  })

  it.each([
    ['en', messagesEn],
    ['de', messagesDe],
  ])('has a label, a description and a range for each field in %s', (_, messages) => {
    const texts = messages.Mapping.transforms
    const labels: Texts = texts.fields
    const descriptions: Texts = texts.fieldDescriptions
    const ranges: Texts = texts.ranges

    for (const kind of transformKinds) {
      const names = Object.keys(transformKindFields[kind].fields)

      expect(Object.keys(labels[kind] ?? {})).toEqual(names)
      expect(Object.keys(ranges[kind] ?? {})).toEqual(names.filter((name) => isRanged(kind, name)))
      expect(Object.keys(descriptions[kind] ?? {})).toEqual(
        formFields(kind).map(({ name }) => name),
      )
    }
  })
})

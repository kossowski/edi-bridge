import { type Language, type LookupTableKind, standardListOf } from '@edi-bridge/contracts'

const languageNames: Readonly<Record<Language, string>> = { en: 'English', de: 'German' }

export const lookupTableInstruction =
  'A Lookup Table translates the codes Trading Partners send (source codes) into the codes of a standard list (target codes).'

export const kindAndLanguageLines = (kind: LookupTableKind, language: Language) => [
  `Kind: ${kind}, with target codes from the ${standardListOf[kind]}.`,
  `Language of the meanings: ${languageNames[language]}.`,
]

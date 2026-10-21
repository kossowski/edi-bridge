import { type MessageFormatElement, parse, TYPE } from '@formatjs/icu-messageformat-parser'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import messagesDe from '../messages/de.json'
import messagesEn from '../messages/en.json'

type Language = 'en' | 'de'

type GlossaryTerm = { term: string; label: Record<Language, string> | null }

const glossary = readFileSync(new URL('../../../GLOSSARY.md', import.meta.url), 'utf8')

const noName = 'has no on-screen name'

const withoutOnScreenName = {
  'Sandbox Workspace': noName,
  Member: noName,
  Invite: noName,
  Admin: `${noName}; the screens name the role`,
  Viewer: `${noName}; the screens name the role`,
  'Partner Simulator': 'is not part of EDI Bridge and never named on screen',
  Document: `${noName}; German screens still fail on "Document", the English name of Run`,
  Message: `${noName}, and "message" is an everyday word on screen`,
  'Code List': noName,
  Transform: `${noName}; the mapping editor names it`,
  'Transform Link': noName,
  'Failure Stage': `${noName}; the screens name each stage`,
  Defect: noName,
  'Live event': noName,
  'Order Lifecycle Status':
    'names only its values on screen; the term itself is caught as Order Lifecycle',
}

const sameName = 'its on-screen name is the term itself'

// Screens say "mapping version" where the word mapping is needed; "Version" alone is the label.
const lowercaseAllowed = new Set(['Mapping Version'])

const leftOut: Record<Language, Record<string, string>> = {
  en: {
    ...withoutOnScreenName,
    Workspace: sameName,
    Operator: sameName,
    Mapping: sameName,
    Draft: sameName,
    Overdue: sameName,
    Duplicate: sameName,
    Passphrase: sameName,
  },
  de: { ...withoutOnScreenName, Operator: sameName, Mapping: sameName, Passphrase: sameName },
}

function glossaryTerms(): ReadonlyArray<GlossaryTerm> {
  const terms: GlossaryTerm[] = []

  for (const line of glossary.split('\n')) {
    const term = /^\*\*(.+)\*\*:$/.exec(line)?.[1]

    if (term) {
      terms.push({ term, label: null })
      continue
    }

    const [, en, de] = /^_On screen_: ([^,(→]+?)(?:, [^(]*)? \(DE: ([^,)]+)/.exec(line) ?? []
    const current = terms.at(-1)

    if (en && de && current) {
      current.label = { en, de }
    }
  }

  return terms
}

function isChecked({ term, label }: GlossaryTerm, language: Language) {
  if (!label) {
    return false
  }

  return language === 'en' ? term !== label.en : term.toLowerCase() !== label.de.toLowerCase()
}

function forbiddenWords({ term, label }: GlossaryTerm, language: Language) {
  if (language === 'en' || !label) {
    return [term]
  }

  const english = label.en.toLowerCase()
  const isOwnWord = english === term.toLowerCase() || english === label.de.toLowerCase()

  return isOwnWord ? [term] : [term, label.en]
}

function wordPattern(word: string, language: Language) {
  // The German compound "Mapping-Version" passes, like the English "mapping version".
  const body = word.replaceAll(' ', '\\s+')
  // German screens never show the English word, in whatever case. In English a single word
  // fails only capitalised: lowercase "run" or "flow" is ordinary English.
  const anyCase = language === 'de' || word.includes(' ')

  return new RegExp(`\\b(${body})(?:s|es)?\\b`, anyCase ? 'gi' : 'g')
}

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

function isAllowed(found: string, { term, label }: GlossaryTerm, atStart: boolean) {
  const name = label?.en ?? ''
  const allowed = [name, name.toLowerCase()]

  if (lowercaseAllowed.has(term)) {
    allowed.push(term.toLowerCase())

    if (atStart) {
      allowed.push(sentenceCase(term))
    }
  }

  return allowed.includes(found.replaceAll(/\s+/g, ' '))
}

function foundWords(term: GlossaryTerm, language: Language, text: string) {
  return forbiddenWords(term, language).filter((word) =>
    Array.from(text.matchAll(wordPattern(word, language))).some((match) => {
      const atStart = /(?:^|[.!?:\n])\s*$/.test(text.slice(0, match.index))

      return language === 'de' || !isAllowed(match[1] ?? '', term, atStart)
    }),
  )
}

function screenText(elements: ReadonlyArray<MessageFormatElement>): string {
  return elements
    .map((element) => {
      if (element.type === TYPE.literal) {
        return element.value
      }

      if (element.type === TYPE.tag) {
        return screenText(element.children)
      }

      if (element.type === TYPE.select || element.type === TYPE.plural) {
        return Object.values(element.options)
          .map((option) => screenText(option.value))
          .join('\n')
      }

      return ' '
    })
    .join('')
}

type MessageEntry = readonly [key: string, message: string]

function entryAt(key: string, [path, message]: MessageEntry): MessageEntry {
  return [path ? `${key}.${path}` : key, message]
}

function leafEntry(message: string): ReadonlyArray<MessageEntry> {
  return [['', message]]
}

const messageEntriesSchema: z.ZodType<ReadonlyArray<MessageEntry>> = z.lazy(() =>
  z
    .record(z.string(), z.union([z.string().transform(leafEntry), messageEntriesSchema]))
    .transform((tree) =>
      Object.entries(tree).flatMap(([key, entries]) => entries.map((entry) => entryAt(key, entry))),
    ),
)

function offenders(language: Language, messages: ReadonlyArray<MessageEntry>) {
  const checked = glossaryTerms().filter((term) => isChecked(term, language))

  return messages.flatMap(([key, message]) => {
    const text = screenText(parse(message))

    return checked.flatMap((term) =>
      foundWords(term, language, text).map((word) => `${key}: "${word}"`),
    )
  })
}

describe('on-screen names', () => {
  it.each(['en', 'de'] as const)('checks or lists every glossary term in %s', (language) => {
    const unchecked = glossaryTerms()
      .filter((term) => !isChecked(term, language))
      .map(({ term }) => term)

    expect(unchecked.toSorted()).toEqual(Object.keys(leftOut[language]).toSorted())
  })

  it('reads the on-screen names from the glossary', () => {
    const terms = glossaryTerms()

    expect(terms.find(({ term }) => term === 'Channel')?.label).toEqual({
      en: 'Connection',
      de: 'Verbindung',
    })
    expect(terms.find(({ term }) => term === 'Document Structure')?.label).toEqual({
      en: 'Data format',
      de: 'Datenformat',
    })
    expect(terms.find(({ term }) => term === 'Message Type')?.label).toEqual({
      en: 'Document type',
      de: 'Belegart',
    })
    expect(terms.find(({ term }) => term === 'Poll problem')?.label).toEqual({
      en: 'Polling failed',
      de: 'Abfrage fehlgeschlagen',
    })
  })

  it('finds a domain term in the screen text of a message', () => {
    expect(
      offenders(
        'en',
        messageEntriesSchema.parse({
          create: 'Create Channel',
          count: '{count, plural, one {# Flow} other {# Flows}}',
          link: { nested: '<link>Lookup Tables</link>' },
          argument: 'Choose {channel}',
          label: 'Trading partner',
          lowercase: 'Choose a mapping version',
        }),
      ),
    ).toEqual(['create: "Channel"', 'count: "Flow"', 'link.nested: "Lookup Table"'])
  })

  it('finds a term of two or more words in English in any case', () => {
    expect(
      offenders(
        'en',
        messageEntriesSchema.parse({
          sentence: 'Lookup table',
          lower: 'Add a sample document',
          mixed: 'No customer Workspaces yet.',
          title: 'Trading Partner',
          middle: 'Open the Mapping version',
        }),
      ),
    ).toEqual([
      'sentence: "Lookup Table"',
      'lower: "Sample Document"',
      'mixed: "Customer Workspace"',
      'title: "Trading Partner"',
      'middle: "Mapping Version"',
    ])
  })

  it('lets English use the on-screen name and lowercase single words', () => {
    expect(
      offenders(
        'en',
        messageEntriesSchema.parse({
          sentence: 'Trading partner',
          lower: 'Pick a trading partner',
          word: 'We run and retry every flow',
          version: 'Choose a mapping version',
          label: 'Mapping version',
          sentenceStart: 'Saved. Mapping version {number} is live.',
          option: '{kind, select, draft {Draft} other {Mapping version}}',
        }),
      ),
    ).toEqual([])
    expect(
      offenders(
        'de',
        messageEntriesSchema.parse({
          workspace: 'In diesem Workspace',
          label: 'Trading partner',
          document: 'Ziel-Document',
          compound: 'Mapping-Version',
        }),
      ),
    ).toEqual(['workspace: "Workspace"', 'label: "Trading Partner"', 'document: "Document"'])
  })

  it.each([
    ['en', messagesEn],
    ['de', messagesDe],
  ] as const)('uses no domain term with an on-screen name in %s', (language, messages) => {
    expect(offenders(language, messageEntriesSchema.parse(messages))).toEqual([])
  })
})

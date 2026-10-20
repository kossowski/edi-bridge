import type { CharacterEncoding, MessageType } from '@edi-bridge/contracts'
import type { ParseErrorCode, ValidationErrorCode } from '@edi-bridge/edifact'
import type { DocumentReadErrorCode, MappingErrorCode } from '@edi-bridge/mapping'

export type FixtureFormat = 'edifact' | 'json' | 'csv'

// A fixture can be sent as a Manual Submission only in an encoding the contract allows.
export type FixtureEncoding = CharacterEncoding

export type FixtureFailure =
  | { stage: 'parse'; code: ParseErrorCode }
  | { stage: 'validation'; code: ValidationErrorCode }
  | { stage: 'mapping'; code: MappingErrorCode | DocumentReadErrorCode }

type FixtureBase = {
  path: string
  format: FixtureFormat
  encoding: FixtureEncoding
  messageType: Extract<MessageType, 'ORDERS' | 'DESADV' | 'INVOIC'>
  description: string
}

export type Fixture =
  | (FixtureBase & { valid: true })
  | (FixtureBase & { valid: false; failure: FixtureFailure })

export const fixtures: readonly Fixture[] = [
  {
    path: 'documents/valid/orders-nordlicht-markt.edi',
    format: 'edifact',
    encoding: 'windows-1252',
    messageType: 'ORDERS',
    description:
      'Nordlicht Markt AG orders three articles for its central warehouse in Hamburg. One Message, no UNA.',
    valid: true,
  },
  {
    path: 'documents/valid/orders-nordlicht-markt-two-orders.edi',
    format: 'edifact',
    encoding: 'windows-1252',
    messageType: 'ORDERS',
    description:
      'One Interchange with two ORDERS of Nordlicht Markt AG, for the central warehouse and for the store in Lüneburg. It produces two Runs.',
    valid: true,
  },
  {
    path: 'documents/valid/orders-rheinwiese-handel.edi',
    format: 'edifact',
    encoding: 'windows-1252',
    messageType: 'ORDERS',
    description:
      'Rheinwiese Handel GmbH orders one article for its warehouse in Köln-Porz. It starts with a UNA and escapes the + in the warehouse name with the release character.',
    valid: true,
  },
  {
    path: 'documents/broken/orders-segment-count-mismatch.edi',
    format: 'edifact',
    encoding: 'windows-1252',
    messageType: 'ORDERS',
    description: 'The UNT of the Message counts one segment less than the Message holds.',
    valid: false,
    failure: { stage: 'parse', code: 'segment-count-mismatch' },
  },
  {
    path: 'documents/broken/orders-cut-off-transfer.edi',
    format: 'edifact',
    encoding: 'windows-1252',
    messageType: 'ORDERS',
    description:
      'The transfer broke off after the last line item: the UNS, CNT, UNT and UNZ are missing.',
    valid: false,
    failure: { stage: 'parse', code: 'missing-message-trailer' },
  },
  {
    path: 'documents/broken/orders-unknown-date-format.edi',
    format: 'edifact',
    encoding: 'windows-1252',
    messageType: 'ORDERS',
    description:
      'The order date is written as 16.10.2026 with the date format code 999, which the Code List does not hold.',
    valid: false,
    failure: { stage: 'validation', code: 'unknown-code' },
  },
  {
    path: 'documents/broken/orders-too-long-order-number.edi',
    format: 'edifact',
    encoding: 'windows-1252',
    messageType: 'ORDERS',
    description: 'The order number in BGM has 47 characters; the element allows 35.',
    valid: false,
    failure: { stage: 'validation', code: 'too-long-element' },
  },
  {
    path: 'documents/broken/orders-without-beginning-of-message.edi',
    format: 'edifact',
    encoding: 'windows-1252',
    messageType: 'ORDERS',
    description: 'The Message lacks its mandatory BGM, so it carries no order number.',
    valid: false,
    failure: { stage: 'validation', code: 'missing-segment' },
  },
  {
    path: 'documents/valid/invoice-nordlicht-markt.json',
    format: 'json',
    encoding: 'utf-8',
    messageType: 'INVOIC',
    description: 'The invoice to Nordlicht Markt AG for its order of three articles.',
    valid: true,
  },
  {
    path: 'documents/valid/invoice-rheinwiese-handel.json',
    format: 'json',
    encoding: 'utf-8',
    messageType: 'INVOIC',
    description: 'The invoice to Rheinwiese Handel GmbH for its order of one article.',
    valid: true,
  },
  {
    path: 'documents/broken/invoice-unknown-unit.json',
    format: 'json',
    encoding: 'utf-8',
    messageType: 'INVOIC',
    description:
      'A line is invoiced in the unit KAR (carton), which the unit Lookup Table does not translate.',
    valid: false,
    failure: { stage: 'mapping', code: 'noLookupMatch' },
  },
  {
    path: 'documents/broken/invoice-iso-date.json',
    format: 'json',
    encoding: 'utf-8',
    messageType: 'INVOIC',
    description:
      'The invoice date is written as 2026-10-22 instead of the dd.MM.yyyy that the ERP otherwise exports.',
    valid: false,
    failure: { stage: 'mapping', code: 'invalidDate' },
  },
  {
    path: 'documents/broken/invoice-line-without-quantity.json',
    format: 'json',
    encoding: 'utf-8',
    messageType: 'INVOIC',
    description:
      'The second line has a unit but no quantity, which the QTY of the INVOIC line requires.',
    valid: false,
    failure: { stage: 'mapping', code: 'missingRequiredValue' },
  },
  {
    path: 'documents/broken/invoice-cut-off-transfer.json',
    format: 'json',
    encoding: 'utf-8',
    messageType: 'INVOIC',
    description: 'The export broke off before the totals, so the Document is not valid JSON.',
    valid: false,
    failure: { stage: 'mapping', code: 'invalidJson' },
  },
  {
    path: 'documents/broken/invoice-too-long-currency.json',
    format: 'json',
    encoding: 'utf-8',
    messageType: 'INVOIC',
    description:
      'The currency is EURO instead of the ISO code EUR; the currency element of CUX allows three characters.',
    valid: false,
    failure: { stage: 'validation', code: 'too-long-element' },
  },
  {
    path: 'documents/valid/dispatch-nordlicht-markt.csv',
    format: 'csv',
    encoding: 'windows-1252',
    messageType: 'DESADV',
    description:
      'The dispatch of three articles on one pallet to the central warehouse of Nordlicht Markt AG.',
    valid: true,
  },
  {
    path: 'documents/valid/dispatch-rheinwiese-handel.csv',
    format: 'csv',
    encoding: 'windows-1252',
    messageType: 'DESADV',
    description:
      'The dispatch of one article to Rheinwiese Handel GmbH. Its description holds a ; and quotes, so the cell is quoted.',
    valid: true,
  },
  {
    path: 'documents/broken/dispatch-unquoted-delimiter.csv',
    format: 'csv',
    encoding: 'windows-1252',
    messageType: 'DESADV',
    description:
      'A description holds an unquoted ;, so its row has one cell more than the header row.',
    valid: false,
    failure: { stage: 'mapping', code: 'invalidCsv' },
  },
  {
    path: 'documents/broken/dispatch-unclosed-quote.csv',
    format: 'csv',
    encoding: 'windows-1252',
    messageType: 'DESADV',
    description: 'A description opens a quote and never closes it.',
    valid: false,
    failure: { stage: 'mapping', code: 'invalidCsv' },
  },
]

import { type MessageType, withCheckDigit } from '@edi-bridge/contracts'

// GS1 keeps the prefixes 020 to 029 for restricted circulation, so no seeded number is a real one.
// Each seeded VAT ID fails the ISO 7064 MOD 11,10 check digit, so no company can hold it.
export const seedCompany = { gln: withCheckDigit('020400100000'), vatId: 'DE900000001' }

export const seedChannelDomain = 'invalid'

export const seedArticles = [
  { gtin: withCheckDigit('020400100101'), number: 'BK-200', name: 'Bergkäse 200 g', price: 3.49 },
  { gtin: withCheckDigit('020400100102'), number: 'AS-1000', name: 'Apfelsaft 1 l', price: 1.89 },
  { gtin: withCheckDigit('020400100103'), number: 'DB-500', name: 'Dinkelbrot 500 g', price: 2.79 },
  { gtin: withCheckDigit('020400100104'), number: 'WH-250', name: 'Waldhonig 250 g', price: 5.29 },
] as const

export type SeedArticle = (typeof seedArticles)[number]

export interface SeedStore {
  gln: string
  name: string
  street: string
  postalCode: string
  city: string
}

export type OrderScenario =
  | 'delivered'
  | 'overdueAcknowledgement'
  | 'missingCode'
  | 'resentOrder'
  | 'unreadableOrder'
  | 'unreachableHost'

export interface SeedTradingPartner {
  name: string
  slug: string
  gln: string
  vatId: string
  contact: string
  acknowledgementTimeLimitHours: number
  testMode: boolean
  stores: SeedStore[]
  orders: OrderScenario[]
}

const kassel: SeedStore = {
  gln: withCheckDigit('021100200101'),
  name: 'Lindenhof Markt Kassel',
  street: 'Am Weinberg 4',
  postalCode: '34117',
  city: 'Kassel',
}

const lindenhof: SeedTradingPartner = {
  name: 'Lindenhof Markt GmbH',
  slug: 'lindenhof-markt',
  gln: withCheckDigit('021100200000'),
  vatId: 'DE900000002',
  contact: 'Petra Lindner',
  acknowledgementTimeLimitHours: 24,
  testMode: false,
  stores: [
    kassel,
    {
      gln: withCheckDigit('021100200102'),
      name: 'Lindenhof Markt Göttingen',
      street: 'Lindenallee 12',
      postalCode: '37073',
      city: 'Göttingen',
    },
  ],
  orders: [
    'delivered',
    'overdueAcknowledgement',
    'missingCode',
    'resentOrder',
    'delivered',
    'delivered',
  ],
}

export const seedTradingPartners: SeedTradingPartner[] = [
  lindenhof,
  {
    name: 'Elbtal Frische AG',
    slug: 'elbtal-frische',
    gln: withCheckDigit('022200300000'),
    vatId: 'DE900000003',
    contact: 'Jonas Albrecht',
    acknowledgementTimeLimitHours: 48,
    testMode: false,
    stores: [
      {
        gln: withCheckDigit('022200300101'),
        name: 'Elbtal Frische Zentrallager',
        street: 'Hafenstraße 30',
        postalCode: '01067',
        city: 'Dresden',
      },
    ],
    orders: [
      'delivered',
      'unreachableHost',
      'delivered',
      'unreadableOrder',
      'delivered',
      'delivered',
    ],
  },
]

// Still in setup: it has no Channel for the INVOIC it was created for.
export const seedOnboardingTradingPartner = {
  name: 'Kaiserstein Warenhaus KG',
  slug: 'kaiserstein-warenhaus',
  gln: withCheckDigit('023300400000'),
  acknowledgementTimeLimitHours: 24,
  messageTypes: ['ORDERS', 'INVOIC'],
} satisfies Pick<SeedTradingPartner, 'name' | 'slug' | 'gln' | 'acknowledgementTimeLimitHours'> & {
  messageTypes: MessageType[]
}

const yyyymmdd = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '')

const ddmmyyyy = (date: Date) => {
  const [year, month, day] = date.toISOString().slice(0, 10).split('-')

  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`
}

export interface SeedOrderLine {
  article: SeedArticle
  quantity: number
  unit: string
}

export interface SeedOrder {
  number: string
  orderedAt: Date
  deliveryDate: Date
  tradingPartner: SeedTradingPartner
  store: SeedStore
  lines: [SeedOrderLine, SeedOrderLine]
}

const interchangeHeader = (sender: string, receiver: string, at: Date, reference: string) =>
  `UNB+UNOC:3+${sender}:14+${receiver}:14+${yyyymmdd(at).slice(2)}:${at.toISOString().slice(11, 16).replace(':', '')}+${reference}'`

export function ordersInterchange(
  { number, orderedAt, deliveryDate, tradingPartner, store, lines }: SeedOrder,
  reference: string,
  { segmentCount }: { segmentCount?: number } = {},
) {
  const [first, second] = lines

  // The reference ORDERS Mapping of packages/mapping reads these segments.
  const message = [
    "UNH+1+ORDERS:D:96A:UN:EAN008'",
    `BGM+220+${number}+9'`,
    `DTM+137:${yyyymmdd(orderedAt)}:102'`,
    `DTM+2:${yyyymmdd(deliveryDate)}:102'`,
    `NAD+BY+${tradingPartner.gln}::9'`,
    `CTA+OC+${tradingPartner.contact}'`,
    `COM+einkauf@${tradingPartner.slug}.example:EM'`,
    `NAD+SU+${seedCompany.gln}::9'`,
    `NAD+DP+${store.gln}::9++${store.name}+${store.street}+${store.city}++${store.postalCode}+DE'`,
    `NAD+IV+${tradingPartner.gln}::9'`,
    "CUX+2:EUR:9'",
    `LIN+1++${first.article.gtin}:EN'`,
    `PIA+1+${first.article.number}:SA::91'`,
    `QTY+21:${String(first.quantity)}:${first.unit}'`,
    `DTM+2:${yyyymmdd(deliveryDate)}:102'`,
    `PRI+AAA:${first.article.price.toFixed(2)}::LIU'`,
    `LIN+2++${second.article.gtin}:EN'`,
    `PIA+1+${second.article.number}:SA::91'`,
    `QTY+21:${String(second.quantity)}:${second.unit}'`,
    "UNS+S'",
    "CNT+2:2'",
  ]

  return [
    interchangeHeader(tradingPartner.gln, seedCompany.gln, orderedAt, reference),
    ...message,
    `UNT+${String(segmentCount ?? message.length + 1)}+1'`,
    `UNZ+1+${reference}'`,
    '',
  ].join('\n')
}

export const erpOrderSample = {
  orderNumber: 'B-100000',
  orderDate: '2026-01-05',
  deliveryDate: '2026-01-08',
  currency: 'EUR',
  buyer: {
    gln: lindenhof.gln,
    contact: lindenhof.contact,
    email: `einkauf@${lindenhof.slug}.example`,
  },
  supplier: { gln: seedCompany.gln },
  deliveryParty: {
    gln: kassel.gln,
    name: kassel.name,
    street: kassel.street,
    city: kassel.city,
    postalCode: kassel.postalCode,
    country: 'DE',
  },
  invoicee: { gln: lindenhof.gln },
  lines: [
    {
      lineNumber: 1,
      gtin: seedArticles[0].gtin,
      supplierArticleNumber: seedArticles[0].number,
      quantity: 24,
      unit: 'ST',
      deliveryDate: '2026-01-08',
      netPrice: seedArticles[0].price,
    },
    {
      lineNumber: 2,
      gtin: seedArticles[1].gtin,
      supplierArticleNumber: seedArticles[1].number,
      quantity: 12,
      unit: 'ST',
    },
  ],
  lineCount: 2,
}

const vatRate = 7

const amount = (value: number) => Math.round(value * 100) / 100

export function erpInvoice(order: SeedOrder, invoiceNumber: string, invoicedAt: Date) {
  const lines = order.lines.map(({ article, quantity }) => ({
    gtin: article.gtin,
    description: article.name,
    quantity,
    unit: 'ST',
    netAmount: amount(article.price * quantity),
    vatRate,
  }))

  const lineAmount = amount(lines.reduce((total, { netAmount }) => total + netAmount, 0))
  const vatAmount = amount((lineAmount * vatRate) / 100)

  // The reference INVOIC Mapping of packages/mapping reads these fields.
  return {
    invoiceNumber,
    invoiceDate: ddmmyyyy(invoicedAt),
    deliveryDate: ddmmyyyy(order.deliveryDate),
    order: { number: order.number, date: ddmmyyyy(order.orderedAt) },
    deliveryNote: { number: `L-${order.number.slice(2)}`, date: ddmmyyyy(order.deliveryDate) },
    buyer: { gln: order.tradingPartner.gln, vatId: order.tradingPartner.vatId },
    supplier: { gln: seedCompany.gln, vatId: seedCompany.vatId },
    invoicee: { gln: order.tradingPartner.gln },
    deliveryParty: { gln: order.store.gln },
    currency: 'EUR',
    lines,
    totals: {
      invoiceAmount: amount(lineAmount + vatAmount),
      lineAmount,
      taxableAmount: lineAmount,
      vatRate,
      vatAmount,
    },
  }
}

export const erpInvoiceSample = erpInvoice(
  {
    number: 'B-100000',
    orderedAt: new Date('2026-01-05T08:00:00.000Z'),
    deliveryDate: new Date('2026-01-08T00:00:00.000Z'),
    tradingPartner: lindenhof,
    store: kassel,
    lines: [
      { article: seedArticles[0], quantity: 24, unit: 'PCE' },
      { article: seedArticles[1], quantity: 12, unit: 'PCE' },
    ],
  },
  'R-100000',
  new Date('2026-01-09T08:00:00.000Z'),
)

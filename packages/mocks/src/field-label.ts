import { type DocumentField, maxFieldLabelLength } from '@edi-bridge/contracts'

export type PlainName = Pick<DocumentField, 'label' | 'labelReason' | 'labelUnsure'>

type Known = { label: string; meaning?: string; labelUnsure?: boolean; valuesLookLike?: string }

const known = new Map<string, Known>()

function add(names: ReadonlyArray<string>, entry: Known) {
  for (const name of names) {
    known.set(name, entry)
  }
}

const meanings: ReadonlyArray<readonly [ReadonlyArray<string>, Known]> = [
  [
    ['rechnr', 'rechnungsnr', 'rechnungsnummer'],
    {
      label: 'Invoice number',
      meaning: '"Rechnungsnummer", the number of the invoice',
    },
  ],
  [
    ['rechdatum', 'rechnungsdatum'],
    {
      label: 'Invoice date',
      meaning: '"Rechnungsdatum", the date of the invoice',
    },
  ],
  [
    ['auftrnr', 'auftragsnr', 'auftragsnummer', 'bestellnr', 'bestellnummer'],
    {
      label: 'Order number',
      meaning: '"Auftragsnummer", the number of the order',
    },
  ],
  [
    ['kdnr', 'kundennr', 'kundennummer'],
    {
      label: 'Customer number',
      meaning: '"Kundennummer", your number for the customer',
    },
  ],
  [
    ['artnr', 'artikelnr', 'artikelnummer'],
    {
      label: 'Article number',
      meaning: '"Artikelnummer", your number for the article',
    },
  ],
  [
    ['bezeichnung', 'artikelbezeichnung'],
    {
      label: 'Description',
      meaning: '"Bezeichnung", the description of the article',
    },
  ],
  [['menge'], { label: 'Quantity', meaning: '"Menge", the quantity' }],
  [
    ['me'],
    {
      label: 'Unit',
      meaning: '"Mengeneinheit", the unit the quantity is counted in, if the values are units',
      labelUnsure: true,
      valuesLookLike: 'units',
    },
  ],
  [
    ['mengeneinheit'],
    {
      label: 'Unit',
      meaning: '"Mengeneinheit", the unit the quantity is counted in',
    },
  ],
  [
    ['epreis'],
    {
      label: 'Unit price',
      meaning: '"Einzelpreis", the price of one unit, if it is not the price of the whole line',
      labelUnsure: true,
      valuesLookLike: 'prices',
    },
  ],
  [['einzelpreis'], { label: 'Unit price', meaning: '"Einzelpreis", the price of one unit' }],
  [
    ['netto', 'nettobetrag'],
    {
      label: 'Net amount',
      meaning: '"Nettobetrag", the amount without VAT',
    },
  ],
  [
    ['mwst', 'mwstsatz'],
    {
      label: 'VAT rate in percent',
      meaning: '"Mehrwertsteuer", the VAT rate in percent',
    },
  ],
  [['whg', 'währung', 'waehrung'], { label: 'Currency', meaning: '"Währung", the currency' }],
  [
    ['lieferscheinnummer', 'lieferscheinnr', 'lsnr'],
    {
      label: 'Delivery note number',
      meaning: '"Lieferscheinnummer", the number of the delivery note',
    },
  ],
  [['lieferdatum'], { label: 'Delivery date', meaning: '"Lieferdatum", the delivery date' }],
  [['kunde'], { label: 'Customer', meaning: '"Kunde", the customer' }],
  [['straße', 'strasse'], { label: 'Street', meaning: '"Straße", the street' }],
  [['ort'], { label: 'City', meaning: '"Ort", the city' }],
  [['plz', 'postleitzahl'], { label: 'Postal code', meaning: '"Postleitzahl", the postal code' }],
  [['bemerkung'], { label: 'Note', meaning: '"Bemerkung", a note' }],
  [
    ['gtin', 'ean'],
    {
      label: 'Article number (GTIN)',
      meaning: 'the Global Trade Item Number of the article',
    },
  ],
  [['gln'], { label: 'Location number (GLN)', meaning: 'the Global Location Number of a party' }],
  [
    ['sscc'],
    {
      label: 'Shipping container code (SSCC)',
      meaning: 'the Serial Shipping Container Code of a package',
    },
  ],
  [['vatid', 'ustid'], { label: 'VAT ID', meaning: 'the VAT identification number' }],
  [['rows'], { label: 'Rows', meaning: 'the lines of the CSV file, one row each' }],
  [['items'], { label: 'Items', meaning: 'the entries of the list' }],
]

for (const [names, entry] of meanings) {
  add(names, entry)
}

const englishNames: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
  [['ordernumber', 'orderno'], 'Order number'],
  [['orderdate'], 'Order date'],
  [['invoicenumber', 'invoiceno'], 'Invoice number'],
  [['invoicedate'], 'Invoice date'],
  [['customernumber', 'customerno'], 'Customer number'],
  [['articlenumber', 'articleno'], 'Article number'],
  [['supplierarticlenumber'], 'Supplier article number'],
  [['buyerarticlenumber'], 'Buyer article number'],
  [['description'], 'Description'],
  [['quantity', 'qty'], 'Quantity'],
  [['unit'], 'Unit'],
  [['unitprice'], 'Unit price'],
  [['netprice'], 'Net price'],
  [['netamount'], 'Net amount'],
  [['currency'], 'Currency'],
  [['note'], 'Note'],
  [['name'], 'Name'],
  [['street'], 'Street'],
  [['postalcode', 'zip'], 'Postal code'],
  [['city'], 'City'],
  [['country'], 'Country'],
  [['phone'], 'Phone'],
  [['email'], 'Email address'],
  [['buyer'], 'Buyer'],
  [['supplier'], 'Supplier'],
  [['contact'], 'Contact'],
  [['invoicee'], 'Invoice recipient'],
  [['deliveryparty'], 'Delivery party'],
  [['shipto'], 'Ship-to party'],
  [['lines'], 'Lines'],
  [['linenumber'], 'Line number'],
  [['deliverydate'], 'Delivery date'],
  [['requesteddeliverydate'], 'Requested delivery date'],
  [['estimateddeliverydate'], 'Estimated delivery date'],
  [['despatchnumber', 'dispatchnumber'], 'Dispatch number'],
  [['despatchdate', 'dispatchdate'], 'Dispatch date'],
  [['documentdate'], 'Document date'],
  [['deliverynotenumber'], 'Delivery note number'],
  [['packages'], 'Packages'],
  [['packagenumber'], 'Package number'],
  [['paymentduedate'], 'Payment due date'],
  [['lineamount'], 'Line amount'],
  [['vatrate'], 'VAT rate in percent'],
  [['vatamount'], 'VAT amount'],
  [['taxableamount'], 'Taxable amount'],
  [['linetotal'], 'Line total'],
  [['invoicetotal'], 'Invoice total'],
  [['totals'], 'Totals'],
  [['vatbreakdown'], 'VAT breakdown'],
  [['rate'], 'Rate'],
  [['amount'], 'Amount'],
  [['total'], 'Total'],
  [['status'], 'Status'],
  [['sendergln'], 'Sender GLN'],
  [['recipientgln'], 'Recipient GLN'],
  [['interchangereference'], 'Interchange reference'],
  [['messagereference'], 'Message reference'],
  [['messagetype'], 'Message type'],
  [['messages'], 'Messages'],
  [['validfrom'], 'Valid from'],
  [['prices'], 'Prices'],
  [['keywords'], 'Keywords'],
]

for (const [names, label] of englishNames) {
  add(names, { label })
}

export const knownFieldNames: ReadonlyArray<string> = englishNames.map(([[name]]) => name!)

function normalized(name: string) {
  return name.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, '')
}

function spelledOut(name: string) {
  const words = name
    .replaceAll(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .join(' ')
    .toLowerCase()

  return words === '' ? name : `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

const shownValueCount = 3

function listed(values: ReadonlyArray<string>) {
  const shown = [...new Set(values.filter((value) => value !== ''))].slice(0, shownValueCount)
  const last = shown.pop()

  return last === undefined ? undefined : [shown.join(', '), last].filter(Boolean).join(' and ')
}

function evidence(values: ReadonlyArray<string>, lookLike: string | undefined) {
  const seen = listed(values)

  if (seen === undefined) {
    return ''
  }

  return lookLike ? ` Values ${seen} look like ${lookLike}.` : ` Values seen: ${seen}.`
}

export function plainNameOf(name: string, values: ReadonlyArray<string> = []): PlainName {
  const entry = known.get(normalized(name))

  if (entry) {
    const labelUnsure = entry.labelUnsure ?? false

    const meaning = entry.meaning
      ? `"${name}" stands for ${entry.meaning}.`
      : `"${name}" is a common name for "${entry.label}".`

    return {
      label: entry.label,
      labelReason: labelUnsure ? `${meaning}${evidence(values, entry.valuesLookLike)}` : meaning,
      labelUnsure,
    }
  }

  return {
    label: spelledOut(name).slice(0, maxFieldLabelLength).trim(),
    labelReason: `No known name matches "${name}", so its words are spelled out.${evidence(values, undefined)} Check that this is what it holds.`,
    labelUnsure: true,
  }
}

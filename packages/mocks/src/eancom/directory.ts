import type { LocalizedText } from '@edi-bridge/contracts'

type ElementDefinition = {
  name: LocalizedText
  format: string
  codes?: Readonly<Record<string, LocalizedText>>
}

type CompositeDefinition = {
  name: LocalizedText
  elements: ReadonlyArray<readonly [code: string, required: boolean]>
}

type SegmentDefinition = {
  name: LocalizedText
  children: ReadonlyArray<readonly [code: string, required: boolean]>
  // The element whose code a qualified use such as DTM+137 fixes.
  qualifiedBy?: string
}

const text = (en: string, de: string): LocalizedText => ({ en, de })

// Names and code meanings follow the EANCOM 1997 (D.96A) and syntax version 3 service segment
// directories. Only the elements and codes the retail Mappings use are listed.
const elements = {
  '0004': { name: text('Sender identification', 'Absenderbezeichnung'), format: 'an..35' },
  '0007': {
    name: text('Partner identification code qualifier', 'Partnerbezeichnung, Qualifier'),
    format: 'an..4',
    codes: {
      '14': text(
        'EAN (International Article Numbering association)',
        'EAN (Internationale Artikelnummerierungs-Vereinigung)',
      ),
    },
  },
  '0010': { name: text('Recipient identification', 'Empfängerbezeichnung'), format: 'an..35' },
  '0020': {
    name: text('Interchange control reference', 'Datenaustauschreferenz'),
    format: 'an..14',
  },
  '0051': {
    name: text('Controlling agency', 'Verwaltende Organisation'),
    format: 'an..2',
    codes: { UN: text('UN/CEFACT', 'UN/CEFACT') },
  },
  '0052': {
    name: text('Message type version number', 'Versionsnummer des Nachrichtentyps'),
    format: 'an..3',
    codes: {
      D: text('Draft version/UN/EDIFACT Directory', 'Entwurfsversion/UN/EDIFACT-Verzeichnis'),
    },
  },
  '0054': {
    name: text('Message type release number', 'Freigabenummer des Nachrichtentyps'),
    format: 'an..3',
    codes: {
      '96A': text('Release 1996 - A', 'Freigabe 1996 - A'),
      '3': text('Service message, version 3', 'Servicenachricht, Version 3'),
    },
  },
  '0057': {
    name: text('Association assigned code', 'Vom Verband vergebener Code'),
    format: 'an..6',
  },
  '0062': { name: text('Message reference number', 'Nachrichtenreferenznummer'), format: 'an..14' },
  '0065': {
    name: text('Message type identifier', 'Nachrichtentyp-Kennung'),
    format: 'an..6',
    codes: {
      ORDERS: text('Purchase order message', 'Bestellung'),
      DESADV: text('Despatch advice message', 'Liefermeldung'),
      INVOIC: text('Invoice message', 'Rechnung'),
      CONTRL: text('Syntax and service report message', 'Syntax- und Servicebericht'),
    },
  },
  '0074': {
    name: text('Number of segments in the message', 'Anzahl der Segmente in der Nachricht'),
    format: 'n..6',
  },
  '0081': {
    name: text('Section identification', 'Abschnittskennung'),
    format: 'a1',
    codes: {
      S: text('Detail/summary section separation', 'Trennung von Positions- und Summenteil'),
    },
  },
  '0083': {
    name: text('Action, coded', 'Maßnahme, codiert'),
    format: 'an..3',
    codes: {
      '4': text(
        'This level and all lower levels rejected',
        'Diese und alle untergeordneten Ebenen zurückgewiesen',
      ),
      '7': text(
        'This level acknowledged, lower levels acknowledged if not explicitly rejected',
        'Diese Ebene bestätigt, untergeordnete Ebenen bestätigt, sofern nicht ausdrücklich zurückgewiesen',
      ),
      '8': text('Interchange received', 'Übertragungsdatei empfangen'),
    },
  },
  '0085': {
    name: text('Syntax error, coded', 'Syntaxfehler, codiert'),
    format: 'an..3',
    codes: {
      '2': text(
        'Syntax version or level not supported',
        'Syntaxversion oder -stufe nicht unterstützt',
      ),
      '12': text('Invalid value', 'Ungültiger Wert'),
      '13': text('Missing', 'Fehlt'),
      '18': text('Unspecified error', 'Nicht spezifizierter Fehler'),
    },
  },
  '0096': {
    name: text('Segment position in message body', 'Segmentposition im Nachrichtenrumpf'),
    format: 'n..6',
  },
  '1001': {
    name: text('Document/message name, coded', 'Dokumenten-/Nachrichtenname, codiert'),
    format: 'an..3',
    codes: {
      '220': text('Order', 'Bestellung'),
      '351': text('Despatch advice', 'Liefermeldung'),
      '380': text('Commercial invoice', 'Handelsrechnung'),
      '381': text('Credit note', 'Gutschrift'),
    },
  },
  '1004': {
    name: text('Document/message number', 'Dokumenten-/Nachrichtennummer'),
    format: 'an..35',
  },
  '1082': { name: text('Line item number', 'Positionsnummer'), format: 'an..6' },
  '1131': { name: text('Code list qualifier', 'Codeliste, Qualifier'), format: 'an..3' },
  '1153': {
    name: text('Reference qualifier', 'Referenz, Qualifier'),
    format: 'an..3',
    codes: {
      ON: text('Order number (purchase)', 'Bestellnummer (Käufer)'),
      CT: text('Contract number', 'Vertragsnummer'),
      DQ: text('Delivery note number', 'Lieferscheinnummer'),
      VA: text('VAT registration number', 'Umsatzsteuer-Identifikationsnummer'),
    },
  },
  '1154': { name: text('Reference number', 'Referenznummer'), format: 'an..35' },
  '1225': {
    name: text('Message function, coded', 'Nachrichtenfunktion, codiert'),
    format: 'an..3',
    codes: {
      '9': text('Original', 'Original'),
      '5': text('Replace', 'Ersetzen'),
      '31': text('Copy', 'Kopie'),
    },
  },
  '2005': {
    name: text('Date/time/period qualifier', 'Datum/Uhrzeit/Zeitspanne, Qualifier'),
    format: 'an..3',
    codes: {
      '137': text('Document/message date/time', 'Dokumenten-/Nachrichtendatum/-zeit'),
      '2': text('Delivery date/time, requested', 'Liefertermin, gewünscht'),
      '11': text('Despatch date and/or time', 'Versanddatum und/oder -zeit'),
      '13': text('Terms net due date', 'Fälligkeitsdatum (netto)'),
      '17': text('Delivery date/time, estimated', 'Liefertermin, voraussichtlich'),
      '35': text('Delivery date/time, actual', 'Liefertermin, tatsächlich'),
      '171': text('Reference date/time', 'Referenzdatum/-zeit'),
    },
  },
  '2009': {
    name: text('Time relation, coded', 'Zeitbezug, codiert'),
    format: 'an..3',
    codes: { '3': text('After reference', 'Nach Bezugszeitpunkt') },
  },
  '2151': {
    name: text('Type of period, coded', 'Art der Periode, codiert'),
    format: 'an..3',
    codes: { D: text('Day', 'Tag') },
  },
  '2152': { name: text('Number of periods', 'Anzahl der Perioden'), format: 'n..3' },
  '2379': {
    name: text('Date/time/period format qualifier', 'Datum/Uhrzeit/Zeitspanne, Formatqualifier'),
    format: 'an..3',
    codes: {
      '102': text('CCYYMMDD', 'JJJJMMTT'),
      '203': text('CCYYMMDDHHMM', 'JJJJMMTTHHMM'),
    },
  },
  '2380': { name: text('Date/time/period', 'Datum/Uhrzeit/Zeitspanne'), format: 'an..35' },
  '2475': {
    name: text('Payment time reference, coded', 'Bezugszeitpunkt der Zahlung, codiert'),
    format: 'an..3',
    codes: { '5': text('Date of invoice', 'Rechnungsdatum') },
  },
  '3035': {
    name: text('Party qualifier', 'Beteiligter, Qualifier'),
    format: 'an..3',
    codes: {
      BY: text('Buyer', 'Käufer'),
      SU: text('Supplier', 'Lieferant'),
      DP: text('Delivery party', 'Warenempfänger'),
      IV: text('Invoicee', 'Rechnungsempfänger'),
    },
  },
  '3036': { name: text('Party name', 'Name des Beteiligten'), format: 'an..35' },
  '3039': {
    name: text('Party id. identification', 'Identifikation des Beteiligten'),
    format: 'an..35',
  },
  '3042': {
    name: text('Street and number/p.o. box', 'Straße und Hausnummer/Postfach'),
    format: 'an..35',
  },
  '3055': {
    name: text(
      'Code list responsible agency, coded',
      'Verantwortliche Stelle für die Codepflege, codiert',
    ),
    format: 'an..3',
    codes: {
      '9': text(
        'EAN (International Article Numbering association)',
        'EAN (Internationale Artikelnummerierungs-Vereinigung)',
      ),
    },
  },
  '3139': {
    name: text('Contact function, coded', 'Funktion des Ansprechpartners, codiert'),
    format: 'an..3',
    codes: { OC: text('Order contact', 'Ansprechpartner für Bestellungen') },
  },
  '3148': { name: text('Communication number', 'Kommunikationsnummer'), format: 'an..512' },
  '3155': {
    name: text('Communication channel qualifier', 'Kommunikationsart, Qualifier'),
    format: 'an..3',
    codes: { TE: text('Telephone', 'Telefon'), EM: text('Electronic mail', 'E-Mail') },
  },
  '3164': { name: text('City name', 'Ort'), format: 'an..35' },
  '3207': { name: text('Country, coded', 'Land, codiert'), format: 'an..3' },
  '3251': { name: text('Postcode identification', 'Postleitzahl'), format: 'an..9' },
  '3412': { name: text('Department or employee', 'Abteilung oder Mitarbeiter'), format: 'an..35' },
  '4233': {
    name: text('Marking instructions, coded', 'Markierungsanweisungen, codiert'),
    format: 'an..3',
    codes: {
      '33E': text(
        'Marked with serial shipping container code (EAN 128)',
        'Mit Nummer der Versandeinheit (EAN 128) gekennzeichnet',
      ),
    },
  },
  '4279': {
    name: text('Payment terms type qualifier', 'Zahlungsbedingungen, Qualifier'),
    format: 'an..3',
    codes: { '1': text('Basic', 'Standard') },
  },
  '4347': {
    name: text('Product id. function qualifier', 'Funktion der Produktidentifikation, Qualifier'),
    format: 'an..3',
    codes: { '1': text('Additional identification', 'Zusätzliche Identifikation') },
  },
  '4440': { name: text('Free text', 'Freier Text'), format: 'an..70' },
  '4451': {
    name: text('Text subject qualifier', 'Textbezug, Qualifier'),
    format: 'an..3',
    codes: { AAI: text('General information', 'Allgemeine Information') },
  },
  '5004': { name: text('Monetary amount', 'Geldbetrag'), format: 'n..18' },
  '5025': {
    name: text('Monetary amount type qualifier', 'Geldbetragsart, Qualifier'),
    format: 'an..3',
    codes: {
      '77': text('Invoice amount', 'Rechnungsbetrag'),
      '79': text('Total line items amount', 'Summe der Positionsbeträge'),
      '124': text('Tax amount', 'Steuerbetrag'),
      '125': text('Taxable amount', 'Steuerpflichtiger Betrag'),
      '176': text('Message total duty/tax/fee amount', 'Gesamtbetrag der Steuern der Nachricht'),
      '203': text('Line item amount', 'Positionsbetrag'),
    },
  },
  '5118': { name: text('Price', 'Preis'), format: 'n..15' },
  '5125': {
    name: text('Price qualifier', 'Preis, Qualifier'),
    format: 'an..3',
    codes: { AAA: text('Calculation net', 'Nettopreis für die Kalkulation') },
  },
  '5153': {
    name: text('Duty/tax/fee type, coded', 'Steuerart, codiert'),
    format: 'an..3',
    codes: { VAT: text('Value added tax', 'Umsatzsteuer') },
  },
  '5278': { name: text('Duty/tax/fee rate', 'Steuersatz'), format: 'an..17' },
  '5283': {
    name: text('Duty/tax/fee function qualifier', 'Funktion der Steuer, Qualifier'),
    format: 'an..3',
    codes: { '7': text('Tax', 'Steuer') },
  },
  '5305': {
    name: text('Duty/tax/fee category, coded', 'Steuerkategorie, codiert'),
    format: 'an..3',
    codes: { S: text('Standard rate', 'Normalsatz') },
  },
  '6060': { name: text('Quantity', 'Menge'), format: 'n..15' },
  '6063': {
    name: text('Quantity qualifier', 'Menge, Qualifier'),
    format: 'an..3',
    codes: {
      '21': text('Ordered quantity', 'Bestellte Menge'),
      '12': text('Despatch quantity', 'Liefermenge'),
      '47': text('Invoiced quantity', 'Berechnete Menge'),
    },
  },
  '6066': { name: text('Control value', 'Kontrollwert'), format: 'n..18' },
  '6069': {
    name: text('Control qualifier', 'Kontrolle, Qualifier'),
    format: 'an..3',
    codes: {
      '2': text('Number of line items in message', 'Anzahl der Positionen in der Nachricht'),
    },
  },
  '6343': {
    name: text('Currency qualifier', 'Währung, Qualifier'),
    format: 'an..3',
    codes: {
      '4': text('Invoicing currency', 'Rechnungswährung'),
      '9': text('Order currency', 'Bestellwährung'),
    },
  },
  '6345': {
    name: text('Currency, coded', 'Währung, codiert'),
    format: 'an..3',
    codes: { EUR: text('Euro', 'Euro') },
  },
  '6347': {
    name: text('Currency details qualifier', 'Währungsdetails, Qualifier'),
    format: 'an..3',
    codes: { '2': text('Reference currency', 'Referenzwährung') },
  },
  '6411': {
    name: text('Measure unit qualifier', 'Maßeinheit, Qualifier'),
    format: 'an..3',
    codes: { PCE: text('Piece', 'Stück'), KGM: text('Kilogram', 'Kilogramm') },
  },
  '7008': { name: text('Item description', 'Produktbeschreibung'), format: 'an..35' },
  '7065': {
    name: text('Type of packages identification', 'Packstückart, Identifikation'),
    format: 'an..17',
    codes: { PX: text('Pallet', 'Palette'), CT: text('Carton', 'Karton') },
  },
  '7077': {
    name: text('Item description type, coded', 'Art der Produktbeschreibung, codiert'),
    format: 'an..3',
    codes: { F: text('Free-form', 'Freitext') },
  },
  '7140': { name: text('Item number', 'Produktnummer'), format: 'an..35' },
  '7143': {
    name: text('Item number type, coded', 'Art der Produktnummer, codiert'),
    format: 'an..3',
    codes: {
      EN: text('International Article Numbering (EAN)', 'Internationale Artikelnummer (EAN)'),
      SA: text("Supplier's article number", 'Artikelnummer des Lieferanten'),
      IN: text("Buyer's item number", 'Artikelnummer des Käufers'),
    },
  },
  '7164': {
    name: text('Hierarchical id. number', 'Hierarchie-Identifikationsnummer'),
    format: 'an..12',
  },
  '7166': {
    name: text('Hierarchical parent id.', 'Übergeordnete Hierarchie-Identifikationsnummer'),
    format: 'an..12',
  },
  '7224': { name: text('Number of packages', 'Anzahl der Packstücke'), format: 'n..8' },
  '7402': { name: text('Identity number', 'Identifikationsnummer'), format: 'an..35' },
  '7405': {
    name: text('Identity number qualifier', 'Identifikationsnummer, Qualifier'),
    format: 'an..3',
    codes: {
      BJ: text('Serial shipping container code', 'Nummer der Versandeinheit (NVE)'),
    },
  },
} satisfies Record<string, ElementDefinition>

const composites = {
  C002: {
    name: text('Document/message name', 'Dokumenten-/Nachrichtenname'),
    elements: [['1001', false]],
  },
  C056: {
    name: text('Department or employee details', 'Abteilung oder Mitarbeiter'),
    elements: [['3412', false]],
  },
  C059: { name: text('Street', 'Straße'), elements: [['3042', true]] },
  C076: {
    name: text('Communication contact', 'Kommunikationsverbindung'),
    elements: [
      ['3148', true],
      ['3155', true],
    ],
  },
  C080: { name: text('Party name', 'Name des Beteiligten'), elements: [['3036', true]] },
  C082: {
    name: text('Party identification details', 'Identifikation des Beteiligten'),
    elements: [
      ['3039', true],
      ['1131', false],
      ['3055', false],
    ],
  },
  C108: { name: text('Text literal', 'Freier Text'), elements: [['4440', true]] },
  C110: {
    name: text('Payment terms', 'Zahlungsbedingungen'),
    elements: [
      ['2475', true],
      ['2009', false],
      ['2151', false],
      ['2152', false],
    ],
  },
  C186: {
    name: text('Quantity details', 'Mengenangaben'),
    elements: [
      ['6063', true],
      ['6060', true],
      ['6411', false],
    ],
  },
  C202: { name: text('Package type', 'Packstückart'), elements: [['7065', false]] },
  C208: {
    name: text('Identity number range', 'Identifikationsnummernbereich'),
    elements: [['7402', true]],
  },
  C212: {
    name: text('Item number identification', 'Produktidentifikation'),
    elements: [
      ['7140', false],
      ['7143', false],
    ],
  },
  C241: { name: text('Duty/tax/fee type', 'Steuerart'), elements: [['5153', false]] },
  C243: {
    name: text('Duty/tax/fee detail', 'Steuerdetails'),
    elements: [
      ['5278', false],
      ['5305', false],
    ],
  },
  C270: {
    name: text('Control', 'Kontrolle'),
    elements: [
      ['6069', true],
      ['6066', true],
    ],
  },
  C273: { name: text('Item description', 'Produktbeschreibung'), elements: [['7008', false]] },
  C504: {
    name: text('Currency details', 'Währungsdetails'),
    elements: [
      ['6347', true],
      ['6345', false],
      ['6343', false],
    ],
  },
  C506: {
    name: text('Reference', 'Referenz'),
    elements: [
      ['1153', true],
      ['1154', false],
    ],
  },
  C507: {
    name: text('Date/time/period', 'Datum/Uhrzeit/Zeitspanne'),
    elements: [
      ['2005', true],
      ['2380', false],
      ['2379', false],
    ],
  },
  C509: {
    name: text('Price information', 'Preisinformationen'),
    elements: [
      ['5125', true],
      ['5118', false],
    ],
  },
  C516: {
    name: text('Monetary amount', 'Geldbetrag'),
    elements: [
      ['5025', true],
      ['5004', false],
    ],
  },
  S002: {
    name: text('Interchange sender', 'Absender der Übertragungsdatei'),
    elements: [
      ['0004', true],
      ['0007', false],
    ],
  },
  S003: {
    name: text('Interchange recipient', 'Empfänger der Übertragungsdatei'),
    elements: [
      ['0010', true],
      ['0007', false],
    ],
  },
  S009: {
    name: text('Message identifier', 'Nachrichtenkennung'),
    elements: [
      ['0065', true],
      ['0052', true],
      ['0054', true],
      ['0051', true],
      ['0057', false],
    ],
  },
} satisfies Record<string, CompositeDefinition>

const segments = {
  BGM: {
    name: text('Beginning of message', 'Beginn der Nachricht'),
    children: [
      ['C002', false],
      ['1004', false],
      ['1225', false],
    ],
  },
  CNT: {
    name: text('Control total', 'Kontrollsumme'),
    children: [['C270', true]],
    qualifiedBy: '6069',
  },
  COM: {
    name: text('Communication contact', 'Kommunikationsverbindung'),
    children: [['C076', true]],
  },
  CPS: {
    name: text('Consignment packing sequence', 'Packstückfolge'),
    children: [
      ['7164', true],
      ['7166', false],
    ],
  },
  CTA: {
    name: text('Contact information', 'Ansprechpartner'),
    children: [
      ['3139', false],
      ['C056', false],
    ],
    qualifiedBy: '3139',
  },
  CUX: { name: text('Currencies', 'Währungsangaben'), children: [['C504', false]] },
  DTM: {
    name: text('Date/time/period', 'Datum/Uhrzeit/Zeitspanne'),
    children: [['C507', true]],
    qualifiedBy: '2005',
  },
  FTX: {
    name: text('Free text', 'Freier Text'),
    children: [
      ['4451', true],
      ['C108', false],
    ],
    qualifiedBy: '4451',
  },
  GIN: {
    name: text('Goods identity number', 'Warenidentifikationsnummer'),
    children: [
      ['7405', true],
      ['C208', true],
    ],
    qualifiedBy: '7405',
  },
  IMD: {
    name: text('Item description', 'Produktbeschreibung'),
    children: [
      ['7077', false],
      ['C273', false],
    ],
    qualifiedBy: '7077',
  },
  LIN: {
    name: text('Line item', 'Positionsdaten'),
    children: [
      ['1082', false],
      ['C212', false],
    ],
  },
  MOA: {
    name: text('Monetary amount', 'Geldbetrag'),
    children: [['C516', true]],
    qualifiedBy: '5025',
  },
  NAD: {
    name: text('Name and address', 'Name und Anschrift'),
    children: [
      ['3035', true],
      ['C082', false],
      ['C080', false],
      ['C059', false],
      ['3164', false],
      ['3251', false],
      ['3207', false],
    ],
    qualifiedBy: '3035',
  },
  PAC: {
    name: text('Package', 'Packstück'),
    children: [
      ['7224', false],
      ['C202', false],
    ],
  },
  PAT: {
    name: text('Payment terms basis', 'Zahlungsbedingungen'),
    children: [
      ['4279', true],
      ['C110', false],
    ],
    qualifiedBy: '4279',
  },
  PCI: {
    name: text('Package identification', 'Packstückkennzeichnung'),
    children: [['4233', false]],
    qualifiedBy: '4233',
  },
  PIA: {
    name: text('Additional product id', 'Zusätzliche Produktidentifikation'),
    children: [
      ['4347', true],
      ['C212', true],
    ],
    qualifiedBy: '4347',
  },
  PRI: {
    name: text('Price details', 'Preisangaben'),
    children: [['C509', false]],
    qualifiedBy: '5125',
  },
  QTY: {
    name: text('Quantity', 'Menge'),
    children: [['C186', true]],
    qualifiedBy: '6063',
  },
  RFF: {
    name: text('Reference', 'Referenz'),
    children: [['C506', true]],
    qualifiedBy: '1153',
  },
  TAX: {
    name: text('Duty/tax/fee details', 'Steuerangaben'),
    children: [
      ['5283', true],
      ['C241', false],
      ['C243', false],
    ],
    qualifiedBy: '5283',
  },
  UCI: {
    name: text('Interchange response', 'Antwort auf Übertragungsdatei'),
    children: [
      ['0020', true],
      ['S002', true],
      ['S003', true],
      ['0083', true],
      ['0085', false],
    ],
  },
  UCM: {
    name: text('Message response', 'Antwort auf Nachricht'),
    children: [
      ['0062', true],
      ['S009', true],
      ['0083', true],
      ['0085', false],
    ],
  },
  UCS: {
    name: text('Segment error indication', 'Segmentfehleranzeige'),
    children: [
      ['0096', true],
      ['0085', false],
    ],
  },
  UNH: {
    name: text('Message header', 'Nachrichtenkopf'),
    children: [
      ['0062', true],
      ['S009', true],
    ],
  },
  UNS: { name: text('Section control', 'Abschnittskontrolle'), children: [['0081', true]] },
  UNT: {
    name: text('Message trailer', 'Nachrichtenende'),
    children: [
      ['0074', true],
      ['0062', true],
    ],
  },
} satisfies Record<string, SegmentDefinition>

function lookup<Definition>(table: Readonly<Record<string, Definition>>, key: string) {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

export function elementDefinition(code: string) {
  return lookup<ElementDefinition>(elements, code)
}

export function compositeDefinition(code: string) {
  return lookup<CompositeDefinition>(composites, code)
}

export function segmentDefinition(tag: string) {
  return lookup<SegmentDefinition>(segments, tag)
}

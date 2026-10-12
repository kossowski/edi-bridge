import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import messagesDe from '../../messages/de.json'
import messagesEn from '../../messages/en.json'
import { type RequestFormat, partnerRequest, travellingDocumentNames } from './partner-request'
import {
  chooseWay,
  initialWizardState,
  type PartnerWizardState,
  type WizardDocument,
} from './partner-wizard-state'

function format(locale: 'en' | 'de'): RequestFormat {
  const t = createTranslator({
    locale,
    messages: locale === 'en' ? messagesEn : messagesDe,
    namespace: 'PartnerWizard',
  })

  const listFormat = new Intl.ListFormat(locale, { type: 'conjunction' })

  return { t: (key, values) => t(key, values), list: (items) => listFormat.format(items) }
}

const asked = {
  inbound: chooseWay(undefined, 'inbound', 'ask'),
  outbound: chooseWay(undefined, 'outbound', 'ask'),
}

function state(
  documents: WizardDocument[],
  connections: PartnerWizardState['connections'],
  glnLater = false,
): PartnerWizardState {
  return {
    ...initialWizardState,
    partner: { name: 'Kieler Kontor GmbH', gln: '', glnLater },
    documents,
    connections,
  }
}

const inboundLine =
  '- For the purchase orders you send us: the address and port of your SFTP server, the folder, the user name, and the password or private key. If you would rather send them to a web address, tell us, and we will send you our address and a key.'

const outboundLine =
  '- For the dispatch advices and invoices we send you: the address and port of your SFTP server, the folder, the user name, and the password or private key. Or a web address (URL) and, if needed, the value of the Authorization header.'

describe('partnerRequest', () => {
  it('asks for nothing when every direction has its details and the GLN is known', () => {
    expect(
      partnerRequest(
        state(['ORDERS'], { inbound: chooseWay(undefined, 'inbound', 'web') }),
        format('en'),
      ),
    ).toBeNull()
    expect(partnerRequest(state([], {}), format('en'))).toBeNull()
  })

  it('lists each postponed direction with its chosen documents and the GLN left for later', () => {
    expect(partnerRequest(state(['ORDERS', 'DESADV', 'INVOIC'], asked, true), format('en'))).toBe(
      [
        'Hello,',
        '',
        'we would like to exchange EDI documents with you. To set this up, please send us:',
        '',
        inboundLine,
        outboundLine,
        '- Your location number (GLN).',
        '',
        'Thank you!',
      ].join('\n'),
    )
  })

  it('leaves out a direction with details and a direction no document needs', () => {
    const request = partnerRequest(state(['DESADV', 'INVOIC'], asked), format('en'))

    expect(request).toContain(outboundLine)
    expect(request).not.toContain('purchase orders')
    expect(request).not.toContain('GLN')

    const withInboundDetails = partnerRequest(
      state(['ORDERS', 'INVOIC'], { ...asked, inbound: chooseWay(undefined, 'inbound', 'sftp') }),
      format('en'),
    )

    expect(withInboundDetails).not.toContain('purchase orders')
    expect(withInboundDetails).toContain('- For the invoices we send you:')
  })

  it('asks only for the GLN when every connection is known', () => {
    expect(
      partnerRequest(
        state(['INVOIC'], { outbound: chooseWay(undefined, 'outbound', 'sftp') }, true),
        format('en'),
      ),
    ).toBe(
      [
        'Hello,',
        '',
        'we would like to exchange EDI documents with you. To set this up, please send us:',
        '',
        '- Your location number (GLN).',
        '',
        'Thank you!',
      ].join('\n'),
    )
  })

  it('writes the request in German', () => {
    expect(partnerRequest(state(['DESADV', 'INVOIC'], asked, true), format('de'))).toBe(
      [
        'Guten Tag,',
        '',
        'wir möchten EDI-Belege mit Ihnen austauschen. Damit wir das einrichten können, senden Sie uns bitte:',
        '',
        '- Für die Lieferavise und Rechnungen, die wir Ihnen senden: Adresse und Port Ihres SFTP-Servers, den Ordner, den Benutzernamen und das Passwort oder den privaten Schlüssel. Oder eine Webadresse (URL) und, falls nötig, den Wert des Authorization-Headers.',
        '- Ihre Standortnummer (GLN).',
        '',
        'Vielen Dank!',
      ].join('\n'),
    )
  })
})

describe('travellingDocumentNames', () => {
  it('lists the chosen documents of one direction', () => {
    expect(travellingDocumentNames(['ORDERS', 'DESADV', 'INVOIC'], 'outbound', format('en'))).toBe(
      'dispatch advices and invoices',
    )
    expect(travellingDocumentNames(['ORDERS', 'DESADV'], 'inbound', format('de'))).toBe(
      'Bestellungen',
    )
  })
})

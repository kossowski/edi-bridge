import { en, Faker, faker as defaultFaker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  canSwitchToProduction,
  type CharacterSet,
  characterSets,
  createTradingPartnerEndpoint,
  switchToProductionEndpoint,
  type TradingPartner,
  tradingPartnerEndpoint,
  type TradingPartnerInput,
  type TradingPartnerOnboarding,
  tradingPartnerSchema,
  tradingPartnersEndpoint,
  updateTradingPartnerEndpoint,
  withCheckDigit,
  type Workspace,
} from '@edi-bridge/contracts'

import { seedId } from './seed-id'
import { seededFaker } from './seeded-faker'
import { seedWorkspace, toWorkspaceStore, type WorkspaceStore } from './workspace'

export function seedGln(tradingPartnerId: string) {
  const faker = seededFaker(`gln:${tradingPartnerId}`)

  return withCheckDigit(`02${faker.string.numeric({ length: 10, allowLeadingZeros: true })}`)
}

const notStarted: TradingPartnerOnboarding = { testInterchangeSentAt: null, contrlReceivedAt: null }

function onboarded(day: string): TradingPartnerOnboarding {
  return { testInterchangeSentAt: `${day}T09:12:00.000Z`, contrlReceivedAt: `${day}T09:14:30.000Z` }
}

const seeds: ReadonlyArray<
  Pick<TradingPartner, 'name' | 'characterSet' | 'acknowledgementTimeLimitHours' | 'testMode'> & {
    onboarding: TradingPartnerOnboarding
  }
> = [
  {
    name: 'Hansemarkt GmbH',
    characterSet: 'UNOC',
    acknowledgementTimeLimitHours: 24,
    testMode: false,
    onboarding: onboarded('2026-02-10'),
  },
  {
    name: 'Alpenfrisch Märkte AG',
    characterSet: 'UNOC',
    acknowledgementTimeLimitHours: 4,
    testMode: false,
    onboarding: onboarded('2026-03-04'),
  },
  {
    name: 'Rheinkauf eG',
    characterSet: 'UNOA',
    acknowledgementTimeLimitHours: 24,
    testMode: false,
    onboarding: onboarded('2026-04-22'),
  },
  {
    name: 'Elbtal Warenhaus KG',
    characterSet: 'UNOB',
    acknowledgementTimeLimitHours: 48,
    testMode: false,
    onboarding: onboarded('2026-06-15'),
  },
  {
    name: 'Spreewald Frische GmbH',
    characterSet: 'UNOC',
    acknowledgementTimeLimitHours: 24,
    testMode: true,
    onboarding: onboarded('2026-09-28'),
  },
  {
    name: 'Bodensee Handelshaus AG',
    characterSet: 'UNOC',
    acknowledgementTimeLimitHours: 12,
    testMode: true,
    onboarding: { testInterchangeSentAt: '2026-10-06T14:03:00.000Z', contrlReceivedAt: null },
  },
  {
    name: 'Mainfranken Getränke GmbH',
    characterSet: 'UNOC',
    acknowledgementTimeLimitHours: 24,
    testMode: true,
    onboarding: notStarted,
  },
]

export const seedTradingPartners: ReadonlyArray<TradingPartner> = seeds.map((seed, index) => {
  const id = seedId(1, index + 1)

  return tradingPartnerSchema.parse({ ...seed, id, gln: seedGln(id) })
})

function generateTradingPartner(faker: Faker, now: Date): TradingPartner {
  const stage = faker.helpers.weightedArrayElement([
    { value: 'production', weight: 80 },
    { value: 'contrl', weight: 8 },
    { value: 'awaitingContrl', weight: 6 },
    { value: 'new', weight: 6 },
  ] as const)

  const sentAt = faker.date.past({ years: 2, refDate: now })
  const receivedAt = new Date(sentAt.getTime() + faker.number.int({ min: 1, max: 600 }) * 1000)

  return {
    id: faker.string.uuid(),
    name: faker.company.name(),
    gln: withCheckDigit(`02${faker.string.numeric({ length: 10, allowLeadingZeros: true })}`),
    characterSet: faker.helpers.weightedArrayElement<CharacterSet>([
      { value: 'UNOC', weight: 70 },
      ...characterSets
        .filter((characterSet) => characterSet !== 'UNOC')
        .map((value) => ({ value, weight: 6 })),
    ]),
    acknowledgementTimeLimitHours: faker.helpers.arrayElement([4, 12, 24, 24, 24, 48, 72]),
    testMode: stage !== 'production',
    onboarding: {
      testInterchangeSentAt: stage === 'new' ? null : sentAt.toISOString(),
      contrlReceivedAt:
        stage === 'new' || stage === 'awaitingContrl' ? null : receivedAt.toISOString(),
    },
  }
}

export function createTradingPartner(overrides: Partial<TradingPartner> = {}): TradingPartner {
  return tradingPartnerSchema.parse({
    ...generateTradingPartner(defaultFaker, new Date()),
    ...overrides,
  })
}

export function createTradingPartners({
  count,
  now = new Date(),
  seed = 11,
}: {
  count: number
  now?: Date
  seed?: number
}): TradingPartner[] {
  const faker = new Faker({ locale: [en], seed })
  const glns = new Set<string>()
  const tradingPartners: TradingPartner[] = []

  while (tradingPartners.length < count) {
    const tradingPartner = generateTradingPartner(faker, now)

    if (!glns.has(tradingPartner.gln)) {
      glns.add(tradingPartner.gln)
      tradingPartners.push(tradingPartnerSchema.parse(tradingPartner))
    }
  }

  return tradingPartners
}

export function tradingPartnersHandler(
  apiUrl: string,
  tradingPartners: ReadonlyArray<TradingPartner> = seedTradingPartners,
) {
  return http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () =>
    HttpResponse.json(tradingPartners),
  )
}

export function tradingPartnerHandlers(
  apiUrl: string,
  {
    tradingPartners = seedTradingPartners,
    workspace = seedWorkspace,
  }: {
    tradingPartners?: ReadonlyArray<TradingPartner>
    workspace?: Workspace | WorkspaceStore
  } = {},
) {
  const byId = new Map(tradingPartners.map((tradingPartner) => [tradingPartner.id, tradingPartner]))
  const workspaceStore = toWorkspaceStore(workspace)

  function glnTaken(gln: string, ownId?: string) {
    return [...byId.values()].some(
      (tradingPartner) => tradingPartner.gln === gln && tradingPartner.id !== ownId,
    )
  }

  async function parseInput(
    request: Request,
  ): Promise<{ input: TradingPartnerInput } | { response: Response }> {
    const body = createTradingPartnerEndpoint.body.safeParse(await request.json())

    return body.success
      ? { input: body.data }
      : { response: HttpResponse.json({ message: body.error.message }, { status: 400 }) }
  }

  const glnConflict = () =>
    HttpResponse.json({ message: 'Another Trading Partner already uses this GLN' }, { status: 409 })

  const notFound = () => HttpResponse.json({ message: 'Not found' }, { status: 404 })

  return [
    http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () =>
      HttpResponse.json([...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))),
    ),
    http.get<{ id: string }>(`${apiUrl}${tradingPartnerEndpoint.path}`, ({ params }) => {
      const tradingPartner = byId.get(params.id)

      return tradingPartner ? HttpResponse.json(tradingPartner) : notFound()
    }),
    http.post(`${apiUrl}${createTradingPartnerEndpoint.path}`, async ({ request }) => {
      const parsed = await parseInput(request)

      if ('response' in parsed) {
        return parsed.response
      }

      if (glnTaken(parsed.input.gln)) {
        return glnConflict()
      }

      const created: TradingPartner = {
        ...parsed.input,
        id: crypto.randomUUID(),
        testMode: true,
        onboarding: notStarted,
      }

      byId.set(created.id, created)

      return HttpResponse.json(created, { status: 201 })
    }),
    http.put<{ id: string }>(
      `${apiUrl}${updateTradingPartnerEndpoint.path}`,
      async ({ params, request }) => {
        const existing = byId.get(params.id)

        if (!existing) {
          return notFound()
        }

        const parsed = await parseInput(request)

        if ('response' in parsed) {
          return parsed.response
        }

        if (glnTaken(parsed.input.gln, existing.id)) {
          return glnConflict()
        }

        const updated = { ...existing, ...parsed.input }
        byId.set(updated.id, updated)

        return HttpResponse.json(updated)
      },
    ),
    http.post<{ id: string }>(`${apiUrl}${switchToProductionEndpoint.path}`, ({ params }) => {
      const existing = byId.get(params.id)

      if (!existing) {
        return notFound()
      }

      if (!canSwitchToProduction(existing, workspaceStore.get().gln)) {
        return HttpResponse.json({ message: 'Onboarding is not complete' }, { status: 409 })
      }

      const updated = { ...existing, testMode: false }
      byId.set(updated.id, updated)

      return HttpResponse.json(updated)
    }),
  ]
}

import { en, Faker, faker as defaultFaker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  canSendTestInterchange,
  canSwitchToProduction,
  type CharacterSet,
  characterSets,
  createTradingPartnerEndpoint,
  glnRequired,
  switchToProductionEndpoint,
  type TradingPartner,
  tradingPartnerEndpoint,
  type TradingPartnerInput,
  type TradingPartnerOnboarding,
  tradingPartnerSchema,
  sendTestInterchangeEndpoint,
  tradingPartnersEndpoint,
  updateTradingPartnerEndpoint,
  type Workspace,
} from '@edi-bridge/contracts'

import { randomGln } from './gln'
import { conflict, unprocessable } from './responses'
import { seedId } from './seed-id'
import { seededFaker } from './seeded-faker'
import { seedWorkspace, toWorkspaceStore, type WorkspaceStore } from './workspace'

export function seedGln(tradingPartnerId: string) {
  return randomGln(seededFaker(`gln:${tradingPartnerId}`))
}

export function hasTraffic({ onboarding }: Pick<TradingPartner, 'onboarding'>) {
  return onboarding.testInterchangeSentAt !== null
}

const notStarted: TradingPartnerOnboarding = { testInterchangeSentAt: null, contrlReceivedAt: null }

function onboarded(day: string): TradingPartnerOnboarding {
  return { testInterchangeSentAt: `${day}T09:12:00.000Z`, contrlReceivedAt: `${day}T09:14:30.000Z` }
}

const seeds: ReadonlyArray<
  Pick<TradingPartner, 'name' | 'characterSet' | 'acknowledgementTimeLimitHours' | 'testMode'> & {
    onboarding: TradingPartnerOnboarding
    gln?: null
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
  {
    name: 'Ostsee Feinkost GmbH',
    characterSet: 'UNOC',
    acknowledgementTimeLimitHours: 24,
    testMode: true,
    onboarding: notStarted,
    gln: null,
  },
]

export const seedTradingPartners: ReadonlyArray<TradingPartner> = seeds.map((seed, index) => {
  const id = seedId(1, index + 1)

  return tradingPartnerSchema.parse({ id, gln: seedGln(id), ...seed })
})

function generateTradingPartner(faker: Faker, now: Date): TradingPartner {
  const stage = faker.helpers.weightedArrayElement([
    { value: 'inProduction', weight: 80 },
    { value: 'readyForProduction', weight: 8 },
    { value: 'awaitingContrl', weight: 6 },
    { value: 'awaitingTestInterchange', weight: 6 },
  ] as const)

  const sentAt = faker.date.past({ years: 2, refDate: now })
  const receivedAt = new Date(sentAt.getTime() + faker.number.int({ min: 1, max: 600 }) * 1000)

  const gln = randomGln(faker)

  return {
    id: faker.string.uuid(),
    name: faker.company.name(),
    gln: stage === 'awaitingTestInterchange' && faker.datatype.boolean(0.3) ? null : gln,
    characterSet: faker.helpers.weightedArrayElement<CharacterSet>([
      { value: 'UNOC', weight: 70 },
      ...characterSets
        .filter((characterSet) => characterSet !== 'UNOC')
        .map((value) => ({ value, weight: 6 })),
    ]),
    acknowledgementTimeLimitHours: faker.helpers.arrayElement([4, 12, 24, 24, 24, 48, 72]),
    testMode: stage !== 'inProduction',
    onboarding: {
      testInterchangeSentAt: stage === 'awaitingTestInterchange' ? null : sentAt.toISOString(),
      contrlReceivedAt:
        stage === 'awaitingTestInterchange' || stage === 'awaitingContrl'
          ? null
          : receivedAt.toISOString(),
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

    const { gln } = tradingPartner

    if (gln !== null) {
      if (glns.has(gln)) {
        continue
      }

      glns.add(gln)
    }

    tradingPartners.push(tradingPartnerSchema.parse(tradingPartner))
  }

  return tradingPartners
}

export type TradingPartnerStore = {
  all: () => readonly TradingPartner[]
  get: (id: string) => TradingPartner | undefined
  set: (tradingPartner: TradingPartner) => void
}

export function createTradingPartnerStore(
  tradingPartners: ReadonlyArray<TradingPartner> = seedTradingPartners,
): TradingPartnerStore {
  const byId = new Map(tradingPartners.map((tradingPartner) => [tradingPartner.id, tradingPartner]))

  return {
    all: () => [...byId.values()],
    get: (id) => byId.get(id),
    set: (tradingPartner) => {
      byId.set(tradingPartner.id, tradingPartner)
    },
  }
}

export function toTradingPartnerStore(
  tradingPartners: ReadonlyArray<TradingPartner> | TradingPartnerStore = seedTradingPartners,
) {
  return 'get' in tradingPartners ? tradingPartners : createTradingPartnerStore(tradingPartners)
}

export type TestInterchangeOptions = {
  contrlDelayMs?: number | null
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

// Lets /trading-partners/activity fall through to its own handler.
function isTradingPartnerId(id: string) {
  return uuid.test(id)
}

export function tradingPartnerHandlers(
  apiUrl: string,
  {
    tradingPartners = seedTradingPartners,
    workspace = seedWorkspace,
    testInterchange: { contrlDelayMs = 5000 } = {},
  }: {
    tradingPartners?: ReadonlyArray<TradingPartner> | TradingPartnerStore
    workspace?: Workspace | WorkspaceStore
    testInterchange?: TestInterchangeOptions
  } = {},
) {
  const store = toTradingPartnerStore(tradingPartners)
  const workspaceStore = toWorkspaceStore(workspace)
  const contrlDueAt = new Map<string, number>()

  function receiveDueContrls() {
    for (const [id, dueAt] of contrlDueAt) {
      const tradingPartner = store.get(id)

      if (dueAt > Date.now() || !tradingPartner) {
        continue
      }

      contrlDueAt.delete(id)

      store.set({
        ...tradingPartner,
        onboarding: {
          ...tradingPartner.onboarding,
          contrlReceivedAt: new Date(dueAt).toISOString(),
        },
      })
    }
  }

  function glnTaken(gln: string | null, ownId?: string) {
    return (
      gln !== null &&
      store
        .all()
        .some((tradingPartner) => tradingPartner.gln === gln && tradingPartner.id !== ownId)
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
    http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () => {
      receiveDueContrls()

      return HttpResponse.json([...store.all()].sort((a, b) => a.name.localeCompare(b.name, 'de')))
    }),
    http.get<{ id: string }>(`${apiUrl}${tradingPartnerEndpoint.path}`, ({ params }) => {
      if (!isTradingPartnerId(params.id)) {
        return undefined
      }

      receiveDueContrls()
      const tradingPartner = store.get(params.id)

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

      store.set(created)

      return HttpResponse.json(created, { status: 201 })
    }),
    http.put<{ id: string }>(
      `${apiUrl}${updateTradingPartnerEndpoint.path}`,
      async ({ params, request }) => {
        const existing = store.get(params.id)

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

        if (parsed.input.gln === null && glnRequired(existing)) {
          return unprocessable('The Trading Partner needs its GLN once Interchanges were exchanged')
        }

        const updated = { ...existing, ...parsed.input }
        store.set(updated)

        return HttpResponse.json(updated)
      },
    ),
    http.post<{ id: string }>(`${apiUrl}${switchToProductionEndpoint.path}`, ({ params }) => {
      receiveDueContrls()
      const existing = store.get(params.id)

      if (!existing) {
        return notFound()
      }

      if (!canSwitchToProduction(existing, workspaceStore.get().gln)) {
        return HttpResponse.json({ message: 'Onboarding is not complete' }, { status: 409 })
      }

      const updated = { ...existing, testMode: false }
      store.set(updated)

      return HttpResponse.json(updated)
    }),
    http.post<{ id: string }>(`${apiUrl}${sendTestInterchangeEndpoint.path}`, ({ params }) => {
      receiveDueContrls()
      const existing = store.get(params.id)

      if (!existing) {
        return notFound()
      }

      if (!canSendTestInterchange(existing, workspaceStore.get().gln)) {
        return conflict('The Trading Partner does not await a test Interchange')
      }

      const sentAt = Date.now()

      const updated: TradingPartner = {
        ...existing,
        onboarding: {
          testInterchangeSentAt: new Date(sentAt).toISOString(),
          contrlReceivedAt: null,
        },
      }

      store.set(updated)

      if (contrlDelayMs === null) {
        contrlDueAt.delete(existing.id)
      } else {
        contrlDueAt.set(existing.id, sentAt + contrlDelayMs)
      }

      return HttpResponse.json(updated)
    }),
  ]
}

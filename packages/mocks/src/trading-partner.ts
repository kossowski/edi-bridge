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
  type TestInterchangeRefusal,
  testInterchangeRefusedProblem,
  testInterchangeRefusedStatus,
  tradingPartnersEndpoint,
  updateTradingPartnerEndpoint,
  type Workspace,
  type Session,
} from '@edi-bridge/contracts'

import { randomGln } from './gln'
import { notFound, unprocessable } from './responses'
import { seedId } from './seed-id'
import { seededFaker } from './seeded-faker'
import { seedSession, toSessionStore } from './session'
import { adminOnly, type SessionStore } from './session-access'
import { seedWorkspace, toWorkspaceStore, type WorkspaceStore } from './workspace'

export function seedGln(tradingPartnerId: string) {
  return randomGln(seededFaker(`gln:${tradingPartnerId}`))
}

export function hasTraffic({ onboarding }: Pick<TradingPartner, 'onboarding'>) {
  return onboarding.testInterchangeSentAt !== null
}

const notStarted: TradingPartnerOnboarding = {
  testInterchangeSentAt: null,
  contrlReceivedAt: null,
  testRejectedAt: null,
  testRejectedRunId: null,
}

function onboarded(day: string): TradingPartnerOnboarding {
  return {
    testInterchangeSentAt: `${day}T09:12:00.000Z`,
    contrlReceivedAt: `${day}T09:14:30.000Z`,
    testRejectedAt: null,
    testRejectedRunId: null,
  }
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
    onboarding: {
      testInterchangeSentAt: '2026-10-06T14:03:00.000Z',
      contrlReceivedAt: null,
      testRejectedAt: null,
      testRejectedRunId: null,
    },
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
      testRejectedAt: null,
      testRejectedRunId: null,
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
  handoverDelayMs?: number
  contrlDelayMs?: number | null
  rejectingRunId?: string
  refusal?: Exclude<TestInterchangeRefusal, { reason: 'notAwaited' }>
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

// Lets /trading-partners/activity fall through to its own handler.
function isTradingPartnerId(id: string) {
  return uuid.test(id)
}

const refuseTestInterchange = (refusal: TestInterchangeRefusal) =>
  HttpResponse.json(testInterchangeRefusedProblem(refusal), {
    status: testInterchangeRefusedStatus,
  })

// Registered after the handlers of /trading-partners/<word>, so only an unknown id reaches it.
export function tradingPartnerNotFoundHandler(apiUrl: string) {
  return http.get(`${apiUrl}${tradingPartnerEndpoint.path}`, () => notFound())
}

export function tradingPartnerHandlers(
  apiUrl: string,
  {
    tradingPartners = seedTradingPartners,
    workspace = seedWorkspace,
    testInterchange: { handoverDelayMs = 1000, contrlDelayMs = 5000, rejectingRunId, refusal } = {},
    session = seedSession,
  }: {
    tradingPartners?: ReadonlyArray<TradingPartner> | TradingPartnerStore
    workspace?: Workspace | WorkspaceStore
    testInterchange?: TestInterchangeOptions
    session?: Session | null | SessionStore
  } = {},
) {
  const store = toTradingPartnerStore(tradingPartners)
  const sessionStore = toSessionStore(session)
  const workspaceStore = toWorkspaceStore(workspace)
  const handoverDueAt = new Map<string, number>()
  const contrlDueAt = new Map<string, number>()

  function receiveDueContrls() {
    for (const [id, dueAt] of contrlDueAt) {
      const tradingPartner = store.get(id)

      if (dueAt > Date.now() || !tradingPartner) {
        continue
      }

      contrlDueAt.delete(id)

      const at = new Date(dueAt).toISOString()

      store.set({
        ...tradingPartner,
        onboarding: {
          ...tradingPartner.onboarding,
          ...(rejectingRunId === undefined
            ? { contrlReceivedAt: at }
            : { testRejectedAt: at, testRejectedRunId: rejectingRunId }),
        },
      })
    }
  }

  // Like the worker, which records only the first hand-over of a Trading Partner in Test Mode.
  function handOverDueInterchanges() {
    for (const [id, dueAt] of handoverDueAt) {
      const tradingPartner = store.get(id)

      if (dueAt > Date.now() || !tradingPartner) {
        continue
      }

      handoverDueAt.delete(id)

      store.set({
        ...tradingPartner,
        onboarding: {
          ...tradingPartner.onboarding,
          testInterchangeSentAt:
            tradingPartner.onboarding.testInterchangeSentAt ?? new Date(dueAt).toISOString(),
        },
      })

      if (contrlDelayMs !== null) {
        contrlDueAt.set(id, dueAt + contrlDelayMs)
      }
    }
  }

  // CONTRLs first, so a CONTRL arrives at the earliest on the check after its hand-over.
  function advance() {
    receiveDueContrls()
    handOverDueInterchanges()
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

  return [
    http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () => {
      advance()

      return HttpResponse.json([...store.all()].sort((a, b) => a.name.localeCompare(b.name, 'de')))
    }),
    http.get<{ id: string }>(`${apiUrl}${tradingPartnerEndpoint.path}`, ({ params }) => {
      if (!isTradingPartnerId(params.id)) {
        return undefined
      }

      advance()
      const tradingPartner = store.get(params.id)

      return tradingPartner ? HttpResponse.json(tradingPartner) : notFound()
    }),
    http.post(
      `${apiUrl}${createTradingPartnerEndpoint.path}`,
      adminOnly(sessionStore, async ({ request }) => {
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
    ),
    http.put<{ id: string }>(
      `${apiUrl}${updateTradingPartnerEndpoint.path}`,
      adminOnly(sessionStore, async ({ params, request }) => {
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
      }),
    ),
    http.post<{ id: string }>(
      `${apiUrl}${switchToProductionEndpoint.path}`,
      adminOnly(sessionStore, ({ params }) => {
        advance()
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
    ),
    http.post<{ id: string }>(
      `${apiUrl}${sendTestInterchangeEndpoint.path}`,
      adminOnly(sessionStore, ({ params }) => {
        advance()
        const existing = store.get(params.id)

        if (!existing) {
          return notFound()
        }

        if (!canSendTestInterchange(existing, workspaceStore.get().gln)) {
          return refuseTestInterchange({ reason: 'notAwaited' })
        }

        if (refusal) {
          return refuseTestInterchange(refusal)
        }

        // The api answers before the worker hands the test Interchange over.
        const updated: TradingPartner = {
          ...existing,
          onboarding: { ...existing.onboarding, testRejectedAt: null, testRejectedRunId: null },
        }

        store.set(updated)
        contrlDueAt.delete(existing.id)
        handoverDueAt.set(existing.id, Date.now() + handoverDelayMs)

        return HttpResponse.json(updated)
      }),
    ),
  ]
}

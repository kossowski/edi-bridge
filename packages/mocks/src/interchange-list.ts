import { http, HttpResponse } from 'msw'

import {
  directionOf,
  fromSearchParams,
  type InterchangeListQuery,
  interchangesEndpoint,
  type InterchangeSummary,
  type RunSummary,
} from '@edi-bridge/contracts'

import { includesText, seedRuns } from './run'
import { type RunGroup, type RunStore, toRunStore } from './run-store'

function toInterchangeSummary(group: RunGroup, store: RunStore): InterchangeSummary {
  const first = group.members[0]!.run

  return {
    id: group.id,
    controlReference: group.controlReference,
    direction: directionOf(first),
    tradingPartner: first.tradingPartner,
    preparedAt: first.receivedAt,
    runs: group.runIds.map((runId) => store.get(runId)!),
  }
}

function matches(interchange: InterchangeSummary, query: InterchangeListQuery, text: string) {
  return (
    (!query.tradingPartnerId?.length ||
      query.tradingPartnerId.includes(interchange.tradingPartner.id)) &&
    (!query.messageType?.length ||
      interchange.runs.some(({ messageType }) => query.messageType!.includes(messageType))) &&
    (text === '' ||
      includesText(interchange.controlReference, text) ||
      includesText(interchange.tradingPartner.name, text) ||
      interchange.runs.some(({ businessReference }) => includesText(businessReference, text)))
  )
}

export function interchangesHandler(apiUrl: string, runs?: ReadonlyArray<RunSummary> | RunStore) {
  let store: RunStore | undefined
  let groups: readonly RunGroup[] | undefined
  let newestFirst: InterchangeSummary[] = []

  function interchanges() {
    const current = (store ??= toRunStore(runs ?? seedRuns()))

    if (groups !== current.groups()) {
      groups = current.groups()
      newestFirst = groups
        .flatMap((group) => (group.hasInterchange ? [toInterchangeSummary(group, current)] : []))
        .sort((a, b) => Date.parse(b.preparedAt) - Date.parse(a.preparedAt))
    }

    return newestFirst
  }

  return http.get(`${apiUrl}${interchangesEndpoint.path}`, ({ request }) => {
    const query = interchangesEndpoint.query.safeParse(
      fromSearchParams(new URL(request.url).searchParams),
    )

    if (!query.success) {
      return HttpResponse.json({ message: query.error.message }, { status: 400 })
    }

    const { page, pageSize } = query.data
    const text = query.data.q?.toLowerCase() ?? ''
    const filtered = interchanges().filter((interchange) => matches(interchange, query.data, text))

    return HttpResponse.json({
      interchanges: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
    })
  })
}

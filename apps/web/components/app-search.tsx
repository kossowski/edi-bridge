'use client'

import { Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  OrderLifecycleResults,
  orderLifecycleResultValue,
} from '@/components/search/order-lifecycle-results'
import { PageResults } from '@/components/search/page-results'
import { RunResults } from '@/components/search/run-results'
import { TradingPartnerResults } from '@/components/search/trading-partner-results'
import { type SearchFailure, UnavailableResults } from '@/components/search/unavailable-results'
import { useApplePlatform } from '@/hooks/use-apple-platform'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useSearchShortcut } from '@/hooks/use-search-shortcut'
import { useSession } from '@/hooks/use-session'
import { orderLifecycleDetailQuery, runsQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { businessReferenceSchema } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from '@edi-bridge/ui/components/command'
import { Kbd } from '@edi-bridge/ui/components/kbd'
import { Spinner } from '@edi-bridge/ui/components/spinner'

const latestRuns = { page: 1, pageSize: 50 }

const searchDelay = 300

function businessReferenceIn(search: string) {
  const parsed = businessReferenceSchema.safeParse(search)

  return parsed.success && /\d/.test(parsed.data) && !/\s/.test(parsed.data)
    ? parsed.data
    : undefined
}

function matchesAllTerms(_value: string, search: string, keywords?: string[]) {
  const text = (keywords ?? []).join(' ').toLocaleLowerCase()
  const terms = search.toLocaleLowerCase().split(/\s+/)

  return terms.every((term) => text.includes(term)) ? 1 : 0
}

export function AppSearch() {
  const t = useTranslations('Search')
  const router = useRouter()
  const apple = useApplePlatform()
  const { operator } = useSession()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedResult, setSelectedResult] = useState('')

  const businessReference = businessReferenceIn(search)
  const settled = useDebouncedValue(businessReference, businessReference ?? '', searchDelay)
  const searchedBusinessReference = settled.pending ? undefined : settled.value

  const tradingPartners = useQuery({ ...tradingPartnersQuery, enabled: open, retry: false })
  const runs = useQuery({ ...runsQuery(latestRuns), enabled: open, retry: false })

  const orderLifecycles = useQuery({
    ...orderLifecycleDetailQuery(searchedBusinessReference ?? ''),
    enabled: open && searchedBusinessReference !== undefined,
    retry: false,
  })

  const orderLifecyclesLoading =
    businessReference !== undefined && (settled.pending || orderLifecycles.isFetching)

  const foundOrderLifecycles =
    searchedBusinessReference !== undefined && !orderLifecyclesLoading
      ? orderLifecycles.data
      : undefined

  const [selectedFor, setSelectedFor] = useState(foundOrderLifecycles)

  if (selectedFor !== foundOrderLifecycles) {
    setSelectedFor(foundOrderLifecycles)

    const first = foundOrderLifecycles?.[0]

    if (first) {
      setSelectedResult(orderLifecycleResultValue(first))
    }
  }

  const loading = open && (tradingPartners.isPending || runs.isPending || orderLifecyclesLoading)

  const failures: ReadonlyArray<SearchFailure> = [
    {
      key: 'orders',
      failed: orderLifecycles.isError && !orderLifecyclesLoading,
      retry: () => void orderLifecycles.refetch(),
    },
    {
      key: 'tradingPartners',
      failed: tradingPartners.isError,
      retry: () => void tradingPartners.refetch(),
    },
    { key: 'documents', failed: runs.isError, retry: () => void runs.refetch() },
  ]

  const failed = failures.some((failure) => failure.failed)

  function changeOpen(next: boolean) {
    setOpen(next)
    setSearch('')
  }

  useSearchShortcut(() => changeOpen(!open))

  function openResult(href: string) {
    changeOpen(false)
    router.push(href)
  }

  return (
    <>
      <Button
        variant="outline"
        aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}
        className="text-muted-foreground bg-muted/40 size-10 justify-center gap-2.5 font-normal lg:w-80 lg:justify-start lg:px-3 xl:w-96"
        onClick={() => changeOpen(true)}>
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} aria-hidden />
        <span className="sr-only lg:not-sr-only lg:min-w-0">
          <span className="block truncate text-sm">{t('trigger')}</span>
        </span>
        <Kbd aria-hidden className="bg-background ml-auto hidden shrink-0 lg:inline-flex">
          {apple ? '⌘K' : 'Ctrl K'}
        </Kbd>
      </Button>
      <CommandDialog
        description={t('description')}
        open={open}
        title={t('title')}
        onOpenChange={changeOpen}>
        <Command
          filter={matchesAllTerms}
          label={t('title')}
          value={selectedResult}
          onValueChange={setSelectedResult}>
          <CommandInput placeholder={t('placeholder')} value={search} onValueChange={setSearch} />
          <div
            role="status"
            className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm empty:hidden">
            {loading && (
              <>
                <Spinner role="presentation" aria-hidden />
                {t('loading')}
              </>
            )}
          </div>
          {!loading && !failed && <CommandEmpty>{t('empty')}</CommandEmpty>}
          <CommandList>
            <UnavailableResults failures={failures} />
            {searchedBusinessReference !== undefined && foundOrderLifecycles && (
              <OrderLifecycleResults
                businessReference={searchedBusinessReference}
                orderLifecycles={foundOrderLifecycles}
                onOpen={openResult}
              />
            )}
            {tradingPartners.data && (
              <TradingPartnerResults tradingPartners={tradingPartners.data} onOpen={openResult} />
            )}
            {runs.data && <RunResults runs={runs.data.runs} onOpen={openResult} />}
            <PageResults operator={operator} onOpen={openResult} />
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

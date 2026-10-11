'use client'

import { Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useSession } from '@/hooks/use-session'
import { orderLifecyclesQuery, runsQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { navigationItems, sidebarItems } from '@/lib/navigation'
import { businessReferenceSchema } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@edi-bridge/ui/components/command'
import { Kbd } from '@edi-bridge/ui/components/kbd'
import { Spinner } from '@edi-bridge/ui/components/spinner'

const latestDocuments = { page: 1, pageSize: 50 }

const orderSearchDelay = 300

function subscribeToNothing() {
  return () => {}
}

function useApplePlatform() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  )
}

function orderNumberIn(search: string) {
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

function UnavailableItem({ label, onRetry }: { label: string; onRetry: () => void }) {
  const t = useTranslations('Search')

  return (
    <CommandItem forceMount value={label} onSelect={onRetry}>
      <span className="text-destructive">{label}</span>
      <span className="text-muted-foreground group-data-selected/command-item:text-foreground ml-auto text-xs">
        {t('retry')}
      </span>
    </CommandItem>
  )
}

export function AppSearch() {
  const t = useTranslations()
  const format = useFormatter()
  const router = useRouter()
  const apple = useApplePlatform()
  const { operator } = useSession()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const orderNumber = orderNumberIn(search)
  const settled = useDebouncedValue(orderNumber, orderNumber ?? '', orderSearchDelay)
  const searchedOrderNumber = settled.pending ? undefined : settled.value

  const tradingPartners = useQuery({ ...tradingPartnersQuery, enabled: open })
  const documents = useQuery({ ...runsQuery(latestDocuments), enabled: open })

  const orders = useQuery({
    ...orderLifecyclesQuery(searchedOrderNumber ?? ''),
    enabled: open && searchedOrderNumber !== undefined,
  })

  const ordersLoading = orderNumber !== undefined && (settled.pending || orders.isFetching)
  const ordersFailed = orders.isError && !ordersLoading
  const loading = open && (tradingPartners.isPending || documents.isPending || ordersLoading)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
        setSearch('')
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function changeOpen(next: boolean) {
    setOpen(next)
    setSearch('')
  }

  function go(href: string) {
    changeOpen(false)
    router.push(href)
  }

  const pages = [
    ...sidebarItems.map((item) => ({
      key: item.key,
      href: item.href,
      icon: item.icon,
      label: t(`Sidebar.items.${item.key}.label`),
      hint: t(`Sidebar.items.${item.key}.hint`),
    })),
    {
      key: 'settings',
      href: navigationItems.settings.href,
      icon: navigationItems.settings.icon,
      label: t('Shell.session.settings'),
      hint: '',
    },
    ...(operator
      ? [
          {
            key: 'operator',
            href: navigationItems.operator.href,
            icon: navigationItems.operator.icon,
            label: t('Shell.session.operatorArea'),
            hint: '',
          },
        ]
      : []),
  ]

  return (
    <>
      <Button
        variant="outline"
        aria-keyshortcuts={apple ? 'Meta+K' : 'Control+K'}
        className="text-muted-foreground bg-muted/40 size-10 justify-center gap-2.5 font-normal sm:w-48 sm:justify-start sm:px-3 lg:w-72 xl:w-96"
        onClick={() => changeOpen(true)}>
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} aria-hidden />
        <span className="sr-only truncate text-sm sm:not-sr-only">{t('Search.trigger')}</span>
        <Kbd aria-hidden className="bg-background ml-auto hidden sm:inline-flex">
          {apple ? '⌘K' : 'Ctrl K'}
        </Kbd>
      </Button>
      <CommandDialog
        description={t('Search.description')}
        open={open}
        title={t('Search.title')}
        onOpenChange={changeOpen}>
        <Command filter={matchesAllTerms} label={t('Search.title')}>
          <CommandInput
            placeholder={t('Search.placeholder')}
            value={search}
            onValueChange={setSearch}
          />
          <div
            role="status"
            className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm empty:hidden">
            {loading && (
              <>
                <Spinner role="presentation" aria-hidden />
                {t('Search.loading')}
              </>
            )}
          </div>
          {!loading && <CommandEmpty>{t('Search.empty')}</CommandEmpty>}
          <CommandList>
            {(tradingPartners.isError || documents.isError || ordersFailed) && (
              <CommandGroup forceMount heading={t('Search.groups.unavailable')}>
                {ordersFailed && (
                  <UnavailableItem
                    label={t('Search.unavailable.orders')}
                    onRetry={() => void orders.refetch()}
                  />
                )}
                {tradingPartners.isError && (
                  <UnavailableItem
                    label={t('Search.unavailable.tradingPartners')}
                    onRetry={() => void tradingPartners.refetch()}
                  />
                )}
                {documents.isError && (
                  <UnavailableItem
                    label={t('Search.unavailable.documents')}
                    onRetry={() => void documents.refetch()}
                  />
                )}
              </CommandGroup>
            )}
            {searchedOrderNumber !== undefined && !ordersLoading && orders.data && (
              <CommandGroup forceMount heading={t('Search.groups.orders')}>
                {orders.data.map((lifecycle) => (
                  <CommandItem
                    key={lifecycle.tradingPartner.id}
                    forceMount
                    keywords={[lifecycle.businessReference, lifecycle.tradingPartner.name]}
                    value={`order ${lifecycle.businessReference} ${lifecycle.tradingPartner.id}`}
                    onSelect={() =>
                      go(
                        `/order-lifecycle?${new URLSearchParams({ businessReference: lifecycle.businessReference })}`,
                      )
                    }>
                    {t('Search.order', { businessReference: lifecycle.businessReference })}
                    <span className="text-muted-foreground group-data-selected/command-item:text-foreground ml-auto truncate text-xs">
                      {lifecycle.tradingPartner.name}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {tradingPartners.data && (
              <CommandGroup heading={t('Search.groups.tradingPartners')}>
                {tradingPartners.data.map((tradingPartner) => (
                  <CommandItem
                    key={tradingPartner.id}
                    keywords={[tradingPartner.name, tradingPartner.gln]}
                    value={`trading-partner ${tradingPartner.id}`}
                    onSelect={() => go(`/trading-partners/${tradingPartner.id}`)}>
                    <span className="truncate">{tradingPartner.name}</span>
                    <span className="text-muted-foreground group-data-selected/command-item:text-foreground ml-auto text-xs tabular-nums">
                      {tradingPartner.gln}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {documents.data && (
              <CommandGroup heading={t('Search.groups.documents')}>
                {documents.data.runs.map((document) => (
                  <CommandItem
                    key={document.id}
                    keywords={[
                      document.messageType,
                      document.tradingPartner.name,
                      document.flow.name,
                    ]}
                    value={`document ${document.id}`}
                    onSelect={() => go(`/runs/${document.id}`)}>
                    <span className="font-mono text-xs">{document.messageType}</span>
                    <span className="truncate">{document.tradingPartner.name}</span>
                    <span className="text-muted-foreground group-data-selected/command-item:text-foreground ml-auto shrink-0 text-xs">
                      {format.dateTime(new Date(document.receivedAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={t('Search.groups.pages')}>
              {pages.map((page) => (
                <CommandItem
                  key={page.key}
                  keywords={[page.label, page.hint]}
                  value={`page ${page.key}`}
                  onSelect={() => go(page.href)}>
                  <HugeiconsIcon icon={page.icon} strokeWidth={2} aria-hidden />
                  {page.label}
                  {page.hint && (
                    <span className="text-muted-foreground group-data-selected/command-item:text-foreground ml-auto hidden truncate text-xs sm:inline">
                      {page.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

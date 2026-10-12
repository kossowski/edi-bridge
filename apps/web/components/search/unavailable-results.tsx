import { useTranslations } from 'next-intl'

import { CommandItemHint } from '@/components/search/command-item-hint'
import { CommandGroup, CommandItem } from '@edi-bridge/ui/components/command'

export type SearchFailure = {
  key: 'orders' | 'tradingPartners' | 'documents'
  failed: boolean
  retry: () => void
}

export function UnavailableResults({ failures }: { failures: ReadonlyArray<SearchFailure> }) {
  const t = useTranslations('Search')

  if (!failures.some((failure) => failure.failed)) {
    return null
  }

  return (
    <CommandGroup forceMount heading={t('groups.unavailable')}>
      {failures.flatMap(({ key, failed, retry }) =>
        failed
          ? [
              <CommandItem key={key} forceMount value={`unavailable ${key}`} onSelect={retry}>
                <span className="text-destructive min-w-0 truncate">{t(`unavailable.${key}`)}</span>
                <CommandItemHint>{t('retry')}</CommandItemHint>
              </CommandItem>,
            ]
          : [],
      )}
    </CommandGroup>
  )
}

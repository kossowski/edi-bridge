import { useTranslations } from 'next-intl'

import { CommandItemHint } from '@/components/search/command-item-hint'
import { navigationItems } from '@/lib/navigation'
import { type TradingPartner } from '@edi-bridge/contracts'
import { CommandGroup, CommandItem } from '@edi-bridge/ui/components/command'

export function TradingPartnerResults({
  tradingPartners,
  onOpen,
}: {
  tradingPartners: ReadonlyArray<TradingPartner>
  onOpen: (href: string) => void
}) {
  const t = useTranslations('Search')
  const tPartner = useTranslations('TradingPartner')

  if (tradingPartners.length === 0) {
    return null
  }

  return (
    <CommandGroup heading={t('groups.tradingPartners')}>
      {tradingPartners.map((tradingPartner) => (
        <CommandItem
          key={tradingPartner.id}
          keywords={
            tradingPartner.gln === null
              ? [tradingPartner.name]
              : [tradingPartner.name, tradingPartner.gln]
          }
          value={`trading-partner ${tradingPartner.id}`}
          onSelect={() => onOpen(`${navigationItems.tradingPartners.href}/${tradingPartner.id}`)}>
          <span className="min-w-0 truncate">{tradingPartner.name}</span>
          <CommandItemHint className="tabular-nums">
            {tradingPartner.gln ?? tPartner('noGln')}
          </CommandItemHint>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

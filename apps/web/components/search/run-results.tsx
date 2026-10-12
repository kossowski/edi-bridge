import { useFormatter, useTranslations } from 'next-intl'

import { CommandItemHint } from '@/components/search/command-item-hint'
import { type RunSummary } from '@edi-bridge/contracts'
import { CommandGroup, CommandItem } from '@edi-bridge/ui/components/command'

export function RunResults({
  runs,
  onOpen,
}: {
  runs: ReadonlyArray<RunSummary>
  onOpen: (href: string) => void
}) {
  const t = useTranslations('Search')
  const format = useFormatter()

  if (runs.length === 0) {
    return null
  }

  return (
    <CommandGroup heading={t('groups.documents')}>
      {runs.map((run) => (
        <CommandItem
          key={run.id}
          keywords={[run.messageType, run.tradingPartner.name, run.flow.name]}
          value={`run ${run.id}`}
          onSelect={() => onOpen(`/runs/${run.id}`)}>
          <span className="shrink-0 font-mono text-xs">{run.messageType}</span>
          <span className="min-w-0 truncate">{run.tradingPartner.name}</span>
          <CommandItemHint className="tabular-nums">
            {format.dateTime(new Date(run.receivedAt), { dateStyle: 'short', timeStyle: 'short' })}
          </CommandItemHint>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useId } from 'react'

import { type VersionChoice, versionChoices } from '@/components/documents/mapping-version-choices'
import { mappingVersionsQuery } from '@/lib/api/queries'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'

function useVersionChoiceLabel() {
  const t = useTranslations('Document.actions.versionOption')
  const format = useFormatter()

  return ({ version, labelKey }: VersionChoice) =>
    t(labelKey, {
      version: version.version,
      publishedAt: format.dateTime(new Date(version.publishedAt), { dateStyle: 'medium' }),
    })
}

export function useMappingVersionChoices(mappingId: string | null, usedBeforeId: string | null) {
  const versions = useQuery({
    ...mappingVersionsQuery(mappingId ?? ''),
    enabled: mappingId !== null,
  })

  return {
    choices: versionChoices(versions.data ?? [], usedBeforeId),
    isPending: versions.isPending,
    isError: versions.isError,
  }
}

export function MappingVersionSelect({
  label,
  choices,
  value,
  disabled,
  onValueChange,
}: {
  label: string
  choices: ReadonlyArray<VersionChoice>
  value: string | null
  disabled: boolean
  onValueChange: (value: string) => void
}) {
  const labelId = useId()
  const choiceLabel = useVersionChoiceLabel()

  const items = choices.map((choice) => ({
    value: choice.version.id,
    label: choiceLabel(choice),
  }))

  return (
    <div className="flex w-full max-w-80 min-w-0 flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <Select
        disabled={disabled}
        items={items}
        value={value}
        onValueChange={(next) => next !== null && onValueChange(next)}>
        <SelectTrigger aria-labelledby={labelId} className="w-full min-w-0">
          <SelectValue className="min-w-0">
            {(selected: string | null) => (
              <span className="truncate">
                {items.find((item) => item.value === selected)?.label}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

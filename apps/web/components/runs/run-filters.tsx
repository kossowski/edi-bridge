'use client'

import { FilterRemoveIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import {
  hasActiveFilters,
  manualSubmissionOptions,
  timeRanges,
  useRunFilters,
} from '@/components/runs/run-filters-store'
import { failureStageIcons, runStatusIcons } from '@/components/runs/run-status'
import { flowsQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { failureStages, messageTypes, runStatuses } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { FacetedFilter } from '@edi-bridge/ui/components/faceted-filter'
import { Input } from '@edi-bridge/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'

export function RunFilters() {
  const t = useTranslations('Runs')
  const filters = useRunFilters()
  const { data: tradingPartners = [] } = useQuery(tradingPartnersQuery)
  const { data: flows = [] } = useQuery(flowsQuery)
  const id = useId()

  const visibleFlows =
    filters.tradingPartnerId.length === 0
      ? flows
      : flows.filter((flow) => filters.tradingPartnerId.includes(flow.tradingPartnerId))

  return (
    <search aria-label={t('filters.label')} className="flex flex-wrap items-center gap-2">
      <FacetedFilter
        clearLabel={t('filters.clear')}
        label={t('columns.status')}
        options={runStatuses.map((status) => ({
          value: status,
          label: t(`status.${status}`),
          icon: runStatusIcons[status],
        }))}
        selected={filters.status}
        onSelectedChange={(value) => filters.setFilter('status', value)}
      />
      <FacetedFilter
        clearLabel={t('filters.clear')}
        label={t('columns.failureStage')}
        options={failureStages.map((stage) => ({
          value: stage,
          label: t(`failureStage.${stage}`),
          icon: failureStageIcons[stage],
        }))}
        selected={filters.failureStage}
        onSelectedChange={(value) => filters.setFilter('failureStage', value)}
      />
      <FacetedFilter
        clearLabel={t('filters.clear')}
        label={t('columns.tradingPartner')}
        options={tradingPartners.map(({ id: value, name }) => ({ value, label: name }))}
        selected={filters.tradingPartnerId}
        onSelectedChange={(value) => {
          filters.setFilter('tradingPartnerId', value)
          filters.setFilter(
            'flowId',
            filters.flowId.filter((flowId) =>
              flows.some(
                (flow) =>
                  flow.id === flowId &&
                  (value.length === 0 || value.includes(flow.tradingPartnerId)),
              ),
            ),
          )
        }}
      />
      <FacetedFilter
        clearLabel={t('filters.clear')}
        label={t('columns.messageType')}
        options={messageTypes.map((value) => ({ value, label: value }))}
        selected={filters.messageType}
        onSelectedChange={(value) => filters.setFilter('messageType', value)}
      />
      <FacetedFilter
        clearLabel={t('filters.clear')}
        label={t('columns.flow')}
        options={visibleFlows.map(({ id: value, name }) => ({ value, label: name }))}
        selected={filters.flowId}
        onSelectedChange={(value) => filters.setFilter('flowId', value)}
      />
      <Select
        items={timeRanges.map((value) => ({ value, label: t(`timeRange.${value}`) }))}
        value={filters.timeRange}
        onValueChange={(value) => filters.setTimeRange(value ?? 'any')}>
        <SelectTrigger size="sm" aria-label={t('filters.timeRange')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {timeRanges.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`timeRange.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {filters.timeRange === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-from`} className="flex items-center gap-1.5 text-sm">
            {t('filters.from')}
          </label>
          <Input
            id={`${id}-from`}
            max={filters.customTo || undefined}
            type="date"
            value={filters.customFrom}
            className="h-7 w-auto"
            onChange={(event) => filters.setFilter('customFrom', event.target.value)}
          />
          <label htmlFor={`${id}-to`} className="flex items-center gap-1.5 text-sm">
            {t('filters.to')}
          </label>
          <Input
            id={`${id}-to`}
            min={filters.customFrom || undefined}
            type="date"
            value={filters.customTo}
            className="h-7 w-auto"
            onChange={(event) => filters.setFilter('customTo', event.target.value)}
          />
        </div>
      )}
      <Select
        items={manualSubmissionOptions.map((value) => ({
          value,
          label: t(`manualSubmission.${value}`),
        }))}
        value={filters.manualSubmission}
        onValueChange={(value) => filters.setFilter('manualSubmission', value ?? 'any')}>
        <SelectTrigger size="sm" aria-label={t('filters.manualSubmission')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {manualSubmissionOptions.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`manualSubmission.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasActiveFilters(filters) && (
        <Button size="sm" variant="ghost" onClick={filters.clearFilters}>
          <HugeiconsIcon icon={FilterRemoveIcon} strokeWidth={2} data-icon="inline-start" />
          {t('filters.clearAll')}
        </Button>
      )}
    </search>
  )
}

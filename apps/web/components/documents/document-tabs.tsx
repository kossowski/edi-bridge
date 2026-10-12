'use client'

import { useTranslations } from 'next-intl'

import { DocumentContent } from '@/components/documents/document-content'
import { DocumentSummary } from '@/components/documents/document-summary'
import { TechnicalDetails } from '@/components/documents/technical-details'
import { useUrlTab } from '@/hooks/use-url-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

import type { RunDetail } from '@edi-bridge/contracts'

const documentTabs = [
  { value: 'summary', Panel: DocumentSummary },
  { value: 'content', Panel: DocumentContent },
  { value: 'technical', Panel: TechnicalDetails },
] as const

export function DocumentTabs({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.tabs')
  const [tab, changeTab] = useUrlTab(documentTabs, 'summary')

  return (
    <Tabs value={tab} className="min-w-0" onValueChange={changeTab}>
      <TabsList variant="line" aria-label={t('label')} className="max-w-full overflow-x-auto">
        {documentTabs.map(({ value }) => (
          <TabsTrigger key={value} value={value} className="flex-none">
            {t(value)}
          </TabsTrigger>
        ))}
      </TabsList>
      {documentTabs.map(({ value, Panel }) => (
        <TabsContent key={value} value={value} className="min-w-0 pt-2">
          <Panel run={run} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { MappingComparisonScreen } from '@/components/mappings/mapping-comparison-screen'
import { firstSearchParam } from '@/lib/search-params'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('MappingComparison.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({
  params,
  searchParams,
}: PageProps<'/mappings/[id]/versions/compare'>) {
  const [{ id }, { from, to, sample }] = await Promise.all([params, searchParams])

  return (
    <MappingComparisonScreen
      id={id}
      from={firstSearchParam(from)}
      sample={firstSearchParam(sample)}
      to={firstSearchParam(to)}
    />
  )
}

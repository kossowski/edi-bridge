import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { MappingComparisonScreen } from '@/components/mappings/mapping-comparison-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('MappingComparison.title')} · ${t('Shell.appName')}` } }
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function Page({
  params,
  searchParams,
}: PageProps<'/mappings/[id]/versions/compare'>) {
  const [{ id }, { from, to, sample }] = await Promise.all([params, searchParams])

  return (
    <MappingComparisonScreen id={id} from={first(from)} sample={first(sample)} to={first(to)} />
  )
}

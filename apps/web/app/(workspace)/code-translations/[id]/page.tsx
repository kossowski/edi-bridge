import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { LookupTableScreen } from '@/components/code-translations/lookup-table-screen'
import { firstSearchParam } from '@/lib/search-params'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('CodeTranslation.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params, searchParams }: PageProps<'/code-translations/[id]'>) {
  const [{ id }, { add, code, run }] = await Promise.all([params, searchParams])

  return (
    <LookupTableScreen
      id={id}
      add={firstSearchParam(add)}
      code={firstSearchParam(code)}
      run={firstSearchParam(run)}
    />
  )
}

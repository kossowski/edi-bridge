import { getTranslations } from 'next-intl/server'

import { Empty, EmptyDescription, EmptyHeader } from '@edi-bridge/ui/components/empty'

export default async function NotFound() {
  const t = await getTranslations('NotFound')

  return (
    <div className="flex flex-1 flex-col p-6">
      <Empty>
        <EmptyHeader>
          <h1 className="text-lg font-medium tracking-tight">{t('title')}</h1>
          <EmptyDescription>{t('description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

'use client'

import { PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { buttonVariants } from '@edi-bridge/ui/components/button'

export function EditLink({ href }: { href: string }) {
  const t = useTranslations('Breadcrumb')

  return (
    <Link href={href} className={buttonVariants({ variant: 'outline' })}>
      <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} aria-hidden />
      {t('edit')}
    </Link>
  )
}

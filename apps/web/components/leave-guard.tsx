'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@edi-bridge/ui/components/dialog'

function inAppTarget(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null
  }

  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null

  if (
    !(anchor instanceof HTMLAnchorElement) ||
    (anchor.target !== '' && anchor.target !== '_self') ||
    anchor.hasAttribute('download')
  ) {
    return null
  }

  const url = new URL(anchor.href)

  if (url.origin !== window.location.origin) {
    return null
  }

  return url.pathname === window.location.pathname && url.search === window.location.search
    ? null
    : `${url.pathname}${url.search}${url.hash}`
}

export function LeaveGuard({ when }: { when: boolean }) {
  const t = useTranslations('LeaveGuard')
  const router = useRouter()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    if (!when) {
      return
    }

    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }

    function click(event: MouseEvent) {
      const href = inAppTarget(event)

      if (href !== null) {
        event.preventDefault()
        event.stopPropagation()
        setTarget(href)
      }
    }

    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)

    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
    }
  }, [when])

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('stay')}</DialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              if (target !== null) {
                router.push(target)
              }
            }}>
            {t('leave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

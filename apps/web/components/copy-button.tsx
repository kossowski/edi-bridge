'use client'

import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@edi-bridge/ui/components/button'

type CopyState = 'idle' | 'copied' | 'failed'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('Copy')
  const [state, setState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state !== 'copied') {
      return
    }

    const reset = setTimeout(() => setState('idle'), 2000)

    return () => clearTimeout(reset)
  }, [state])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" type="button" variant="outline" onClick={() => void copy()}>
        <HugeiconsIcon
          icon={state === 'copied' ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          aria-hidden
        />
        {t('button', { label })}
      </Button>
      <span aria-live="polite" className="text-sm">
        {state === 'idle' ? '' : t(state)}
      </span>
    </div>
  )
}

export function CopyableValue({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <code className="bg-muted block min-w-0 rounded-md px-2.5 py-2 font-mono text-sm break-all">
        {value}
      </code>
      <CopyButton label={label} value={value} />
    </div>
  )
}

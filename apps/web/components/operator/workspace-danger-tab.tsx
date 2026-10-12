'use client'

import { useTranslations } from 'next-intl'

import { Fact } from '@/components/detail-parts'
import { SandboxReset } from '@/components/operator/sandbox-reset'
import { WorkspaceLastReset } from '@/components/operator/workspace-values'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

export function WorkspaceDangerTab({ workspace }: { workspace: WorkspaceSummary }) {
  const t = useTranslations('Operator.danger')

  if (workspace.kind !== 'sandbox') {
    return (
      <Card className="border-destructive/40 border">
        <CardHeader>
          <CardTitle>
            <h2>{t('title')}</h2>
          </CardTitle>
          <CardDescription>{t(`unavailable.${workspace.kind}`)}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="border-destructive/40 border">
      <CardHeader>
        <CardTitle>
          <h2>{t('title')}</h2>
        </CardTitle>
        <CardDescription>{t('sandbox')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl>
          <Fact label={t('lastReset')}>
            <WorkspaceLastReset lastResetAt={workspace.lastResetAt} />
          </Fact>
        </dl>
        <div className="flex flex-wrap items-start">
          <SandboxReset workspace={workspace} />
        </div>
      </CardContent>
    </Card>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { HeaderTabs } from '@/components/header-tabs'
import { WorkspaceDangerTab } from '@/components/operator/workspace-danger-tab'
import { WorkspaceInvites } from '@/components/operator/workspace-invites'
import { WorkspaceLimitsTab } from '@/components/operator/workspace-limits-tab'
import { WorkspaceOverviewTab } from '@/components/operator/workspace-overview-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

function MembersAndInvitesTab({ workspace }: { workspace: WorkspaceSummary }) {
  return <WorkspaceInvites workspaceId={workspace.id} />
}

const workspaceTabs = [
  { value: 'overview', Panel: WorkspaceOverviewTab },
  { value: 'members', Panel: MembersAndInvitesTab },
  { value: 'limits', Panel: WorkspaceLimitsTab },
  { value: 'danger', Panel: WorkspaceDangerTab },
] as const

type WorkspaceTab = (typeof workspaceTabs)[number]['value']

function workspaceTabOf(value: string | null): WorkspaceTab {
  return workspaceTabs.find((tab) => tab.value === value)?.value ?? 'overview'
}

export function WorkspaceTabs({ workspace }: { workspace: WorkspaceSummary }) {
  const t = useTranslations('Operator.workspace.tabs')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = workspaceTabOf(searchParams.get('tab'))

  function changeTab(value: string) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', workspaceTabOf(value))
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={changeTab}>
      <HeaderTabs>
        <TabsList variant="line">
          {workspaceTabs.map(({ value }) => (
            <TabsTrigger key={value} value={value}>
              {t(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </HeaderTabs>
      {workspaceTabs.map(({ value, Panel }) => (
        <TabsContent
          key={value}
          value={value}
          className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <Panel workspace={workspace} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

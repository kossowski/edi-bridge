'use client'

import type { ReactElement, ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@edi-bridge/ui/components/tooltip'

// Below 90rem, where the names no longer fit beside the state badges, the editor's toolbar shows
// its actions as icons, so it keeps to one row; the name stays for screen readers and in a tooltip.
export function ToolbarAction({
  label,
  icon,
  render,
}: {
  label: ReactNode
  icon: ReactNode
  render: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={render} className="lg:max-[90rem]:w-8 lg:max-[90rem]:px-0">
        {icon}
        <span className="lg:max-[90rem]:sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-lg:hidden min-[90rem]:hidden">{label}</TooltipContent>
    </Tooltip>
  )
}

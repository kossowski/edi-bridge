'use client'

import { Delete02Icon, ViewIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'

import {
  type LinkMenuAt,
  useCanvasStore,
  useCanvasViewOnly,
} from '@/components/mappings/mapping-canvas-store'
import { useRemoveText } from '@/components/mappings/use-remove-text'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@edi-bridge/ui/components/dropdown-menu'

import type { LinkEdgeData, PlainEdgeData } from '@/components/mappings/link-edge'
import type { RowRef } from '@/components/mappings/mapping-links'

export type LinkMenuEnd =
  { kind: 'row'; row: RowRef } | { kind: 'transform'; transformId: string; name: string }

export type LinkMenuTarget = {
  data: LinkEdgeData
  ends: ReadonlyArray<LinkMenuEnd>
  element: () => HTMLElement | null
}

export type LinkMenuActions = {
  showLinks: (edge: PlainEdgeData) => void
  showRow: (row: RowRef) => void
  showTransform: (transformId: string) => void
  remove: (data: LinkEdgeData, focused: boolean) => void
}

function names(data: LinkEdgeData) {
  if (data.kind === 'transformLink') {
    return { source: data.source, target: data.target }
  }

  const [only] = data.links

  return data.links.length === 1 && only
    ? { source: only.sourcePath, target: only.targetPath }
    : { source: data.sourcePath, target: data.targetPath }
}

export function LinkMenu({
  target,
  actions,
}: {
  target: LinkMenuTarget | null
  actions: LinkMenuActions
}) {
  const t = useTranslations('Mapping.links.menu')
  const removeText = useRemoveText()
  const viewOnly = useCanvasViewOnly()
  const at = useCanvasStore((state) => state.linkMenu)
  const open = useCanvasStore((state) => state.linkMenuOpen)
  const closeLinkMenu = useCanvasStore((state) => state.closeLinkMenu)
  const actedOn = useRef<LinkMenuAt | null>(null)

  if (!target || !at) {
    return null
  }

  const { data, ends } = target
  const merged = data.kind === 'link' && data.links.length > 1 ? data : null
  const { source, target: end } = names(data)

  const act = (action: () => void) => {
    actedOn.current = at
    action()
  }

  const title = () => {
    if (merged) {
      return t('links', { count: merged.links.length })
    }

    return data.aiProposed ? t('proposedLink') : t('link')
  }

  const showEnd = (menuEnd: LinkMenuEnd) => {
    if (menuEnd.kind === 'transform') {
      return t('showTransform', { name: menuEnd.name })
    }

    return menuEnd.row.side === 'source'
      ? t('showSource', { name: menuEnd.row.path })
      : t('showTarget', { name: menuEnd.row.path })
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          closeLinkMenu()
        }
      }}>
      <DropdownMenuContent
        anchor={{
          getBoundingClientRect: () => DOMRect.fromRect({ x: at.at.x, y: at.at.y }),
        }}
        // A link is an SVG element, which the menu does not take the focus back to by itself.
        finalFocus={() => {
          if (at.focused && actedOn.current !== at) {
            target.element()?.focus()
          }

          return false
        }}
        className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span>{title()}</span>
            <span className="text-foreground font-mono font-normal [overflow-wrap:anywhere]">
              {t('names', { source, target: end })}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {merged && (
          <DropdownMenuItem onClick={() => act(() => actions.showLinks(merged))}>
            <HugeiconsIcon icon={ViewIcon} strokeWidth={2} aria-hidden />
            {t('showLinks', { count: merged.links.length })}
          </DropdownMenuItem>
        )}
        {ends.map((menuEnd) => (
          <DropdownMenuItem
            key={
              menuEnd.kind === 'row'
                ? `${menuEnd.row.side}:${menuEnd.row.path}`
                : menuEnd.transformId
            }
            onClick={() =>
              act(() =>
                menuEnd.kind === 'row'
                  ? actions.showRow(menuEnd.row)
                  : actions.showTransform(menuEnd.transformId),
              )
            }>
            <HugeiconsIcon icon={ViewIcon} strokeWidth={2} aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">{showEnd(menuEnd)}</span>
          </DropdownMenuItem>
        ))}
        {!merged && !viewOnly && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => act(() => actions.remove(data, at.focused))}>
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
              {removeText.link(data.aiProposed)}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

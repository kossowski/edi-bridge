'use client'

import { CheckmarkCircle02Icon, Delete02Icon, ViewIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'
import { toast } from 'sonner'

import { singleLink } from '@/components/mappings/link-edge'
import {
  type LinkMenuAnchor,
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
import type { AiAccept } from '@/components/mappings/use-ai-accept'

export type LinkMenuEnd =
  { kind: 'row'; row: RowRef } | { kind: 'transform'; transformId: string; name: string }

export type LinkMenuTarget = {
  data: LinkEdgeData
  ends: ReadonlyArray<LinkMenuEnd>
  element: () => SVGElement | null
}

export type LinkMenuActions = {
  showLinks: (edge: PlainEdgeData) => void
  showRow: (row: RowRef) => void
  showTransform: (transformId: string) => void
  remove: (data: LinkEdgeData, linkFocused: boolean) => void
}

function names(data: LinkEdgeData) {
  if (data.kind === 'transformLink') {
    return { source: data.source, target: data.target }
  }

  const single = singleLink(data)
  const shown = single?.kind === 'link' ? single.link : data

  return { source: shown.sourcePath, target: shown.targetPath }
}

export function LinkMenu({
  target,
  actions,
  aiAccept,
}: {
  target: LinkMenuTarget | null
  actions: LinkMenuActions
  aiAccept: AiAccept | undefined
}) {
  const t = useTranslations('Mapping.links.menu')
  const tAi = useTranslations('Mapping.aiReview')
  const removeText = useRemoveText()
  const viewOnly = useCanvasViewOnly()
  const anchor = useCanvasStore((state) => state.linkMenu)
  const open = useCanvasStore((state) => state.linkMenuOpen)
  const closeLinkMenu = useCanvasStore((state) => state.closeLinkMenu)
  const actedOn = useRef<LinkMenuAnchor | null>(null)

  if (!target || !anchor) {
    return null
  }

  const { data, ends } = target
  const single = singleLink(data)
  const merged = data.kind === 'link' && !single ? data : null
  const acceptParts = !viewOnly && single && aiAccept ? aiAccept.partsOf(single) : null

  const act = (action: () => void) => {
    actedOn.current = anchor
    action()
  }

  const title = () => {
    if (merged) {
      return t('links', { count: merged.links.length })
    }

    return data.aiProposed ? tAi('proposedLink') : t('link')
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
          getBoundingClientRect: () => DOMRect.fromRect(anchor.point),
        }}
        // A link is an SVG element, which the menu does not take the focus back to by itself.
        finalFocus={() => {
          if (anchor.linkFocused && actedOn.current !== anchor) {
            target.element()?.focus()
          }

          return false
        }}
        className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span>{title()}</span>
            <span className="text-foreground font-mono font-normal [overflow-wrap:anywhere]">
              {t('names', names(data))}
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
            {acceptParts && aiAccept && (
              // Accepting keeps the link, so the menu hands the focus back to it.
              <DropdownMenuItem
                disabled={aiAccept.pending}
                onClick={() =>
                  aiAccept.accept(acceptParts, {
                    onSuccess: () =>
                      toast.success(
                        tAi(acceptParts.links.length > 0 ? 'acceptedLink' : 'acceptedChain'),
                      ),
                    onError: () => toast.error(tAi('acceptPartsFailed')),
                  })
                }>
                <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} aria-hidden />
                {tAi(acceptParts.links.length > 0 ? 'acceptLink' : 'acceptChain')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => act(() => actions.remove(data, anchor.linkFocused))}>
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
              {removeText.link(data.aiProposed)}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

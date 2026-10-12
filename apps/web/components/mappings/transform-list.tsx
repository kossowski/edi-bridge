'use client'

import {
  Calendar03Icon,
  CodeIcon,
  CropIcon,
  DragDropVerticalIcon,
  GitBranchIcon,
  HashtagIcon,
  Link01Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RepeatIcon,
  ScissorIcon,
  Table01Icon,
  TextIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { type DragEvent, useId, useRef } from 'react'

import { useStoredFlag } from '@/hooks/use-stored-flag'
import { type TransformKind, transformKinds } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@edi-bridge/ui/components/tooltip'

export const transformDragType = 'application/x-edi-bridge-transform'

export function draggedTransform(event: DragEvent) {
  const kind = event.dataTransfer.getData(transformDragType)

  return transformKinds.find((known) => known === kind)
}

const transformIcons: Record<TransformKind, IconSvgElement> = {
  constant: TextIcon,
  concatenate: Link01Icon,
  split: ScissorIcon,
  substring: CropIcon,
  dateFormat: Calendar03Icon,
  numberFormat: HashtagIcon,
  lookupTable: Table01Icon,
  conditional: GitBranchIcon,
  loop: RepeatIcon,
  jsonata: CodeIcon,
}

export const transformsHiddenKey = 'edi-bridge:mapping-editor:transforms-hidden'

function TransformItem({
  kind,
  rail,
  onPlace,
}: {
  kind: TransformKind
  rail: boolean
  onPlace: (kind: TransformKind) => void
}) {
  const t = useTranslations('Mapping.transforms')
  const descriptionId = useId()
  const name = t(`kinds.${kind}`)
  const icon = <HugeiconsIcon icon={transformIcons[kind]} strokeWidth={2} aria-hidden />

  const place = {
    draggable: true,
    'aria-label': t('palette.add', { kind: name }),
    'data-place': kind,
    onClick: () => onPlace(kind),
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(transformDragType, kind)
      event.dataTransfer.effectAllowed = 'copy'
    },
  }

  if (rail) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                className="cursor-grab active:cursor-grabbing"
                {...place}
              />
            }>
            {icon}
          </TooltipTrigger>
          <TooltipContent side="right">{name}</TooltipContent>
        </Tooltip>
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-0.5 rounded-md px-1 py-1">
      <button
        type="button"
        aria-describedby={descriptionId}
        className="group/place hover:bg-muted focus-visible:ring-ring/50 flex min-h-8 w-full cursor-grab items-center gap-2.5 rounded-md px-1 text-start text-sm font-medium outline-none focus-visible:ring-3 active:cursor-grabbing"
        {...place}>
        <span className="bg-muted group-hover/place:bg-background flex size-7 shrink-0 items-center justify-center rounded-md border">
          {icon}
        </span>
        <span className="min-w-0 flex-1">{name}</span>
        <HugeiconsIcon
          icon={DragDropVerticalIcon}
          strokeWidth={2}
          aria-hidden
          className="text-muted-foreground size-4 shrink-0 opacity-0 group-hover/place:opacity-100 group-focus-visible/place:opacity-100"
        />
      </button>
      <p id={descriptionId} className="text-muted-foreground line-clamp-2 ps-11 pe-1 text-xs">
        {t(`descriptions.${kind}`)}
      </p>
    </li>
  )
}

export function TransformList({ onPlace }: { onPlace: (kind: TransformKind) => void }) {
  const t = useTranslations('Mapping.transforms')
  const heading = useId()
  const note = useId()
  const [hidden, setHidden] = useStoredFlag(transformsHiddenKey)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const toggleLabel = hidden ? t('palette.show') : t('palette.hide')

  // The toggle moves between the list and the rail, and the focus goes with it.
  const onToggle = () => {
    setHidden(!hidden)
    requestAnimationFrame(() => toggleRef.current?.focus())
  }

  const toggle = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={toggleRef}
            size="icon-sm"
            variant="ghost"
            aria-expanded={!hidden}
            aria-label={toggleLabel}
            onClick={onToggle}
          />
        }>
        <HugeiconsIcon
          icon={hidden ? PanelLeftOpenIcon : PanelLeftCloseIcon}
          strokeWidth={2}
          aria-hidden
        />
      </TooltipTrigger>
      <TooltipContent side="right">{toggleLabel}</TooltipContent>
    </Tooltip>
  )

  if (hidden) {
    return (
      <section
        aria-describedby={note}
        aria-labelledby={heading}
        className="bg-card flex w-12 shrink-0 flex-col items-center gap-1 border-e py-1.5">
        <h2 id={heading} className="sr-only">
          {t('palette.heading')}
        </h2>
        <p id={note} className="sr-only">
          {t('palette.hint')} {t('palette.note')}
        </p>
        {toggle}
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto border-t pt-1.5">
          {transformKinds.map((kind) => (
            <TransformItem key={kind} kind={kind} rail onPlace={onPlace} />
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section
      aria-describedby={note}
      aria-labelledby={heading}
      className="bg-card flex w-64 shrink-0 flex-col border-e">
      <div className="flex items-start gap-2 border-b py-2 ps-3 pe-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={heading} className="text-sm font-semibold">
            {t('palette.heading')}
          </h2>
          <p className="text-muted-foreground text-xs">{t('palette.hint')}</p>
        </div>
        {toggle}
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {transformKinds.map((kind) => (
          <TransformItem key={kind} kind={kind} rail={false} onPlace={onPlace} />
        ))}
      </ul>
      <p id={note} className="text-muted-foreground border-t px-3 py-2 text-xs">
        {t('palette.note')}
      </p>
    </section>
  )
}

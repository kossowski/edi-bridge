'use client'

import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'

import { Badge } from './badge'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'

export type FacetedFilterOption<Value extends string> = {
  value: Value
  label: string
  icon?: IconSvgElement
}

export function FacetedFilter<Value extends string>({
  label,
  options,
  selected,
  onSelectedChange,
  clearLabel,
}: {
  label: string
  options: ReadonlyArray<FacetedFilterOption<Value>>
  selected: ReadonlyArray<Value>
  onSelectedChange: (selected: Value[]) => void
  clearLabel: string
}) {
  function toggle(value: Value, checked: boolean) {
    onSelectedChange(
      checked ? [...selected, value] : selected.filter((selectedValue) => selectedValue !== value),
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
        {label}
        {selected.length > 0 && <Badge variant="secondary">{selected.length}</Badge>}
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              onCheckedChange={(checked) => toggle(option.value, checked)}>
              {option.icon && <HugeiconsIcon icon={option.icon} strokeWidth={2} />}
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSelectedChange([])}>{clearLabel}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

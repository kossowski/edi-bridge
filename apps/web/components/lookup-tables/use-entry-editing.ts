'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'

import {
  type EntryField,
  type EntryRow,
  type RowErrors,
  sameEntries,
  toRows,
  validateEntries,
} from '@/components/lookup-tables/lookup-table-entries'
import { toScopeInput } from '@/components/lookup-tables/lookup-table-scope'
import { updateLookupTable } from '@/lib/api/client'
import { lookupTableQuery, storeSavedLookupTable } from '@/lib/api/queries'

import type { LookupTable, LookupTableEntry } from '@edi-bridge/contracts'

export type InvalidCell = { key: number; field: EntryField }

function without(keys: ReadonlySet<number>, key: number) {
  const next = new Set(keys)
  next.delete(key)

  return next
}

function withoutRequired(errors: RowErrors): RowErrors {
  return Object.fromEntries(Object.entries(errors).filter(([, error]) => error.kind !== 'required'))
}

function useSaveEntries(table: LookupTable, onSaved: (saved: LookupTable) => void) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (entries: LookupTableEntry[]) => {
      const current = queryClient.getQueryData(lookupTableQuery(table.id).queryKey) ?? table

      return updateLookupTable(table.id, {
        name: current.name,
        kind: current.kind,
        scope: toScopeInput(current.scope),
        entries,
      })
    },
    onSuccess: (saved) => {
      storeSavedLookupTable(queryClient, saved)
      onSaved(saved)
    },
  })
}

export function useEntryEditing(table: LookupTable, { onSaved }: { onSaved: () => void }) {
  const [baseline, setBaseline] = useState<ReadonlyArray<LookupTableEntry>>(table.entries)
  const [rows, setRows] = useState<EntryRow[]>(() => toRows(table.entries))
  const nextKey = useRef(table.entries.length)
  const [untouchedNewRows, setUntouchedNewRows] = useState<ReadonlySet<number>>(() => new Set())
  const [attempted, setAttempted] = useState(false)

  const save = useSaveEntries(table, (saved) => {
    setBaseline(saved.entries)
    setRows((current) =>
      current.length === saved.entries.length
        ? current.map((row, index) => ({ ...row, ...saved.entries[index] }))
        : current,
    )
    setAttempted(false)
    onSaved()
  })

  const saving = save.isPending
  const validation = useMemo(() => validateEntries(rows), [rows])
  const dirty = useMemo(() => !sameEntries(rows, baseline), [rows, baseline])

  const errors = useMemo(() => {
    const visible = new Map<number, RowErrors>()

    if ('errors' in validation) {
      for (const [index, rowErrors] of validation.errors) {
        const shownErrors = untouchedNewRows.has(rows[index]?.key ?? -1)
          ? withoutRequired(rowErrors)
          : rowErrors

        if (shownErrors.sourceCode || shownErrors.targetCode) {
          visible.set(index, shownErrors)
        }
      }
    }

    return visible
  }, [validation, untouchedNewRows, rows])

  function updateRow(key: number, field: EntryField, value: string) {
    if (saving) {
      return
    }

    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
  }

  function markTouched(key: number) {
    setUntouchedNewRows((current) => (current.has(key) ? without(current, key) : current))
  }

  function insertRow(afterKey: number | undefined, touchedKey: number | undefined) {
    const key = nextKey.current++
    const afterIndex = rows.findIndex((row) => row.key === afterKey)
    const index = afterKey === undefined || afterIndex < 0 ? rows.length : afterIndex + 1

    setRows((current) => [
      ...current.slice(0, index),
      { key, sourceCode: '', targetCode: '' },
      ...current.slice(index),
    ])
    setUntouchedNewRows((current) => new Set(without(current, touchedKey ?? -1)).add(key))

    return { key, index }
  }

  function removeRow(key: number) {
    const index = rows.findIndex((row) => row.key === key)

    setRows((current) => current.filter((row) => row.key !== key))
    setUntouchedNewRows((current) => without(current, key))

    return index
  }

  function load(entries: ReadonlyArray<LookupTableEntry>) {
    setBaseline(entries)
    setRows(toRows(entries, nextKey.current))
    nextKey.current += entries.length
    setUntouchedNewRows(new Set())
    setAttempted(false)
    save.reset()
  }

  function discard() {
    load(baseline)
  }

  function submit(): InvalidCell | null {
    setUntouchedNewRows(new Set())
    setAttempted(true)

    if ('errors' in validation) {
      const index = Math.min(...validation.errors.keys())

      return {
        key: rows[index]!.key,
        field: validation.errors.get(index)!.sourceCode ? 'sourceCode' : 'targetCode',
      }
    }

    if (dirty && !saving) {
      save.mutate(validation.entries)
    }

    return null
  }

  return {
    rows,
    dirty,
    saving,
    saveFailed: save.isError,
    errors,
    errorCount: attempted && 'errors' in validation ? validation.errors.size : 0,
    updateRow,
    markTouched,
    insertRow,
    removeRow,
    load,
    discard,
    submit,
  }
}

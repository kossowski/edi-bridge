'use client'

import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import {
  type CanvasIssue,
  type Connected,
  type GraphChange,
  transformNames,
} from '@/components/mappings/mapping-graph'
import { isField, isRanged } from '@/components/mappings/transform-kinds'

import type { RowRef } from '@/components/mappings/mapping-links'
import type {
  LinkEnd,
  LinkStart,
  LookupTableSummary,
  MappingTransform,
  TransformKind,
} from '@edi-bridge/contracts'

const inputPorts = ['value', 'then', 'else', 'items'] as const

const outputPorts = ['value', 'items', 'counter'] as const

function known<Name extends string>(names: ReadonlyArray<Name>, name: string): name is Name {
  return names.some((candidate) => candidate === name)
}

export type GraphText = ReturnType<typeof useGraphText>

export type FailedLink = Exclude<Connected, { ok: true }>

// A refusal the user caused by pointing at a taken or circular end stays as a problem; one that
// only explains what cannot be linked is announced.
export type FailedLinkText = { text: string; problem: boolean }

export function useGraphText(
  transforms: ReadonlyArray<MappingTransform>,
  lookupTables?: ReadonlyArray<LookupTableSummary>,
) {
  const t = useTranslations('Mapping.transforms')
  const tLinks = useTranslations('Mapping.links')

  return useMemo(() => {
    const names = transformNames(transforms)

    const kind = (value: TransformKind) => t(`kinds.${value}`)

    const name = (id: string) => {
      const found = names.get(id)

      return found ? t('name', { kind: kind(found.kind), number: found.number }) : id
    }

    const input = (port: string) => {
      const part = /^part(\d+)$/.exec(port)

      if (part) {
        return t('inputs.part', { number: Number(part[1]) })
      }

      return known(inputPorts, port) ? t(`inputs.${port}`) : port
    }

    const output = (port: string) => (known(outputPorts, port) ? t(`outputs.${port}`) : port)

    const start = (from: LinkStart) =>
      from.kind === 'source'
        ? from.path
        : t('port', { transform: name(from.transformId), port: output(from.output) })

    const end = (to: LinkEnd) =>
      to.kind === 'target'
        ? to.path
        : t('port', { transform: name(to.transformId), port: input(to.input) })

    // SAFETY: `transformKindFields` lists exactly the keys under `fields.<kind>` in the messages.
    const field = (transformKind: TransformKind, value: string) =>
      isField(transformKind, value) ? t(`fields.${transformKind}.${value}` as never) : value

    // SAFETY: its `ranged` fields are exactly the keys under `ranges.<kind>` in the messages.
    const range = (transformKind: TransformKind, value: string) =>
      isRanged(transformKind, value) ? t(`ranges.${transformKind}.${value}` as never) : null

    const issue = (transformKind: TransformKind, found: CanvasIssue) => {
      if (found.code === 'unconnected') {
        return t('issues.unconnected', { input: input(found.input) })
      }

      if (found.code === 'unknownLookupTable') {
        return t('issues.unknownLookupTable')
      }

      if (found.code === 'outsideLoop') {
        return t('issues.outsideLoop', { source: found.source, target: found.target })
      }

      if (found.field === '') {
        return t('issues.invalidConfig')
      }

      const label = field(transformKind, found.field)

      if (found.code === 'outOfRange') {
        const allowed = range(transformKind, found.field)

        return allowed
          ? t('issues.outOfRange', { field: label, range: allowed })
          : t('issues.outOfRangePlain', { field: label })
      }

      return t(`issues.${found.code}`, { field: label })
    }

    const change = (graphChange: GraphChange) => {
      switch (graphChange.kind) {
        case 'addLink':
        case 'removeLink': {
          const names = {
            source: graphChange.link.sourcePath,
            target: graphChange.link.targetPath,
          }

          return graphChange.kind === 'addLink'
            ? { saved: tLinks('added', names), failed: tLinks('addFailed', names) }
            : { saved: tLinks('removed', names), failed: tLinks('removeFailed', names) }
        }

        case 'addTransformLink':
        case 'removeTransformLink': {
          const names = { source: start(graphChange.link.from), target: end(graphChange.link.to) }

          return graphChange.kind === 'addTransformLink'
            ? { saved: tLinks('added', names), failed: tLinks('addFailed', names) }
            : { saved: tLinks('removed', names), failed: tLinks('removeFailed', names) }
        }

        case 'addTransform': {
          const added = t('name', {
            kind: kind(graphChange.transform.kind),
            number:
              transforms.filter((other) => other.kind === graphChange.transform.kind).length + 1,
          })

          return { saved: t('added', { name: added }), failed: t('addFailed', { name: added }) }
        }

        case 'removeTransform': {
          const removed = name(graphChange.transform.id)

          return {
            saved: t('removed', { name: removed }),
            failed: t('removeFailed', { name: removed }),
          }
        }

        case 'configureTransform': {
          const configured = name(graphChange.before.id)

          return {
            saved: t('configured', { name: configured, dropped: graphChange.dropped.length }),
            failed: t('configureFailed', { name: configured }),
          }
        }

        case 'moveTransform': {
          const moved = name(graphChange.before.id)

          return { saved: t('moved', { name: moved }), failed: t('moveFailed', { name: moved }) }
        }
      }
    }

    const failedLink = (
      failed: FailedLink,
      from: LinkStart,
      to: LinkEnd,
      label: (row: RowRef) => string,
    ): FailedLinkText | null => {
      switch (failed.reason) {
        case 'alreadyLinked':
          return {
            text: tLinks('alreadyLinked', { target: end(to), source: start(failed.existing) }),
            problem: true,
          }
        case 'inputTaken':
          return {
            text: t('inputTaken', { input: end(to), source: start(failed.existing) }),
            problem: true,
          }
        case 'circle':
          return {
            text: t('circle', {
              source: from.kind === 'transform' ? name(from.transformId) : start(from),
              target: to.kind === 'transform' ? name(to.transformId) : end(to),
            }),
            problem: true,
          }
        case 'needsPart':
          return {
            text: t('needsPart', { port: failed.end === 'to' ? end(to) : start(from) }),
            problem: false,
          }
        case 'needsLoop':
        case 'notLinkable': {
          const row: RowRef | null =
            failed.end === 'to'
              ? to.kind === 'target'
                ? { side: 'target', path: to.path }
                : null
              : from.kind === 'source'
                ? { side: 'source', path: from.path }
                : null

          return (
            row && {
              text:
                failed.reason === 'needsLoop'
                  ? tLinks('needsLoop', { label: label(row) })
                  : tLinks('notLinkable', { label: label(row) }),
              problem: false,
            }
          )
        }
      }
    }

    const summary = (transform: MappingTransform) => {
      switch (transform.kind) {
        case 'constant':
          return transform.config.value === ''
            ? t('summary.constantEmpty')
            : t('summary.constant', { value: transform.config.value })
        case 'concatenate':
          return t('summary.concatenate', {
            count: transform.config.inputCount,
            separator: transform.config.separator,
          })
        case 'split':
          return t('summary.split', transform.config)
        case 'substring':
          return t('summary.substring', {
            start: transform.config.start,
            length: transform.config.length === null ? 'all' : String(transform.config.length),
          })
        case 'dateFormat':
          return t('summary.dateFormat', transform.config)
        case 'numberFormat':
          return t('summary.numberFormat', {
            places:
              transform.config.decimalPlaces === null
                ? 'keep'
                : String(transform.config.decimalPlaces),
            separator: transform.config.decimalSeparator,
          })
        case 'lookupTable': {
          const { lookupTableId } = transform.config

          if (lookupTableId === null) {
            return t('summary.lookupTableNone')
          }

          const chosen = lookupTables?.find(({ id }) => id === lookupTableId)

          if (chosen) {
            return chosen.name
          }

          return lookupTables ? t('summary.lookupTableMissing') : t('summary.lookupTableChosen')
        }

        case 'conditional':
          return t('summary.conditional', {
            operator: t(`operators.${transform.config.operator}`, {
              compareTo: transform.config.compareTo,
            }),
          })
        case 'loop':
          return t('summary.loop', { start: transform.config.counterStart })
        case 'jsonata':
          return t('summary.jsonata', transform.config)
      }
    }

    return { kind, name, input, output, start, end, field, issue, change, failedLink, summary }
  }, [lookupTables, t, tLinks, transforms])
}

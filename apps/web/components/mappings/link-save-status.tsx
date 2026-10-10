'use client'

import { useTranslations } from 'next-intl'

import { useCanvasStore } from '@/components/mappings/mapping-canvas-store'
import { useLinkSaveState } from '@/components/mappings/use-save-links'

const labels = { saving: 'saving', saved: 'saved', failed: 'saveFailed' } as const

// Rendered beside the page title, outside the canvas, so it reads the store and not its props.
export function LinkSaveStatus({ mappingId }: { mappingId: string }) {
  const t = useTranslations('Mapping.links')
  const saveState = useLinkSaveState(mappingId)
  const problem = useCanvasStore((state) => state.problem)
  const announcement = useCanvasStore((state) => state.announcement)

  return (
    <>
      {saveState && <span className="text-muted-foreground text-sm">{t(labels[saveState])}</span>}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {/* Its line stays reserved: a problem that comes or goes during a drag would otherwise move
          the canvas under the pointer, and React Flow measures the pane only when the drag starts. */}
      <p role="alert" className="min-h-5 basis-full text-sm text-red-800 dark:text-red-300">
        {problem}
      </p>
    </>
  )
}

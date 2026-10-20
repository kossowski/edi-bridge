import type { LiveEvent } from '@edi-bridge/contracts'

type Listener = (event: LiveEvent) => void

export type LiveEventBus = {
  publish: (event: LiveEvent) => void
  subscribe: (listener: Listener) => () => void
}

export function createLiveEventBus(): LiveEventBus {
  const listeners = new Set<Listener>()

  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event)
      }
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}

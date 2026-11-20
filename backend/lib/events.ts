import type { ServerEvent } from '../../shared/types'

type Sink = (ev: ServerEvent) => void
const sinks = new Set<Sink>()

export function subscribe(sink: Sink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

export function emit(ev: ServerEvent): void {
  for (const s of sinks) {
    try {
      s(ev)
    } catch {
      /* a broken socket must not break the emitter */
    }
  }
}

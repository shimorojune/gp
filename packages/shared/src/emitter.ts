type Listener<T> = (payload: T) => void

/** Minimal typed event emitter. Keys of `Events` are event names, values are payload types. */
export class TypedEmitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {}

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners[event]
    if (!set) {
      set = new Set()
      this.listeners[event] = set
    }
    set.add(listener)
    return () => this.off(event, listener)
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners[event]?.delete(listener)
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners[event]
    if (!set) return
    for (const listener of set) listener(payload)
  }
}

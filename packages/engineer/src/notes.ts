import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type NoteCategory = 'driving' | 'setup' | 'radio' | 'strategy' | 'personal' | 'track'

export interface Note {
  id: string
  category: NoteCategory
  /** Track name for category 'track', otherwise null. */
  track: string | null
  text: string
  /** 'driver' = Rohit said it. 'engineer' = inferred from data or conversation. */
  source: 'driver' | 'engineer'
  createdAt: string
  updatedAt: string
}

/**
 * The engineer's long-term memory about the driver: preferences, habits, running jokes.
 * Plain JSON on disk so it's easy to read and hand-edit. Small by design (tens to low
 * hundreds of notes); Phase 7 adds an end-of-session curation pass.
 */
export class NotesStore {
  private notes: Note[] = []

  constructor(private readonly path: string) {
    try {
      this.notes = JSON.parse(readFileSync(path, 'utf8')) as Note[]
    } catch {
      this.notes = []
    }
  }

  all(): Note[] {
    return [...this.notes]
  }

  /** Global notes plus notes for this track. */
  relevant(track: string | null): Note[] {
    return this.notes.filter(
      (n) =>
        n.category !== 'track' ||
        (track !== null && n.track?.toLowerCase() === track.toLowerCase()),
    )
  }

  add(input: Pick<Note, 'category' | 'text' | 'source'> & { track?: string | null }): Note {
    const now = new Date().toISOString()
    const note: Note = {
      id: Math.random().toString(36).slice(2, 10),
      category: input.category,
      track: input.track ?? null,
      text: input.text.trim(),
      source: input.source,
      createdAt: now,
      updatedAt: now,
    }
    this.notes.push(note)
    this.save()
    return note
  }

  remove(id: string): boolean {
    const before = this.notes.length
    this.notes = this.notes.filter((n) => n.id !== id)
    if (this.notes.length !== before) this.save()
    return this.notes.length !== before
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.notes, null, 2))
    renameSync(tmp, this.path)
  }
}

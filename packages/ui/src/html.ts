/** Tiny helpers for building markup as strings, the way the renderer already works. */

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape text for HTML content or attribute values. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]!)
}

/** Join class names, skipping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Markup that is already safe. Pass it where a helper accepts `Html` to skip escaping. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value
  }
}
export const raw = (s: string) => new Html(s)

/** Escape unless already Html. */
export function content(v: string | number | Html | null | undefined): string {
  return v instanceof Html ? v.value : esc(v)
}

// Replaces third-party names (configured by parents) with neutral placeholders
// before text is sent to the AI provider, and restores them in the response.

export interface RedactionTerm {
  term: string;
  replacement: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// UK-style phone numbers (landlines, mobiles, +44)
const PHONE_RE = /(?:\+44\s?\(?0?\)?\s?|\b0)(?:\d[\s-]?){9,10}\b/g;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Redactor {
  private terms: RedactionTerm[];
  constructor(terms: RedactionTerm[], private stripContacts: boolean) {
    // Longest first so "Ms Jane Smith" is replaced before "Jane".
    this.terms = [...terms].filter((t) => t.term.trim()).sort((a, b) => b.term.length - a.term.length);
  }

  redact(text: string): string {
    let out = text;
    if (this.stripContacts) {
      out = out.replace(EMAIL_RE, "[email address removed]").replace(PHONE_RE, "[phone number removed]");
    }
    for (const t of this.terms) {
      out = out.replace(new RegExp(`\\b${escapeRe(t.term.trim())}\\b`, "gi"), t.replacement);
    }
    return out;
  }

  restore(text: string): string {
    let out = text;
    for (const t of this.terms) {
      out = out.split(t.replacement).join(t.term.trim());
    }
    return out;
  }

  restoreDeep<T>(value: T): T {
    if (typeof value === "string") return this.restore(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.restoreDeep(v)) as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.restoreDeep(v);
      return out as T;
    }
    return value;
  }
}

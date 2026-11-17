// Keeps an unsent draft in this browser only, so a half-written note isn't
// lost by navigating away. Never used for anything that must persist.
const KEY = "sammy:draft";

export interface Draft { text: string; title: string; date: string }

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft) {
  try {
    if (d.text.trim() || d.title.trim()) localStorage.setItem(KEY, JSON.stringify(d));
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}

export function clearDraft() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

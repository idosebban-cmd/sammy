import type { EntryKind } from "./types";

/** Guesses what kind of thing was pasted or typed, so parents rarely need to choose. */
export function detectKind(text: string): Exclude<EntryKind, "document"> {
  const t = text.trim();
  if (!t) return "observation";
  const lower = t.toLowerCase();
  const emailSignals = [
    /^(from|subject|to|sent|date|cc):\s/im.test(t),
    /^(dear|hi|hello|good (morning|afternoon))\b/i.test(t),
    /(kind regards|best wishes|many thanks|warm regards|best regards|yours sincerely|regards,|thanks,)/i.test(t),
    /\bwrote:\s*$/im.test(t),
    /\b(please (could|can) you|let us know|we would like to|i wanted to let you know)\b/i.test(t),
  ].filter(Boolean).length;
  if (emailSignals >= 2 || (emailSignals === 1 && t.length > 400)) return "email";
  const isQuestion = /\?\s*$/.test(t) || /^(why|how|what|when|should|could|can|is|are|do|does|which|would)\b/i.test(lower);
  if (isQuestion && t.length < 500 && t.split(/\n/).length <= 4) return "question";
  return "observation";
}

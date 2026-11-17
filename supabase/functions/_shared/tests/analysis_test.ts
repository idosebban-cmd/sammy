import { type Analysis, collectRefs, postProcess } from "../analysis.ts";
import { cleanRefMarkers, type SourceRef } from "../context.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const refs = new Map<string, SourceRef>([
  ["T1", { ref: "T1", type: "timeline_event", id: "t-1", label: "2026-10-02: Upset in assembly" }],
  ["P1", { ref: "P1", type: "profile_entry", id: "p-1", label: "Triggers: loud halls" }],
]);

const SUBMISSION = `Dear Mr and Mrs Cohen,
Sammy became distressed during collective worship today and hit another child. Ms Blessing supported him to the calm room.
Please could you let us know by Friday 21st November whether you would like to meet. We will review his lunchtime plan at the
SEN review on 3 December.`;

function base(): Analysis {
  return {
    what_happened: { summary: "s", event_date: "2026-11-14", key_facts: [], people: [] },
    related_history: [
      { note: "Similar upset in assembly [T1]", refs: ["T1"] },
      { note: "Invented history [T9]", refs: ["T9"] },
    ],
    what_it_might_mean: [
      { statement: "Noise is a known trigger [P1]", basis: "recorded_history", refs: ["P1"] },
      { statement: "He has always hated worship", basis: "recorded_history", refs: ["Z3"] },
    ],
    what_we_can_do: [1, 2, 3, 4, 5].map((i) => ({ title: `r${i}`, detail: `d [T1] [D4]`, timeframe: "immediate", refs: ["T1", "nope"] })),
    follow_up_actions: [
      { title: "Reply about meeting", description: "", owner: "ido", owner_detail: null, origin: "explicit_commitment", due_date: "2026-11-21", due_date_quote: "by Friday 21st November", priority: "high" },
      { title: "Ask about worship alternative", description: "", owner: "ido", owner_detail: null, origin: "suggested", due_date: "2026-11-20", due_date_quote: "next week", priority: "medium" },
      { title: "Prepare for SEN review", description: "", owner: "both_parents", owner_detail: null, origin: "suggested", due_date: "2026-12-03", due_date_quote: "SEN review on 3 December", priority: "medium" },
      { title: "Bad date", description: "", owner: "school", owner_detail: null, origin: "suggested", due_date: "soon", due_date_quote: "by Friday 21st November", priority: "low" },
    ],
    what_to_remember: [
      { title: "Incident", text: "Hit a child in worship", target: "timeline", timeline_category: null, profile_section: "triggers", evidence_type: "observation", progress_areas: [] },
    ],
    safety: { concern: false, guidance: null },
    evidence_note: "",
  };
}

Deno.test("drops citations that do not exist in the provided context", () => {
  const a = postProcess(base(), refs, SUBMISSION);
  assert(a.related_history.length === 1, "unknown-ref history item should be removed");
  assert(a.what_we_can_do.length === 4, "at most four recommendations");
  assert(a.what_we_can_do[0].refs.join() === "T1", "invalid ref ids removed");
  assert(!a.what_we_can_do[0].detail.includes("[D4]"), "invalid inline markers removed");
  assert(a.what_we_can_do[0].detail.includes("[T1]"), "valid inline markers kept");
  const ids = collectRefs(a, refs).map((r) => r.ref).sort().join();
  assert(ids === "P1,T1", `collected sources: ${ids}`);
});

Deno.test("downgrades 'recorded history' claims that cite nothing real", () => {
  const a = postProcess(base(), refs, SUBMISSION);
  assert(a.what_it_might_mean[0].basis === "recorded_history", "supported claim kept as fact");
  assert(a.what_it_might_mean[1].basis === "possible_explanation", "unsupported claim downgraded");
});

Deno.test("keeps only deadlines quoted from the source text", () => {
  const [reply, ask, review, bad] = postProcess(base(), refs, SUBMISSION).follow_up_actions;
  assert(reply.due_date === "2026-11-21", "quoted deadline kept");
  assert(ask.due_date === null && ask.due_date_removed, "unquoted deadline removed");
  assert(review.due_date === "2026-12-03", "quote spanning a line break still matches");
  assert(bad.due_date === null, "non-ISO date removed");
});

Deno.test("timeline items get a category and no profile section", () => {
  const [m] = postProcess(base(), refs, SUBMISSION).what_to_remember;
  assert(m.timeline_category === "observation" && m.profile_section === null, JSON.stringify(m));
});

Deno.test("cleanRefMarkers reports which sources were used", () => {
  const { text, used } = cleanRefMarkers("A [T1] B [Q1] C [P1] [T1]", refs);
  assert(used.join() === "T1,P1", used.join());
  assert(text === "A [T1] B  C [P1] [T1]", text);
  const r2 = cleanRefMarkers("x [T7]", refs);
  assert(r2.text === "x " && r2.used.length === 0, r2.text);
});

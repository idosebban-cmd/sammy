import { type Analysis, collectRefs, postProcess } from "../analysis.ts";
import { cleanRefMarkers, documentScore, type SourceRef } from "../context.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const refs = new Map<string, SourceRef>([
  ["T1", { ref: "T1", type: "timeline_event", id: "t-1", label: "2026-10-02: Upset in assembly" }],
  ["P1", { ref: "P1", type: "profile_entry", id: "p-1", label: "Triggers: loud halls" }],
  ["I1", { ref: "I1", type: "intervention", id: "i-1", label: "1:1 support", observations: 1 }],
]);

const SUBMISSION = `Dear Mr and Mrs Cohen,
Sammy became distressed during collective worship today and hit another child. Ms Blessing supported him to the calm room.
Please could you let us know by Friday 21st November whether you would like to meet. We will review his lunchtime plan
before half-term, and his 1:1 support continues. The SEN review is on 3 December at 9:30.`;

function base(): Analysis {
  return {
    what_happened: { summary: "s", event_date: "2026-11-14", key_facts: [], people: [] },
    relevant_context: [
      { fact: "Similar upset in assembly [T1]", why_it_matters: "same setting", refs: ["T1"] },
      { fact: "Invented history [T9]", why_it_matters: "x", refs: ["T9"] },
    ],
    what_it_might_mean: [
      { statement: "Noise is a known trigger [P1]", basis: "recorded_history", refs: ["P1"] },
      { statement: "He has always hated worship", basis: "recorded_history", refs: ["Z3"] },
    ],
    what_we_can_do: [1, 2, 3, 4, 5].map((i) => ({ title: `r${i}`, detail: `d [T1] [D4]`, timeframe: "immediate", refs: ["T1", "nope"] })),
    questions_to_ask: [],
    follow_up_actions: [
      { title: "Reply about meeting", description: "", owner: "ido", owner_detail: null, kind: "task", origin: "explicit_commitment", date_phrase: "by Friday 21st November", due_date: "2026-11-21", due_time: null, date_status: "stated", priority: "high", commitment_index: null },
      { title: "Ask about worship alternative", description: "", owner: "helen", owner_detail: null, kind: "task", origin: "suggested", date_phrase: "next week", due_date: "2026-11-20", due_time: null, date_status: "worked_out", priority: "medium", commitment_index: null },
      { title: "Lunchtime plan review", description: "", owner: "school", owner_detail: null, kind: "task", origin: "explicit_commitment", date_phrase: "before half-term", due_date: "2027-02-12", due_time: null, date_status: "worked_out", priority: "medium", commitment_index: 0 },
      { title: "SEN review", description: "", owner: "both_parents", owner_detail: null, kind: "appointment", origin: "explicit_commitment", date_phrase: "on 3 December at 9:30", due_date: "2026-12-03", due_time: "09:30", date_status: "stated", priority: "high", commitment_index: 7 },
      { title: "Unclear", description: "", owner: "school", owner_detail: null, kind: "task", origin: "suggested", date_phrase: "before half-term", due_date: null, due_time: null, date_status: "none", priority: "low", commitment_index: null },
    ],
    commitments: [{ description: "Review lunchtime plan", kind: "professional_commitment", certainty: "reported", made_by: "school", ehcp_section: null, frequency: null, page: 0, review_date: "soon" }],
    progress: {
      summary: "Accepted support [I1]",
      signals: [{ area: "recovering", direction: "positive", note: "settled" }],
      intervention_updates: [
        { intervention_ref: "I1", new_intervention: null, observation: "Accepted Ms Blessing's help", apparent_effect: "seems_helpful", assessment: "Early sign", refs: ["I1"] },
        { intervention_ref: "T1", new_intervention: null, observation: "Not an intervention ref", apparent_effect: "unclear", assessment: "", refs: [] },
        { intervention_ref: null, new_intervention: { name: "Alternative to worship", goal: "Calmer mornings", setting: "school" }, observation: "Proposed", apparent_effect: "unclear", assessment: "Not started", refs: [] },
      ],
    },
    what_to_remember: [
      { title: "Incident", text: "Hit a child in worship", target: "timeline", timeline_category: null, profile_section: "triggers", evidence_type: "observation", progress_areas: [] },
    ],
    safety: { concern: false, guidance: null },
    evidence_note: "",
  };
}

Deno.test("context claims must cite real records", () => {
  const a = postProcess(base(), refs, SUBMISSION);
  assert(a.relevant_context.length === 1, "uncited context item dropped");
  assert(a.what_we_can_do.length === 4, "at most four recommendations");
  assert(a.what_we_can_do[0].refs.join() === "T1", "invalid ref ids removed");
  assert(!a.what_we_can_do[0].detail.includes("[D4]") && a.what_we_can_do[0].detail.includes("[T1]"), a.what_we_can_do[0].detail);
  const ids = collectRefs(a, refs).map((r) => r.ref).sort().join();
  assert(ids === "I1,P1,T1", `collected sources: ${ids}`);
});

Deno.test("downgrades 'recorded history' claims that cite nothing real", () => {
  const a = postProcess(base(), refs, SUBMISSION);
  assert(a.what_it_might_mean[0].basis === "recorded_history", "supported claim kept");
  assert(a.what_it_might_mean[1].basis === "possible_explanation", "unsupported claim downgraded");
});

Deno.test("dates: stated kept, worked-out needs confirming, unsourced removed", () => {
  const [reply, ask, lunch, review, unclear] = postProcess(base(), refs, SUBMISSION).follow_up_actions;
  assert(reply.due_date === "2026-11-21" && reply.date_confirmed === true, "stated date kept and confirmed");
  assert(ask.due_date === null && ask.date_removed && ask.date_phrase === null, "phrase not in source → date removed");
  assert(lunch.due_date === "2027-02-12" && lunch.date_confirmed === false && lunch.commitment_index === 0, "worked-out date kept unconfirmed");
  assert(review.due_time === "09:30" && review.kind === "appointment", "appointment time kept");
  assert(review.commitment_index === null, "out-of-range commitment index removed");
  assert(unclear.due_date === null && unclear.date_phrase === "before half-term" && unclear.date_confirmed === false, "phrase kept for confirmation");
});

Deno.test("intervention updates link only to real interventions", () => {
  const u = postProcess(base(), refs, SUBMISSION).progress.intervention_updates;
  assert(u.length === 2, `got ${u.length}`);
  assert(u[0].intervention_id === "i-1" && u[0].prior_observations === 1, "existing intervention linked with observation count");
  assert(u[1].intervention_id === null && u[1].new_intervention?.name === "Alternative to worship", "new intervention kept");
});

Deno.test("commitment fields sanitised", () => {
  const [c] = postProcess(base(), refs, SUBMISSION).commitments;
  assert(c.page === null && c.review_date === null, JSON.stringify(c));
});

Deno.test("timeline items get a category and no profile section", () => {
  const [m] = postProcess(base(), refs, SUBMISSION).what_to_remember;
  assert(m.timeline_category === "observation" && m.profile_section === null, JSON.stringify(m));
});

Deno.test("cleanRefMarkers keeps valid markers and strips unknown ones", () => {
  const { text, used } = cleanRefMarkers("A [T1] B [Q1] C [P1][T1]", refs);
  assert(used.join() === "T1,P1", used.join());
  assert(text === "A [T1] B C [P1][T1]", text);
});

Deno.test("documentScore finds the document a question refers to", () => {
  const ehcp = { title: "EHCP final", doc_date: "2026-05-10", category: "ehcp" };
  const ep = { title: "Educational Psychologist report", doc_date: "2026-03-01", category: "professional_report" };
  const notes = { title: "Meeting notes", doc_date: "2026-10-15", category: "meeting_notes" };
  assert(documentScore("What does his EHCP require regarding adult support?", ehcp) >= 2, "ehcp");
  assert(documentScore("Which Educational Psychologist recommendations haven't been followed up?", ep) >= 2, "ep");
  assert(documentScore("What did the school commit to at the October meeting?", notes) >= 2, "meeting");
  assert(documentScore("What has changed between the May EHCP and November review?", ehcp) > documentScore("What has changed between the May EHCP and November review?", ep), "may ehcp");
  assert(documentScore("How was his weekend?", ep) < 2, "unrelated question");
});

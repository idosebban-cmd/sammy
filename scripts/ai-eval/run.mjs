#!/usr/bin/env node
// Evaluates Sammy's AI end to end against a running deployment, using
// synthetic data only. It signs in as a TEST parent, seeds an EMPTY test
// workspace, runs realistic scenarios through the real Edge Functions, applies
// automated checks and writes a Markdown report with the full outputs.
//
// Use a separate test Supabase project (or `supabase start` locally), never
// the real one: it writes synthetic records into the workspace.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... EVAL_EMAIL=... EVAL_PASSWORD=... \
//     node scripts/ai-eval/run.mjs [--accept-ai-terms] [--reset]
//
// --accept-ai-terms  records AI consent in the test workspace (needed once)
// --reset            deletes everything in the test workspace first
//
// The checks are heuristics: they catch structural failures, invented
// citations or dates, and missing context, but the outputs should still be
// read by a person. The report includes them in full for that reason.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { CHAT_QUESTIONS, CONTRADICTORY_EMAIL, POSITIVE_OBSERVATION, RELATIVE_DATES_EMAIL, WORSHIP_EMAIL, fixtures, iso, nextHalfTerm } from "./fixtures.mjs";

const args = new Set(process.argv.slice(2));
const { SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_EMAIL, EVAL_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !EVAL_EMAIL || !EVAL_PASSWORD) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_EMAIL and EVAL_PASSWORD (a test parent account).");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const results = [];
const outputs = [];
let current = "";
const check = (name, cond, detail = "") => results.push({ scenario: current, name, pass: !!cond, detail });

async function invoke(fn, body) {
  const t0 = Date.now();
  const { data, error } = await db.functions.invoke(fn, { body });
  let payload = data;
  let status = 200;
  if (error) {
    status = error.context?.status ?? 0;
    try { payload = await error.context.json(); } catch { payload = { error: String(error.message) }; }
  }
  return { status, data: payload, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
const { error: signInErr } = await db.auth.signInWithPassword({ email: EVAL_EMAIL, password: EVAL_PASSWORD });
if (signInErr) { console.error(`Sign-in failed: ${signInErr.message}`); process.exit(1); }
const member = must(await db.from("workspace_members").select("workspace_id").limit(1).single(), "workspace");
const ws = member.workspace_id;

if (args.has("--reset")) must(await db.rpc("delete_all_records", { ws }), "reset");
const { count } = await db.from("entries").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
const { count: tcount } = await db.from("timeline_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
if ((count ?? 0) + (tcount ?? 0) > 0) {
  console.error("This workspace already has records. Use an empty TEST workspace, or pass --reset to wipe it (test projects only).");
  process.exit(1);
}
if (args.has("--accept-ai-terms")) {
  must(await db.from("ai_settings").upsert({ workspace_id: ws, terms_accepted: true, terms_accepted_at: new Date().toISOString(), terms_version: "ai-eval" }), "consent");
}

// ---------------------------------------------------------------------------
console.log("Seeding synthetic data…");
const F = fixtures();
must(await db.from("workspaces").update({ about: F.about, school_calendar: F.school_calendar }).eq("id", ws), "about");
must(await db.from("redaction_terms").insert(F.redactions.map((r) => ({ ...r, workspace_id: ws }))), "redactions");
must(await db.from("profile_entries").insert(F.profile.map((p) => ({ ...p, workspace_id: ws }))), "profile");
must(await db.from("timeline_events").insert(F.timeline.map((t) => ({ ...t, workspace_id: ws }))), "timeline");
for (const i of F.interventions) {
  const { observations, ...row } = i;
  const created = must(await db.from("interventions").insert({ ...row, workspace_id: ws }).select("id").single(), "intervention");
  if (observations.length) must(await db.from("intervention_observations").insert(observations.map((o) => ({ ...o, workspace_id: ws, intervention_id: created.id }))), "observations");
}
must(await db.from("actions").insert(F.actions.map((a) => ({ ...a, workspace_id: ws }))), "actions");
const docIds = {};
for (const d of F.documents) {
  const doc = must(await db.from("documents").insert({
    workspace_id: ws, title: d.title, category: d.category, doc_date: d.doc_date, storage_path: `${ws}/synthetic/${d.title}.pdf`,
    file_name: `${d.title}.pdf`, mime_type: "application/pdf", size_bytes: 0, page_count: d.pages.length, extraction_status: "done",
  }).select("id").single(), "document");
  docIds[d.title] = doc.id;
  must(await db.from("document_chunks").insert(d.pages.map((content, i) => ({ workspace_id: ws, document_id: doc.id, chunk_index: i, page: i + 1, content }))), "chunks");
}
must(await db.from("commitments").insert(F.commitments.map(({ doc, page, ...c }) => ({ ...c, workspace_id: ws, source_document_id: docIds[doc], source_page: page }))), "commitments");

// ---------------------------------------------------------------------------
async function analyse(name, kind, text, extra = {}) {
  current = name;
  const entry = must(await db.from("entries").insert({ workspace_id: ws, kind, raw_text: text, occurred_on: iso(0), ...extra }).select("id").single(), "entry");
  const r = await invoke("analyze", { entry_id: entry.id });
  const a = r.data?.analysis;
  outputs.push({ scenario: name, ms: r.ms, status: r.status, input: text, output: r.data });
  check("call succeeded", r.status === 200, r.status === 200 ? `${(r.ms / 1000).toFixed(1)}s` : JSON.stringify(r.data));
  if (!a) return null;
  check("structured output parsed", a.what_happened?.summary && Array.isArray(a.what_we_can_do) && a.progress);
  const ids = new Set((a.sources ?? []).map((s) => s.ref));
  const cited = [
    ...a.relevant_context.flatMap((x) => x.refs), ...a.what_it_might_mean.flatMap((x) => x.refs), ...a.what_we_can_do.flatMap((x) => x.refs),
  ];
  check("every citation resolves to a stored source", cited.every((c) => ids.has(c)), cited.filter((c) => !ids.has(c)).join(","));
  const textAll = JSON.stringify(a);
  check("no redaction placeholders left in output", !/\[(Teaching assistant|Classmate) [A-Z]\]/.test(textAll));
  for (const f of a.follow_up_actions) {
    if (f.due_date) check(`date for "${f.title.slice(0, 40)}" is sourced`, f.date_phrase && text.toLowerCase().replace(/\s+/g, " ").includes(f.date_phrase.toLowerCase().replace(/\s+/g, " ")), `${f.due_date} from "${f.date_phrase}"`);
  }
  check("no claim that an intervention has failed", !/(isn't working|is not working|has failed|not effective|ineffective)/i.test(JSON.stringify([a.progress, a.what_it_might_mean])));
  return a;
}

const lc = (x) => JSON.stringify(x).toLowerCase();

console.log("Scenario 1: incident email…");
const a1 = await analyse("1. Collective worship incident email", "email", WORSHIP_EMAIL, { title: "Collective worship" });
if (a1) {
  const ctx = lc(a1.relevant_context);
  check("context: worship/assembly previously difficult", /worship|assembl/.test(ctx));
  check("context: transitions / loss of control", /transition|control/.test(ctx));
  check("context: recent 1:1 support", /1:1|one-to-one|blessing|teaching assistant/.test(ctx));
  check("context: improvements reported by teacher", /calmer|improv|settled|more readily/.test(ctx));
  check("context: February review", /review|february/.test(ctx));
  check("2–4 recommendations", a1.what_we_can_do.length >= 2 && a1.what_we_can_do.length <= 4, String(a1.what_we_can_do.length));
  check("questions for school suggested", (a1.questions_to_ask ?? []).length >= 1);
  check("does not state worship as the cause", !a1.what_it_might_mean.some((m) => m.basis !== "possible_explanation" && /(caused by|because of) (the )?(collective )?worship/i.test(m.statement)));
  check("reply-about-meeting follow-up captured", a1.follow_up_actions.some((f) => /meet/i.test(f.title + f.description)));
  check("strengths/positives acknowledged", /writing|trains|good rest|settled/.test(lc([a1.what_happened, a1.progress])));
}

console.log("Scenario 2: short positive observation…");
const a2 = await analyse("2. Short positive observation", "observation", POSITIVE_OBSERVATION);
if (a2) {
  check("kept brief", a2.what_happened.summary.length < 350 && a2.what_we_can_do.length <= 3, `${a2.what_happened.summary.length} chars, ${a2.what_we_can_do.length} recs`);
  check("positive progress signal", a2.progress.signals.some((s) => s.direction === "positive"));
  check("linked to an existing intervention or provision", a2.progress.intervention_updates.some((u) => u.intervention_id) || a2.relevant_context.length > 0);
  check("cautious assessment", a2.progress.intervention_updates.every((u) => /early|soon|one|single|so far|first|encouraging|promising/i.test(u.assessment)), a2.progress.intervention_updates.map((u) => u.assessment).join(" | "));
  check("no unnecessary follow-ups", a2.follow_up_actions.length <= 2, String(a2.follow_up_actions.length));
}

console.log("Scenario 3: contradictory information…");
const a3 = await analyse("3. Contradicts the record", "email", CONTRADICTORY_EMAIL);
if (a3) {
  check("notices the recorded incident this week", /incident|pushed|upset|difficult|distress/.test(lc([a3.relevant_context, a3.what_it_might_mean])));
  check("doesn't accept 'clearly working' as established", !a3.what_it_might_mean.some((m) => m.basis !== "possible_explanation" && /clearly working|is working/i.test(m.statement)));
  check("suggests checking before removing support", /(before|evidence|review|discuss|ask|check|keep)/.test(lc([a3.what_we_can_do, a3.questions_to_ask])));
}

console.log("Scenario 4: relative dates…");
const a4 = await analyse("4. Relative dates", "email", RELATIVE_DATES_EMAIL);
if (a4) {
  const f = a4.follow_up_actions;
  const find = (re) => f.find((x) => re.test(`${x.title} ${x.description} ${x.date_phrase ?? ""}`));
  const profile = find(/profile/i);
  const ot = find(/OT|occupational|referral/i);
  const form = find(/form|views/i);
  const review = find(/review|meeting/i);
  check("'next Friday' resolved to a Friday, needs confirming", profile?.due_date && new Date(profile.due_date + "T12:00:00Z").getUTCDay() === 5 && profile.date_confirmed === false, JSON.stringify(profile && { d: profile.due_date, p: profile.date_phrase, c: profile.date_confirmed }));
  check("'before half-term' resolved using the calendar, needs confirming", ot && (!ot.due_date || (ot.due_date <= nextHalfTerm().start && ot.date_confirmed === false)), JSON.stringify(ot && { d: ot.due_date, p: ot.date_phrase }));
  check("'within two weeks' ≈ 14 days, needs confirming", form?.due_date && Math.abs((Date.parse(form.due_date) - Date.parse(iso(14))) / 86_400_000) <= 1 && form.date_confirmed === false, JSON.stringify(form && { d: form.due_date, p: form.date_phrase }));
  check("review is an appointment at 09:30", review?.kind === "appointment" && review?.due_time === "09:30", JSON.stringify(review && { k: review.kind, t: review.due_time, d: review.due_date }));
}

console.log("Scenario 5: document analysis (draft amendments)…");
const draftTitle = "EHCP annual review – proposed amendments (draft)";
const a5 = await analyse("5. Draft EHCP amendments document", "document", `Uploaded document: ${draftTitle}`, { title: draftTitle, document_id: docIds[draftTitle] });
if (a5) {
  const cs = a5.commitments ?? [];
  check("provisions extracted", cs.length >= 2, String(cs.length));
  check("20-hour 1:1 recorded as PROPOSED", cs.some((c) => /20 hours|1:1/i.test(c.description) && c.certainty === "proposed"), JSON.stringify(cs.map((c) => [c.certainty, c.description.slice(0, 50)])));
  check("fortnightly sessions recorded as REPORTED", cs.some((c) => /fortnight/i.test(c.description) && c.certainty === "reported"));
  check("page numbers captured", cs.some((c) => c.page));
  check("compares with confirmed EHCP", /familiar adult|f1|twice|2 x 30|current/.test(lc([a5.relevant_context, a5.what_it_might_mean, a5.progress])));
}

console.log("Scenario 6: assistant questions…");
let threadId = null;
for (const { id, q } of CHAT_QUESTIONS) {
  current = `6. Ask: ${q}`;
  const r = await invoke("assistant", { message: q, thread_id: null });
  outputs.push({ scenario: current, ms: r.ms, status: r.status, input: q, output: r.data });
  check("call succeeded", r.status === 200, r.status === 200 ? `${(r.ms / 1000).toFixed(1)}s` : JSON.stringify(r.data));
  const m = r.data?.message;
  if (!m) continue;
  threadId = r.data.thread_id;
  const ans = m.content.toLowerCase();
  const cites = m.citations ?? [];
  const citesDoc = (t) => cites.some((c) => c.type === "document_chunk" && c.label.startsWith(t));
  check("answer has citations", cites.length > 0 || id === "missing_doc", String(cites.length));
  if (id === "ehcp_adult_support") {
    check("cites the final EHCP", citesDoc("EHCP – final"));
    check("states the provision", /familiar adult/.test(ans));
    check("separates the proposed change", !/20 hours/.test(ans) || /propos|draft|not (yet )?agreed/.test(ans));
  }
  if (id === "ep_not_followed") {
    check("cites the EP report", citesDoc("Educational Psychologist"));
    check("identifies feelings thermometer / OT", /thermometer|occupational|\bot\b/.test(ans));
    check("doesn't claim proof nothing happened", !/(definitely|certainly) (not|never)/.test(ans));
  }
  if (id === "october_commitments") {
    check("cites October notes", citesDoc("School meeting notes"));
    check("lists commitments", /weekly note/.test(ans) && /ot|occupational/.test(ans));
  }
  if (id === "ehcp_compare") {
    check("finds the changes", /20 hours/.test(ans) && /alternative/.test(ans));
    check("labels them proposed", /propos|draft/.test(ans));
    check("cites both documents", citesDoc("EHCP – final") && citesDoc("EHCP annual review"));
  }
  if (id === "missing_doc") {
    check("says the information isn't there", m.meta?.evidence_level === "insufficient" || /(no|not|couldn't|can't|cannot).{0,60}(speech|salt|report|record|document)/.test(ans), m.meta?.evidence_level);
    check("doesn't invent recommendations", !/the speech and language therapist recommended/.test(ans));
  }
  if (id === "advice") {
    check("personalised: draws on several records", cites.length >= 2, String(cites.length));
    check("builds on now-and-next / transitions", /now and next|now-and-next|transition|warning|visual/.test(ans));
  }
}

console.log("Scenario 7: progress review…");
current = "7. Progress review";
const pr = await invoke("assistant", { mode: "progress_review", days: 90 });
outputs.push({ scenario: current, ms: pr.ms, status: pr.status, output: pr.data });
check("call succeeded", pr.status === 200, pr.status === 200 ? `${(pr.ms / 1000).toFixed(1)}s` : JSON.stringify(pr.data));
const rv = pr.data?.review?.content;
if (rv) {
  check("positives included", rv.going_well.length >= 1);
  check("1:1 support not overstated", rv.interventions.every((i) => !/1:1|blessing/i.test(i.name ?? "") || i.evidence_strength !== "consistent"), JSON.stringify(rv.interventions.map((i) => [i.name, i.evidence_strength])));
  check("no invented statistics", !/\d+\s?%|percent/i.test(JSON.stringify(rv)));
  check("every point cited", [...rv.going_well, ...rv.still_difficult].every((p) => p.refs.length > 0));
}

console.log("Scenario 8: error handling…");
current = "8. Error handling";
const bad = await invoke("analyze", { entry_id: "00000000-0000-0000-0000-000000000000" });
check("unknown record → 404, nothing crashes", bad.status === 404, String(bad.status));
const empty = await invoke("assistant", { message: "  " });
check("empty question → 400", empty.status === 400, String(empty.status));
void threadId;

// ---------------------------------------------------------------------------
const model = must(await db.from("entries").select("analysis_model").eq("workspace_id", ws).not("analysis_model", "is", null).limit(1), "model")[0]?.analysis_model ?? "unknown";
const passed = results.filter((r) => r.pass).length;
const lines = [
  `# Sammy AI evaluation — ${new Date().toISOString()}`, "",
  `Target: ${SUPABASE_URL} · model: ${model}`, "",
  `**${passed} / ${results.length} checks passed.** Checks are heuristics; read the outputs below as well.`, "",
  "| Scenario | Check | Result | Detail |", "|---|---|---|---|",
  ...results.map((r) => `| ${r.scenario} | ${r.name} | ${r.pass ? "✅" : "❌"} | ${String(r.detail ?? "").replace(/\|/g, "\\|").slice(0, 160)} |`),
  "", "## Outputs", "",
  ...outputs.flatMap((o) => [`### ${o.scenario} (${(o.ms / 1000).toFixed(1)}s, HTTP ${o.status})`, "", o.input ? `**Input**\n\n> ${String(o.input).replace(/\n/g, "\n> ")}\n` : "", "```json", JSON.stringify(o.output, null, 2), "```", ""]),
];
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "reports");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `ai-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
fs.writeFileSync(file, lines.join("\n"));
console.log(`\n${passed}/${results.length} checks passed. Report: ${file}`);
for (const r of results.filter((x) => !x.pass)) console.log(`  ❌ ${r.scenario} — ${r.name} ${r.detail ? `(${String(r.detail).slice(0, 120)})` : ""}`);

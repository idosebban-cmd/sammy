import { useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { ErrorNote, Field, Loading, PageHeader, Spinner } from "../components/ui";
import { downloadBlob, exportAll } from "../lib/data";
import { addDaysIso, formatDateTime, todayIso } from "../lib/dates";
import { supabase } from "../lib/supabase";
import type { RedactionTerm, ReminderSettingsRow } from "../lib/types";
import { ApiError, previewReminders, sendTestReminder, type ReminderPreview } from "../lib/api";
import { DOCUMENTS_BUCKET } from "../lib/supabase";
import { notifyChanged } from "../lib/events";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

const TERMS_VERSION = "anthropic-commercial-2026-11";

function Card({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="section-title mb-3 flex items-center gap-2">{icon}{title}</h2>
      {children}
    </section>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(null); setOk(null);
    try { const msg = await fn(); if (msg) setOk(msg); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return { busy, error, ok, run };
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Settings" subtitle="Your account, AI and privacy controls, and your data." />
      <AccountCard />
      <RemindersCard />
      <CalendarCard />
      <AiCard />
      <RedactionCard />
      <DataCard />
      <HistoryCard />
    </div>
  );
}

function AccountCard() {
  const { me, wsId, workspace, refresh, session } = useWs();
  const [name, setName] = useState(me?.display_name ?? "");
  const [child, setChild] = useState(workspace.child_name);
  const [password, setPassword] = useState("");
  const a = useAction();
  return (
    <Card title="Account">
      {a.error && <div className="mb-3"><ErrorNote message={a.error} /></div>}
      {a.ok && <p className="mb-3 rounded-lg bg-sage-50 p-2 text-sm text-sage-800">{a.ok}</p>}
      <p className="mb-3 text-sm text-stone-500">Signed in as {session?.user.email}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Your name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Child's name (shown in the app)"><input className="input" value={child} onChange={(e) => setChild(e.target.value)} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={a.busy} onClick={() => a.run(async () => {
          must(await supabase.from("workspace_members").update({ display_name: name.trim() || me?.display_name }).eq("workspace_id", wsId).eq("user_id", me!.user_id));
          must(await supabase.from("workspaces").update({ child_name: child.trim() || "Sammy" }).eq("id", wsId));
          await refresh();
          return "Saved.";
        })}>Save names</button>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 border-t border-sand-200 pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="New password" hint="At least 12 characters."><input type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button className="btn-secondary" disabled={a.busy || password.length < 12} onClick={() => a.run(async () => {
          const { error } = await supabase.auth.updateUser({ password });
          if (error) throw error;
          setPassword("");
          return "Password updated.";
        })}>Change password</button>
      </div>
      <div className="mt-5 border-t border-sand-200 pt-4">
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}><Icon name="logout" className="h-4 w-4" />Sign out</button>
      </div>
    </Card>
  );
}

function AiCard() {
  const { ai, wsId, refresh, me, memberName } = useWs();
  const [checks, setChecks] = useState([false, false, false]);
  const a = useAction();
  const accepted = !!ai?.terms_accepted;

  const accept = () => a.run(async () => {
    must(await supabase.from("ai_settings").upsert({
      workspace_id: wsId, terms_accepted: true, terms_accepted_at: new Date().toISOString(),
      terms_accepted_by: me?.user_id, terms_version: TERMS_VERSION,
    }));
    await refresh();
    return "AI features are now on.";
  });
  const withdraw = () => a.run(async () => {
    if (!window.confirm("Switch off AI features? Nothing more will be sent to the AI provider. Existing analyses stay in your records.")) return;
    must(await supabase.from("ai_settings").upsert({ workspace_id: wsId, terms_accepted: false }));
    await refresh();
    return "AI features are switched off.";
  });

  return (
    <Card title="AI provider & consent" icon={<Icon name="shield" className="h-5 w-5 text-sage-600" />}>
      {a.error && <div className="mb-3"><ErrorNote message={a.error} /></div>}
      {a.ok && <p className="mb-3 rounded-lg bg-sage-50 p-2 text-sm text-sage-800">{a.ok}</p>}
      <div className={`mb-4 rounded-xl p-3 text-sm ${accepted ? "bg-sage-50 text-sage-900" : "bg-amber-50 text-amber-900"}`}>
        {accepted
          ? <>AI is <strong>on</strong>. Accepted {ai?.terms_accepted_at ? formatDateTime(ai.terms_accepted_at) : ""}{ai?.terms_accepted_by ? ` by ${memberName(ai.terms_accepted_by)}` : ""}.</>
          : <>AI is <strong>off</strong>. Nothing about Sammy has been or will be sent to an AI provider until you accept below.</>}
      </div>
      <div className="space-y-3 text-sm text-stone-700">
        <p><strong>Provider:</strong> Anthropic (Claude), model <code className="rounded bg-sand-100 px-1">{ai?.model ?? "claude-opus-5-5"}</code>, called only from this app's server. Your browser never holds the API key. If the AI declines a request, you're told so; it is never quietly sent to a different model.</p>
        <p><strong>What is sent:</strong> the item you're analysing or the question you ask, plus the relevant parts of Sammy's profile, timeline, actions, interventions and document passages needed to answer it. Names you list under "Redaction" are replaced with placeholders first, and email addresses and phone numbers are removed if that option is on.</p>
        <p><strong>How it's handled:</strong> under Anthropic's commercial terms, data sent through the API is not used to train its models by default, and is kept for a limited period for safety and abuse monitoring before deletion. Processing may take place outside the UK and EU. Terms change, so please read the current versions:</p>
        <ul className="list-disc pl-5">
          <li><a className="text-sage-700 underline" href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noreferrer">Anthropic commercial terms</a></li>
          <li><a className="text-sage-700 underline" href="https://privacy.anthropic.com" target="_blank" rel="noreferrer">Anthropic privacy centre (retention and data handling)</a></li>
          <li><a className="text-sage-700 underline" href="https://www.anthropic.com/legal/aup" target="_blank" rel="noreferrer">Usage policy</a></li>
        </ul>
      </div>
      {!accepted ? (
        <div className="mt-4 space-y-2 border-t border-sand-200 pt-4">
          {[
            "I have read the provider's current terms and data retention information.",
            "I understand that information about Sammy (after redaction) will be sent to the provider when we use AI features.",
            "I understand the AI can be wrong, will not diagnose, and doesn't replace professional advice.",
          ].map((label, i) => (
            <label key={i} className="flex items-start gap-2 text-sm text-stone-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-sand-400 text-sage-600" checked={checks[i]} onChange={(e) => setChecks(checks.map((c, j) => (j === i ? e.target.checked : c)))} />
              {label}
            </label>
          ))}
          <button className="btn-primary mt-2" disabled={a.busy || !checks.every(Boolean)} onClick={accept}>Accept and switch on AI</button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-sand-200 pt-4">
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600" checked={!!ai?.redact_contact_details}
              onChange={(e) => a.run(async () => { must(await supabase.from("ai_settings").update({ redact_contact_details: e.target.checked }).eq("workspace_id", wsId)); await refresh(); })} />
            Remove email addresses and phone numbers before sending
          </label>
          <span className="flex-1" />
          <button className="btn-danger" disabled={a.busy} onClick={withdraw}>Switch off AI</button>
        </div>
      )}
    </Card>
  );
}

function RedactionCard() {
  const { wsId } = useWs();
  const { data, reload } = useLoad(async () => must(await supabase.from("redaction_terms").select("*").eq("workspace_id", wsId).order("term")) as RedactionTerm[], [wsId]);
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const a = useAction();
  return (
    <Card title="Redaction">
      <p className="mb-3 text-sm text-stone-600">
        Names of other children, staff or family members to hide from the AI provider. Each is swapped for a placeholder before
        sending, and swapped back in the answer you see. Your own records always keep the real names.
      </p>
      {a.error && <div className="mb-3"><ErrorNote message={a.error} /></div>}
      <form className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => {
        e.preventDefault();
        if (!term.trim()) return;
        void a.run(async () => {
          const rep = replacement.trim() || `[Person ${(data?.length ?? 0) + 1}]`;
          must(await supabase.from("redaction_terms").insert({ workspace_id: wsId, term: term.trim(), replacement: rep.startsWith("[") ? rep : `[${rep}]` }));
          setTerm(""); setReplacement("");
          await reload();
        });
      }}>
        <input className="input" placeholder="Name, e.g. Oliver Smith" value={term} onChange={(e) => setTerm(e.target.value)} />
        <input className="input" placeholder="Shown to AI as, e.g. Classmate A" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
        <button className="btn-secondary" disabled={a.busy || !term.trim()}>Add</button>
      </form>
      {!!data?.length && (
        <ul className="mt-3 divide-y divide-sand-200 rounded-xl border border-sand-200">
          {data.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span><span className="font-medium">{t.term}</span> <span className="text-stone-400">→</span> <code className="text-stone-600">{t.replacement}</code></span>
              <button className="btn-ghost p-1" aria-label={`Remove ${t.term}`} onClick={() => a.run(async () => { must(await supabase.from("redaction_terms").delete().eq("id", t.id)); await reload(); })}><Icon name="x" className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-stone-500">Tip: add both full names and first names (e.g. "Ms Jane Blessing" and "Ms Blessing").</p>
    </Card>
  );
}

function DataCard() {
  const { wsId } = useWs();
  const a = useAction();
  return (
    <Card title="Your data">
      {a.error && <div className="mb-3"><ErrorNote message={a.error} /></div>}
      {a.ok && <p className="mb-3 rounded-lg bg-sage-50 p-2 text-sm text-sage-800">{a.ok}</p>}
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-medium">Export everything</p><p className="text-stone-500">All records, analyses, actions and history as one JSON file.</p></div>
          <button className="btn-secondary" disabled={a.busy} onClick={() => a.run(async () => {
            downloadBlob(await exportAll(wsId), `sammy-export-${todayIso()}.json`);
            return "Export downloaded.";
          })}>{a.busy ? <Spinner className="h-4 w-4" /> : <Icon name="download" className="h-4 w-4" />}Export</button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 pt-4">
          <div><p className="font-medium">Delete all assistant conversations</p><p className="text-stone-500">Removes chat history. Your records are not affected.</p></div>
          <button className="btn-danger" disabled={a.busy} onClick={() => a.run(async () => {
            if (!window.confirm("Delete all assistant conversations permanently?")) return;
            must(await supabase.from("chat_threads").delete().eq("workspace_id", wsId));
            return "Conversations deleted.";
          })}>Delete</button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 pt-4">
          <div><p className="font-medium text-red-800">Delete everything</p><p className="text-stone-500">Every record, analysis, document and conversation, for both of you. Accounts stay. Export first.</p></div>
          <button className="btn-danger" disabled={a.busy} onClick={() => a.run(async () => {
            const typed = window.prompt('This permanently deletes all of Sammy\'s records for both parents. Type DELETE to confirm.');
            if (typed !== "DELETE") return;
            const docs = must(await supabase.from("documents").select("storage_path").eq("workspace_id", wsId)) as { storage_path: string }[];
            for (let i = 0; i < docs.length; i += 100) await supabase.storage.from(DOCUMENTS_BUCKET).remove(docs.slice(i, i + 100).map((d) => d.storage_path));
            must(await supabase.rpc("delete_all_records", { ws: wsId }));
            notifyChanged();
            return "Everything has been deleted.";
          })}>Delete everything</button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 pt-4">
          <div><p className="font-medium">Clear change history older than 12 months</p><p className="text-stone-500">The history keeps earlier versions of edited or deleted records.</p></div>
          <button className="btn-danger" disabled={a.busy} onClick={() => a.run(async () => {
            if (!window.confirm("Permanently remove change history older than 12 months?")) return;
            must(await supabase.from("audit_log").delete().eq("workspace_id", wsId).lt("at", addDaysIso(todayIso(), -365)));
            return "Older history cleared.";
          })}>Clear</button>
        </div>
      </div>
    </Card>
  );
}

interface AuditRow { id: number; table_name: string; operation: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; actor_name: string | null; at: string }

const TABLE_NAMES: Record<string, string> = {
  entries: "Record", timeline_events: "Timeline", actions: "Action", profile_entries: "Profile", documents: "Document",
  interventions: "Intervention", intervention_observations: "Observation", recommendations: "Next step", commitments: "Commitment", ai_settings: "AI settings",
};
const IGNORED = new Set(["updated_at", "created_at", "fts", "workspace_id", "id", "analysis"]);

function describe(r: AuditRow): string {
  const d = r.new_data ?? r.old_data ?? {};
  const name = (d.title ?? d.name ?? d.content ?? d.note ?? "") as string;
  if (r.operation !== "UPDATE" || !r.old_data || !r.new_data) return String(name).slice(0, 80);
  const changed = Object.keys(r.new_data).filter((k) => !IGNORED.has(k) && JSON.stringify(r.new_data![k]) !== JSON.stringify(r.old_data![k]));
  return `${String(name).slice(0, 60)}${changed.length ? ` — changed ${changed.join(", ")}` : ""}`;
}

function HistoryCard() {
  const { wsId } = useWs();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, loading, error } = useLoad(async () => open
    ? must(await supabase.from("audit_log").select("*").eq("workspace_id", wsId).order("at", { ascending: false }).limit(150)) as AuditRow[]
    : [], [wsId, open]);
  return (
    <Card title="Change history">
      <p className="mb-3 text-sm text-stone-600">Every addition, edit and deletion is recorded with who made it and when.</p>
      {!open ? <button className="btn-secondary" onClick={() => setOpen(true)}>Show recent changes</button>
        : loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
          <ul className="max-h-[420px] divide-y divide-sand-200 overflow-y-auto rounded-xl border border-sand-200 text-sm">
            {data?.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <button className="w-full text-left" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <span className={`chip mr-2 ${r.operation === "DELETE" ? "bg-rose-50 text-rose-700" : r.operation === "INSERT" ? "bg-sage-50 text-sage-800" : "bg-sand-100 text-stone-700"}`}>
                    {r.operation === "INSERT" ? "Added" : r.operation === "UPDATE" ? "Edited" : "Deleted"}
                  </span>
                  <span className="text-stone-500">{TABLE_NAMES[r.table_name] ?? r.table_name}</span> · {describe(r)}
                  <span className="block text-xs text-stone-400">{formatDateTime(r.at)}{r.actor_name ? ` · ${r.actor_name}` : ""}</span>
                </button>
                {expanded === r.id && (
                  <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-sand-50 p-2 text-[11px] text-stone-600">{JSON.stringify(r.operation === "DELETE" ? r.old_data : { before: r.old_data, after: r.new_data }, null, 2)}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function RemindersCard() {
  const { wsId, me, session } = useWs();
  const { data, reload, loading } = useLoad(async () =>
    must(await supabase.from("reminder_settings").select("*").eq("user_id", me!.user_id).maybeSingle()) as ReminderSettingsRow | null, [me?.user_id]);
  const guessKey = (me?.display_name ?? "").toLowerCase().startsWith("helen") ? "helen" : (me?.display_name ?? "").toLowerCase().startsWith("ido") ? "ido" : null;
  const [local, setLocal] = useState<ReminderSettingsRow | null>(null);
  const current: ReminderSettingsRow = local ?? data ?? {
    user_id: me!.user_id, workspace_id: wsId, enabled: false, email: null, owner_key: guessKey, scope: "mine",
    due_soon_days: 2, overdue_repeat_days: 3, waiting_after_days: 7, include_titles: false,
  };
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const a = useAction();

  // Optimistic: the control updates at once; a failed save puts it back.
  const save = (patch: Partial<ReminderSettingsRow>) => {
    const next = { ...current, ...patch };
    setLocal(next);
    return a.run(async () => {
      try {
        must(await supabase.from("reminder_settings").upsert(next));
      } catch (e) {
        setLocal(null);
        throw e;
      }
      await reload();
    });
  };
  const NumberSelect = ({ value, onChange, choices, suffix }: { value: number; onChange: (n: number) => void; choices: number[]; suffix: (n: number) => string }) => (
    <select className="input !w-auto !py-1.5 text-sm" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {choices.map((n) => <option key={n} value={n}>{suffix(n)}</option>)}
    </select>
  );

  if (loading && !data) return <Card title="Email reminders"><Loading /></Card>;
  return (
    <Card title="Email reminders" icon={<Icon name="clock" className="h-5 w-5 text-sage-600" />}>
      {a.error && <div className="mb-3"><ErrorNote message={a.error} /></div>}
      <p className="mb-3 text-sm text-stone-600">At most one short email a day, only when something needs you. Emails just say what's due, with a link into the app — no details about Sammy unless you choose to include titles.</p>
      <label className="flex items-center gap-2 text-sm font-medium text-stone-800">
        <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600" checked={current.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
        Send me reminders
      </label>
      <div className={`mt-4 space-y-3 text-sm ${current.enabled ? "" : "pointer-events-none opacity-50"}`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Send to"><input className="input" type="email" defaultValue={current.email ?? ""} placeholder={session?.user.email ?? ""} onBlur={(e) => e.target.value !== (current.email ?? "") && save({ email: e.target.value.trim() || null })} /></Field>
          <Field label="I am">
            <select className="input" value={current.owner_key ?? ""} onChange={(e) => save({ owner_key: (e.target.value || null) as ReminderSettingsRow["owner_key"] })}>
              <option value="">—</option><option value="ido">Ido</option><option value="helen">Helen</option>
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>Remind me about</span>
          <select className="input !w-auto !py-1.5 text-sm" value={current.scope} onChange={(e) => save({ scope: e.target.value as "mine" | "all" })}>
            <option value="mine">my actions, shared ones, and replies we're waiting for</option>
            <option value="all">everything</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>Deadlines</span>
          <NumberSelect value={current.due_soon_days} onChange={(n) => save({ due_soon_days: n })} choices={[0, 1, 2, 3, 5, 7]} suffix={(n) => (n === 0 ? "on the day" : `${n} day${n === 1 ? "" : "s"} before`)} />
          <span>· overdue items every</span>
          <NumberSelect value={current.overdue_repeat_days} onChange={(n) => save({ overdue_repeat_days: n })} choices={[1, 2, 3, 7, 14]} suffix={(n) => `${n} day${n === 1 ? "" : "s"}`} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>Chase replies after</span>
          <NumberSelect value={current.waiting_after_days} onChange={(n) => save({ waiting_after_days: n })} choices={[3, 5, 7, 10, 14, 21]} suffix={(n) => `${n} days`} />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 rounded border-sand-400 text-sage-600" checked={current.include_titles} onChange={(e) => save({ include_titles: e.target.checked })} />
          Include action titles in emails
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-sand-200 pt-4">
        <button className="btn-secondary btn-sm" disabled={a.busy} onClick={() => a.run(async () => { setPreview(await previewReminders()); })}>Preview today's email</button>
        <button className="btn-ghost btn-sm" disabled={a.busy} onClick={() => a.run(async () => {
          try {
            const r = await sendTestReminder();
            setPreview(r);
            return r.sent ? `Sent to ${r.to}.` : r.message ?? "Nothing to send today.";
          } catch (e) {
            throw new Error(e instanceof ApiError && e.code === "email_not_configured" ? "Email sending hasn't been set up on the server yet (see the README)." : e instanceof Error ? e.message : String(e));
          }
        })}>Send me a test now</button>
      </div>
      {a.ok && <p className="mt-2 text-sm text-sage-800">{a.ok}</p>}
      {preview && (
        <div className="mt-3 rounded-xl bg-sand-100 p-3 text-sm">
          {preview.items.length === 0 ? <p className="text-stone-600">Nothing would be sent today.</p> : (
            <>
              <p className="font-medium">{preview.email?.subject ?? `${preview.items.length} item(s)`}</p>
              <ul className="mt-1 list-disc pl-5 text-stone-700">{preview.items.map((i) => <li key={i.action_id + i.reason}>{i.label}{current.include_titles ? `: ${i.title}` : ""}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function CalendarCard() {
  const { wsId, workspace, refresh } = useWs();
  const [text, setText] = useState(workspace.school_calendar ?? "");
  const a = useAction();
  return (
    <Card title="School calendar">
      <p className="mb-2 text-sm text-stone-600">Term dates help turn phrases like "before half-term" or "end of term" in school emails into real dates.</p>
      <textarea className="input min-h-[90px]" value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"e.g.\nAutumn term ends: Fri 19 Dec 2026\nSpring term: Mon 5 Jan – Fri 27 Mar 2027\nHalf-term: 16–20 Feb 2027"} />
      {a.error && <div className="mt-2"><ErrorNote message={a.error} /></div>}
      <div className="mt-2 flex items-center justify-end gap-3">
        {a.ok && <span className="text-sm text-sage-800">{a.ok}</span>}
        <button className="btn-secondary btn-sm" disabled={a.busy || text === (workspace.school_calendar ?? "")} onClick={() => a.run(async () => {
          must(await supabase.from("workspaces").update({ school_calendar: text.trim() || null }).eq("id", wsId));
          await refresh();
          return "Saved.";
        })}>Save</button>
      </div>
    </Card>
  );
}

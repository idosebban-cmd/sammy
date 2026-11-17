import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ActionDetail, ActionEditor, ActionRow, setActionStatus } from "../components/actions";
import { Icon } from "../components/Icon";
import { Empty, ErrorNote, Loading, PageHeader, Select } from "../components/ui";
import { daysFromToday } from "../lib/dates";
import { useOnChanged } from "../lib/events";
import { OWNER_LABELS, options } from "../lib/labels";
import { supabase } from "../lib/supabase";
import type { Action, ActionOwner } from "../lib/types";
import { must, useLoad } from "../lib/useLoad";
import { useWs } from "../lib/workspace";

type View = "open" | "waiting" | "completed" | "all";

const VIEWS: { value: View; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "waiting", label: "Waiting on others" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

export default function ActionsPage() {
  const { wsId } = useWs();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("open");
  const [owner, setOwner] = useState<ActionOwner | "">("");
  const [editing, setEditing] = useState<Action | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, error, loading, reload } = useLoad(
    async () => must(await supabase.from("actions").select("*").eq("workspace_id", wsId)
      .order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false })) as Action[],
    [wsId],
  );
  useOnChanged(useCallback(() => void reload(), [reload]));

  const selectedId = params.get("id");
  const selected = data?.find((a) => a.id === selectedId) ?? null;
  const close = () => { params.delete("id"); setParams(params, { replace: true }); };

  const groups = useMemo(() => {
    let list = data ?? [];
    if (owner) list = list.filter((a) => a.owner === owner);
    if (view === "open") list = list.filter((a) => a.status !== "completed");
    if (view === "waiting") list = list.filter((a) => a.status === "waiting");
    if (view === "completed") {
      return [{ title: "Completed", items: [...list.filter((a) => a.status === "completed")].sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")) }];
    }
    const open = list.filter((a) => a.status !== "completed");
    const out = [
      { title: "Overdue", items: open.filter((a) => a.due_date && daysFromToday(a.due_date) < 0) },
      { title: "Due in the next 7 days", items: open.filter((a) => a.due_date && daysFromToday(a.due_date) >= 0 && daysFromToday(a.due_date) <= 7) },
      { title: "Later", items: open.filter((a) => a.due_date && daysFromToday(a.due_date) > 7) },
      { title: "No due date", items: open.filter((a) => !a.due_date).sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority])) },
    ];
    if (view === "all") out.push({ title: "Completed", items: list.filter((a) => a.status === "completed") });
    return out.filter((g) => g.items.length);
  }, [data, view, owner]);

  const toggle = (a: Action) => setActionStatus(wsId, a, a.status === "completed" ? "todo" : "completed");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Actions"
        subtitle="Everything you, school and professionals need to follow up."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" />New action</button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-sand-100 p-1">
          {VIEWS.map((v) => (
            <button key={v.value} onClick={() => setView(v.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${view === v.value ? "bg-white text-sage-800 shadow-soft" : "text-stone-600"}`}>{v.label}</button>
          ))}
        </div>
        <Select className="!w-auto !py-1.5 text-xs" value={owner} onChange={setOwner} options={options(OWNER_LABELS)} allowEmpty emptyLabel="Anyone" />
      </div>

      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} onRetry={reload} /> : groups.length === 0 ? (
        <Empty title={view === "completed" ? "Nothing completed yet" : "Nothing to follow up"}
          action={<button className="btn-secondary" onClick={() => setCreating(true)}>Add an action</button>}>
          Actions you approve from an analysis, or add yourself, appear here.
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${g.title === "Overdue" ? "text-rose-700" : "text-stone-500"}`}>{g.title} · {g.items.length}</h2>
              <div className="card divide-y divide-sand-200">
                {g.items.map((a) => (
                  <ActionRow key={a.id} action={a} onToggle={() => toggle(a)} onOpen={() => setParams({ id: a.id })} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ActionDetail action={selected} onClose={close} onEdit={(a) => setEditing(a)} onDeleted={close} />
      <ActionEditor open={creating || !!editing} action={editing} onClose={() => { setCreating(false); setEditing(null); }} />
    </div>
  );
}

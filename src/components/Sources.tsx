import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SourceRef } from "../lib/types";

export function sourceHref(s: SourceRef): string {
  switch (s.type) {
    case "timeline_event": return `/timeline?focus=${s.id}`;
    case "profile_entry": return `/sammy?focus=${s.id}`;
    case "action": return `/actions?id=${s.id}`;
    case "intervention": return `/timeline?tab=interventions&focus=${s.id}`;
    case "document_chunk": return `/documents/${s.document_id}?chunk=${s.id}`;
    case "entry": return `/entries/${s.id}`;
  }
}

const TYPE_LABEL: Record<SourceRef["type"], string> = {
  timeline_event: "Timeline",
  profile_entry: "Profile",
  action: "Action",
  intervention: "Intervention",
  document_chunk: "Document",
  entry: "Record",
};

export function SourceChip({ source, onNavigate }: { source: SourceRef; onNavigate?: () => void }) {
  return (
    <Link
      to={sourceHref(source)}
      onClick={onNavigate}
      className="chip max-w-full bg-sage-50 text-sage-800 ring-1 ring-sage-200 hover:bg-sage-100"
      title={source.label}
    >
      <span className="font-semibold">{TYPE_LABEL[source.type]}</span>
      <span className="truncate">{source.label}</span>
    </Link>
  );
}

export function SourceList({ refs, sources, onNavigate }: { refs: string[]; sources: SourceRef[]; onNavigate?: () => void }) {
  const list = refs.map((r) => sources.find((s) => s.ref === r)).filter((s): s is SourceRef => !!s);
  if (!list.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {list.map((s) => <SourceChip key={s.ref} source={s} onNavigate={onNavigate} />)}
    </div>
  );
}

/** Removes [T3]-style markers where sources are shown separately as chips. */
export function stripRefs(text: string): string {
  return text.replace(/\s*\[[A-Z]\d{1,3}\]/g, "");
}

/** Replaces [T3]-style markers with small numbered links to the source. */
function withCitations(text: string, sources: SourceRef[], onNavigate?: () => void): ReactNode[] {
  const parts = text.split(/(\[[A-Z]\d{1,3}\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[([A-Z]\d{1,3})\]$/);
    if (!m) return <Fragment key={i}>{inline(p)}</Fragment>;
    const idx = sources.findIndex((s) => s.ref === m[1]);
    if (idx < 0) return null;
    return (
      <Link
        key={i}
        to={sourceHref(sources[idx])}
        onClick={onNavigate}
        title={sources[idx].label}
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-sage-100 px-1 align-super text-[10px] font-semibold text-sage-800 hover:bg-sage-200"
      >
        {idx + 1}
      </Link>
    );
  });
}

function inline(text: string): ReactNode[] {
  // **bold** and *italic*, rendered as React elements (no raw HTML).
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**") ? <strong key={m.index}>{t.slice(2, -2)}</strong> : <em key={m.index}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A small, safe Markdown subset: paragraphs, headings, bullet and numbered lists. */
export function RichText({ text, sources = [], onNavigate }: { text: string; sources?: SourceRef[]; onNavigate?: () => void }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{withCitations(para.join(" "), sources, onNavigate)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{withCitations(it, sources, onNavigate)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const num = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (!line) { flushPara(); flushList(); continue; }
    if (heading) { flushPara(); flushList(); blocks.push(<h4 key={blocks.length}>{withCitations(heading[1], sources, onNavigate)}</h4>); continue; }
    if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return <div className="prose-sammy text-sm leading-relaxed text-stone-700">{blocks}</div>;
}

export function SourcesFooter({ sources, onNavigate }: { sources: SourceRef[]; onNavigate?: () => void }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 border-t border-sand-200 pt-2">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">Sources</p>
      <ol className="space-y-1 text-xs">
        {sources.map((s, i) => (
          <li key={s.ref} className="flex gap-2">
            <span className="w-4 shrink-0 text-right font-semibold text-sage-700">{i + 1}</span>
            <Link to={sourceHref(s)} onClick={onNavigate} className="text-stone-600 underline-offset-2 hover:text-sage-800 hover:underline">
              {TYPE_LABEL[s.type]} · {s.label}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

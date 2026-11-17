import { useEffect, useId, type ReactNode } from "react";
import { EVIDENCE_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "../lib/labels";
import type { ActionStatus, EvidenceType, Priority } from "../lib/types";
import { Icon } from "./Icon";

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-sage-500 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-stone-500" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <button className="font-medium underline" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-sand-300 bg-sand-50/50 px-5 py-8 text-center">
      <p className="font-medium text-stone-700">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-stone-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({
  open, onClose, title, children, footer, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/30 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sand-200 px-5 py-4">
          <h2 id={id} className="font-display text-lg font-semibold">{title}</h2>
          <button className="btn-ghost -mr-2 p-2" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-sand-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export function Select<T extends string>({
  value, onChange, options, className = "", allowEmpty, emptyLabel = "—",
}: {
  value: T | "" | null;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select className={`input ${className}`} value={value ?? ""} onChange={(e) => onChange(e.target.value as T)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const EVIDENCE_STYLE: Record<EvidenceType, string> = {
  professional: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  observation: "bg-sand-100 text-stone-700 ring-1 ring-sand-300",
  ai_hypothesis: "bg-amber-50 text-amber-800 border border-dashed border-amber-400",
};

export function EvidenceBadge({ type }: { type: EvidenceType }) {
  return (
    <span className={`chip ${EVIDENCE_STYLE[type]}`} title={type === "ai_hypothesis" ? "Suggested by AI and not confirmed by a professional" : undefined}>
      {type === "ai_hypothesis" && <Icon name="sparkles" className="h-3 w-3" />}
      {EVIDENCE_LABELS[type]}
    </span>
  );
}

const STATUS_STYLE: Record<ActionStatus, string> = {
  todo: "bg-sand-100 text-stone-700",
  waiting: "bg-amber-50 text-amber-800",
  in_progress: "bg-sky-50 text-sky-800",
  completed: "bg-emerald-50 text-emerald-800",
};

export function StatusBadge({ status }: { status: ActionStatus }) {
  return <span className={`chip ${STATUS_STYLE[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityTag({ priority }: { priority: Priority }) {
  if (priority === "low") return <span className="chip bg-stone-50 text-stone-500">Low priority</span>;
  return (
    <span className={`chip ${priority === "high" ? "bg-rose-50 text-rose-700" : "bg-stone-100 text-stone-600"}`}>
      {PRIORITY_LABELS[priority]} priority
    </span>
  );
}

export function AiNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-stone-500">
      <Icon name="sparkles" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      <span>{children}</span>
    </p>
  );
}

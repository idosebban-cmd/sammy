-- Sammy: core schema
-- One private workspace shared by two parent accounts. Every table carries a
-- workspace_id and is protected by row-level security that only admits members.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Workspace & membership
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  child_name text not null default 'Sammy',
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members(user_id);

-- SECURITY DEFINER so policies can consult membership without recursing
-- through workspace_members' own RLS policy.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create or replace function public.current_member_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select display_name from public.workspace_members where user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------------
-- AI provider settings and consent. Nothing about Sammy is sent to an AI
-- provider until a parent has explicitly accepted the provider's terms.
-- ---------------------------------------------------------------------------

create table public.ai_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  provider text not null default 'anthropic',
  model text not null default 'claude-opus-5-5',
  terms_accepted boolean not null default false,
  terms_accepted_at timestamptz,
  terms_accepted_by uuid references auth.users(id),
  terms_version text,
  redact_contact_details boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Names and phrases replaced with neutral placeholders before any text leaves
-- for the AI provider, and restored in the response.
create table public.redaction_terms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  term text not null,
  replacement text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, term)
);

-- ---------------------------------------------------------------------------
-- Documents (original files live in the private "documents" storage bucket)
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  doc_date date,
  category text not null default 'other' check (category in (
    'ehcp','school_report','professional_report','assessment','letter',
    'meeting_notes','medical','correspondence','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  page_count int,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','done','failed','empty')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.documents(workspace_id, doc_date desc);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index int not null,
  page int,              -- PDF page number (1-based) when known
  section text,          -- heading / section label when known (DOCX)
  content text not null,
  fts tsvector generated always as (to_tsvector('english', coalesce(section,'') || ' ' || content)) stored,
  unique (document_id, chunk_index)
);
create index on public.document_chunks using gin(fts);
create index on public.document_chunks(workspace_id);

-- ---------------------------------------------------------------------------
-- Entries: every Smart Input submission, preserved verbatim.
-- ---------------------------------------------------------------------------

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('email','observation','document','question')),
  title text,
  raw_text text not null,           -- the original submission, never modified by AI
  occurred_on date,                 -- when it happened / date of the email
  document_id uuid references public.documents(id) on delete set null,
  analysis jsonb,                   -- raw structured AI output (always labelled as AI)
  analysis_model text,
  analysis_status text not null default 'none'
    check (analysis_status in ('none','pending','done','failed','skipped')),
  analysis_error text,
  analysed_at timestamptz,
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed','reviewed')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  fts tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || raw_text)) stored,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.entries(workspace_id, created_at desc);
create index on public.entries using gin(fts);

-- ---------------------------------------------------------------------------
-- Timeline
-- ---------------------------------------------------------------------------

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  occurred_on date not null,
  category text not null check (category in (
    'positive','dysregulation','anxiety','school_change','intervention',
    'appointment','decision','observation','other')),
  title text not null,
  description text,
  progress_areas text[] not null default '{}',
  evidence_type text not null default 'observation'
    check (evidence_type in ('professional','observation','ai_hypothesis')),
  source_label text,
  source_entry_id uuid references public.entries(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null,
  intervention_id uuid,
  fts tsvector generated always as (to_tsvector('english', title || ' ' || coalesce(description,''))) stored,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.timeline_events(workspace_id, occurred_on desc);
create index on public.timeline_events using gin(fts);

-- ---------------------------------------------------------------------------
-- Interventions & observed outcomes
-- ---------------------------------------------------------------------------

create table public.interventions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  setting text not null default 'school' check (setting in ('home','school','both','clinic','other')),
  started_on date,
  ended_on date,
  status text not null default 'active' check (status in ('planned','active','paused','stopped')),
  source_entry_id uuid references public.entries(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.timeline_events
  add constraint timeline_events_intervention_fk
  foreign key (intervention_id) references public.interventions(id) on delete set null;

create table public.intervention_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  observed_on date not null default current_date,
  apparent_effect text not null check (apparent_effect in ('seems_helpful','unclear','not_helpful')),
  note text not null,
  source_entry_id uuid references public.entries(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Actions & follow-ups
-- ---------------------------------------------------------------------------

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  description text,
  owner text not null default 'ido' check (owner in ('ido','helen','both_parents','school','local_authority','therapist','other')),
  owner_detail text,
  due_date date,
  status text not null default 'todo' check (status in ('todo','waiting','in_progress','completed')),
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  origin text not null default 'manual' check (origin in ('manual','ai_suggested','explicit_commitment')),
  source_label text,
  source_entry_id uuid references public.entries(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null,
  completed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.actions(workspace_id, status, due_date);

create table public.action_updates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_id uuid not null references public.actions(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note','change')),
  body text not null,
  author_id uuid default auth.uid() references auth.users(id),
  author_name text default public.current_member_name(),
  created_at timestamptz not null default now()
);
create index on public.action_updates(action_id, created_at);

-- ---------------------------------------------------------------------------
-- "Understanding Sammy" profile
-- ---------------------------------------------------------------------------

create table public.profile_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  section text not null check (section in (
    'strengths','emotional_needs','triggers','early_signs','helpful_strategies',
    'unhelpful_strategies','educational_needs','social','professional_recommendations')),
  content text not null,
  evidence_type text not null check (evidence_type in ('professional','observation','ai_hypothesis')),
  source_label text,
  source_entry_id uuid references public.entries(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null,
  status text not null default 'active' check (status in ('active','archived')),
  fts tsvector generated always as (to_tsvector('english', content || ' ' || coalesce(source_label,''))) stored,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.profile_entries(workspace_id, section);

-- ---------------------------------------------------------------------------
-- Recommendations kept from analyses (dashboard "Suggested next steps")
-- ---------------------------------------------------------------------------

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  detail text,
  timeframe text not null default 'longer_term' check (timeframe in ('immediate','longer_term')),
  status text not null default 'active' check (status in ('active','done','dismissed')),
  source_entry_id uuid references public.entries(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Evidence-pack foundations (Phase 2). Commitments capture EHCP provisions,
-- professional commitments and recommendations; evidence_links tie any claim
-- to its sources so a future pack generator can cite everything.
-- ---------------------------------------------------------------------------

create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('ehcp_provision','professional_commitment','professional_recommendation','school_arrangement')),
  description text not null,
  made_by text,
  ehcp_section text,
  frequency text,
  starts_on date,
  review_on date,
  status text not null default 'unknown' check (status in ('unknown','in_place','partially_delivered','not_delivered','ended')),
  source_document_id uuid references public.documents(id) on delete set null,
  source_page int,
  source_entry_id uuid references public.entries(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.evidence_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_type text not null check (subject_type in ('commitment','intervention','action','profile_entry')),
  subject_id uuid not null,
  evidence_type text not null check (evidence_type in ('timeline_event','entry','document_chunk','action','intervention_observation')),
  evidence_id uuid not null,
  relation text not null default 'supports' check (relation in ('supports','delivers','contradicts','relates_to')),
  note text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index on public.evidence_links(subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- Assistant conversations
-- ---------------------------------------------------------------------------

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default 'New conversation',
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  citations jsonb not null default '[]',
  meta jsonb not null default '{}',
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index on public.chat_messages(thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Audit history
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  table_name text not null,
  record_id uuid not null,
  operation text not null,
  old_data jsonb,
  new_data jsonb,
  actor_id uuid,
  actor_name text,
  at timestamptz not null default now()
);
create index on public.audit_log(workspace_id, at desc);
create index on public.audit_log(record_id);

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
  rid uuid;
begin
  if tg_op = 'DELETE' then
    ws := old.workspace_id; rid := old.id;
  else
    ws := new.workspace_id; rid := new.id;
  end if;
  insert into public.audit_log(workspace_id, table_name, record_id, operation, old_data, new_data, actor_id, actor_name)
  values (
    ws, tg_table_name, rid, tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) - 'fts' end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) - 'fts' end,
    auth.uid(), public.current_member_name()
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Keep completed_at in step with status
create or replace function public.actions_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger actions_completed_at before insert or update on public.actions
  for each row execute function public.actions_completed_at();

do $$
declare t text;
begin
  foreach t in array array['entries','timeline_events','actions','profile_entries','documents',
                           'interventions','recommendations','commitments','ai_settings','chat_threads']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['entries','timeline_events','actions','profile_entries','documents',
                           'interventions','intervention_observations','commitments','recommendations']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;

-- ai_settings has workspace_id as its key (no id column); audit it separately.
create or replace function public.audit_ai_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(workspace_id, table_name, record_id, operation, old_data, new_data, actor_id, actor_name)
  values (new.workspace_id, 'ai_settings', new.workspace_id, tg_op,
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new),
          auth.uid(), public.current_member_name());
  return new;
end;
$$;
create trigger ai_settings_audit after insert or update on public.ai_settings
  for each row execute function public.audit_ai_settings();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "members read workspace" on public.workspaces
  for select using (public.is_workspace_member(id));
create policy "members update workspace" on public.workspaces
  for update using (public.is_workspace_member(id)) with check (public.is_workspace_member(id));

create policy "members read members" on public.workspace_members
  for select using (public.is_workspace_member(workspace_id));
create policy "members update own name" on public.workspace_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No insert/delete policies: membership is managed only with the service role.

do $$
declare t text;
begin
  foreach t in array array['ai_settings','redaction_terms','documents','document_chunks','entries',
                           'timeline_events','interventions','intervention_observations','actions',
                           'action_updates','profile_entries','recommendations','commitments',
                           'evidence_links','chat_threads','chat_messages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "members full access" on public.%I
      for all using (public.is_workspace_member(workspace_id))
      with check (public.is_workspace_member(workspace_id))$p$, t);
  end loop;
end $$;

-- Audit log: members can read and prune it, never forge or edit entries.
alter table public.audit_log enable row level security;
create policy "members read audit" on public.audit_log
  for select using (public.is_workspace_member(workspace_id));
create policy "members prune audit" on public.audit_log
  for delete using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Retrieval helper: ranked keyword search across everything recorded.
-- Runs with the caller's privileges, so RLS still applies.
-- ---------------------------------------------------------------------------

create or replace function public.search_records(ws uuid, q text, max_results int default 20)
returns table (
  kind text, id uuid, parent_id uuid, title text, snippet text,
  page int, section text, occurred_on date, rank real
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tsq tsquery;
begin
  -- OR the terms together so partial matches still surface, ranked by relevance.
  begin
    tsq := replace(plainto_tsquery('english', q)::text, '&', '|')::tsquery;
  exception when others then
    return;
  end;
  if tsq is null or tsq::text = '' then
    return;
  end if;

  return query
  select * from (
    select 'document_chunk'::text, c.id, c.document_id, d.title, c.content, c.page, c.section, d.doc_date,
           ts_rank(c.fts, tsq)
      from public.document_chunks c join public.documents d on d.id = c.document_id
     where c.workspace_id = ws and c.fts @@ tsq
    union all
    select 'entry', e.id, null::uuid, coalesce(e.title, e.kind), e.raw_text, null::int, null::text, e.occurred_on,
           ts_rank(e.fts, tsq)
      from public.entries e
     where e.workspace_id = ws and e.fts @@ tsq
    union all
    select 'timeline_event', t.id, null::uuid, t.title, coalesce(t.description, t.title), null::int, t.category, t.occurred_on,
           ts_rank(t.fts, tsq)
      from public.timeline_events t
     where t.workspace_id = ws and t.fts @@ tsq
    union all
    select 'profile_entry', p.id, null::uuid, p.section, p.content, null::int, p.evidence_type, p.created_at::date,
           ts_rank(p.fts, tsq)
      from public.profile_entries p
     where p.workspace_id = ws and p.status = 'active' and p.fts @@ tsq
  ) r
  order by 9 desc
  limit max_results;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects stored under "<workspace_id>/..."
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400,
        array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy "members read documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
create policy "members upload documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
create policy "members delete documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));

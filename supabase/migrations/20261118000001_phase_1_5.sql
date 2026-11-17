-- Sammy Phase 1.5: personalisation, progress, follow-ups, documents, reminders.
-- Additive and backwards compatible with Phase 1 data.

-- ---------------------------------------------------------------------------
-- Security fix: members could previously change workspace_id on their own
-- membership row (and so join another workspace). Only display_name may change.
-- ---------------------------------------------------------------------------
revoke update on public.workspace_members from authenticated, anon;
grant update (display_name) on public.workspace_members to authenticated;

-- ---------------------------------------------------------------------------
-- Background the AI should always know, and the school calendar used to
-- resolve phrases like "before half-term".
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists about text,
  add column if not exists school_calendar text;

-- ---------------------------------------------------------------------------
-- Progress areas: align with the areas parents asked to follow.
-- ---------------------------------------------------------------------------
update public.timeline_events set progress_areas = (
  select coalesce(array_agg(distinct m), '{}') from (
    select case a
      when 'recognising_emotions' then 'emotional_regulation'
      when 'accepting_support' then 'emotional_regulation'
      when 'managing_anxiety' then 'anxiety_confidence'
      when 'classroom_engagement' then 'learning'
      when 'confidence' then 'wellbeing'
      else a end as m
    from unnest(progress_areas) a
  ) x
) where progress_areas && array['recognising_emotions','accepting_support','managing_anxiety','classroom_engagement','confidence'];

-- ---------------------------------------------------------------------------
-- Commitments: provisions, recommendations and promises, with certainty.
-- ---------------------------------------------------------------------------
alter table public.commitments
  add column if not exists certainty text not null default 'confirmed'
    check (certainty in ('confirmed','proposed','reported')),
  add column if not exists notes text,
  add column if not exists source_label text;

-- ---------------------------------------------------------------------------
-- Interventions linked to outcomes
-- ---------------------------------------------------------------------------
alter table public.interventions
  add column if not exists goal text,
  add column if not exists progress_areas text[] not null default '{}',
  add column if not exists commitment_id uuid references public.commitments(id) on delete set null;

alter table public.intervention_observations drop constraint if exists intervention_observations_apparent_effect_check;
update public.intervention_observations set apparent_effect = 'no_clear_effect' where apparent_effect = 'not_helpful';
alter table public.intervention_observations
  add constraint intervention_observations_apparent_effect_check
    check (apparent_effect in ('seems_helpful','mixed','no_clear_effect','seems_worse','unclear')),
  add column if not exists assessment text,
  add column if not exists timeline_event_id uuid references public.timeline_events(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Actions: appointments, dates that need confirming, outcomes, waiting time
-- ---------------------------------------------------------------------------
alter table public.actions
  add column if not exists kind text not null default 'task' check (kind in ('task','appointment')),
  add column if not exists due_time time,
  add column if not exists due_text text,
  add column if not exists date_confirmed boolean not null default true,
  add column if not exists outcome text,
  add column if not exists commitment_id uuid references public.commitments(id) on delete set null,
  add column if not exists intervention_id uuid references public.interventions(id) on delete set null,
  add column if not exists status_changed_at timestamptz not null default now();

create or replace function public.actions_status_changed()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists actions_status_changed on public.actions;
create trigger actions_status_changed before update on public.actions
  for each row execute function public.actions_status_changed();

-- ---------------------------------------------------------------------------
-- Documents: scanned pages transcribed by AI
-- ---------------------------------------------------------------------------
alter table public.documents drop constraint if exists documents_extraction_status_check;
alter table public.documents
  add constraint documents_extraction_status_check
    check (extraction_status in ('pending','done','failed','empty','partial')),
  add column if not exists text_source text not null default 'extracted'
    check (text_source in ('extracted','ai_transcribed','mixed'));

-- ---------------------------------------------------------------------------
-- AI progress reviews (on demand, stored so both parents see the same one)
-- ---------------------------------------------------------------------------
create table if not exists public.progress_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_days int not null default 90,
  content jsonb not null,
  citations jsonb not null default '[]',
  model text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.progress_reviews enable row level security;
create policy "members full access" on public.progress_reviews
  for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Email reminders (per parent, optional)
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  email text,
  owner_key text check (owner_key in ('ido','helen')),
  scope text not null default 'mine' check (scope in ('mine','all')),
  due_soon_days int not null default 2 check (due_soon_days between 0 and 14),
  overdue_repeat_days int not null default 3 check (overdue_repeat_days between 1 and 30),
  waiting_after_days int not null default 7 check (waiting_after_days between 1 and 60),
  include_titles boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.reminder_settings enable row level security;
create policy "own reminder settings" on public.reminder_settings
  for all using (user_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

create table if not exists public.reminder_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid references public.actions(id) on delete cascade,
  reason text not null,
  sent_at timestamptz not null default now()
);
create index if not exists reminder_log_lookup on public.reminder_log(user_id, action_id, reason, sent_at desc);
alter table public.reminder_log enable row level security;
create policy "members read reminder log" on public.reminder_log
  for select using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Audit and touch triggers for the new/changed tables
-- ---------------------------------------------------------------------------
create trigger reminder_settings_touch before update on public.reminder_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Save a reviewed analysis atomically: either everything the parent
-- confirmed is saved, or nothing is (so a failure can't leave half a review).
-- Runs as the caller, so row-level security still applies.
-- ---------------------------------------------------------------------------
create or replace function public.save_review(p_entry_id uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  e public.entries;
  src text := p->>'source_label';
  n_actions int := 0; n_timeline int := 0; n_profile int := 0; n_recs int := 0;
  n_obs int := 0; n_interventions int := 0; n_commitments int := 0;
  item jsonb;
  new_id uuid;
  ref_map jsonb := '{}';
begin
  select * into e from public.entries where id = p_entry_id;
  if not found then raise exception 'Record not found'; end if;

  -- Commitments first so actions can link to them by their client key.
  for item in select * from jsonb_array_elements(coalesce(p->'commitments', '[]')) loop
    insert into public.commitments(workspace_id, kind, certainty, description, made_by, ehcp_section, frequency,
                                   review_on, source_document_id, source_page, source_entry_id, source_label)
    values (e.workspace_id, item->>'kind', coalesce(item->>'certainty','confirmed'), item->>'description',
            nullif(item->>'made_by',''), nullif(item->>'ehcp_section',''), nullif(item->>'frequency',''),
            nullif(item->>'review_on','')::date, e.document_id, nullif(item->>'page','')::int, e.id, src)
    returning id into new_id;
    if item ? 'key' then ref_map := ref_map || jsonb_build_object(item->>'key', new_id); end if;
    n_commitments := n_commitments + 1;
  end loop;

  -- New interventions (may be referenced by observations through their key)
  for item in select * from jsonb_array_elements(coalesce(p->'interventions', '[]')) loop
    insert into public.interventions(workspace_id, name, description, goal, setting, started_on, status, source_entry_id, source_document_id, progress_areas)
    values (e.workspace_id, item->>'name', nullif(item->>'description',''), nullif(item->>'goal',''),
            coalesce(nullif(item->>'setting',''),'school'), nullif(item->>'started_on','')::date,
            coalesce(nullif(item->>'status',''),'active'), e.id, e.document_id,
            coalesce((select array_agg(x) from jsonb_array_elements_text(item->'progress_areas') x), '{}'))
    returning id into new_id;
    if item ? 'key' then ref_map := ref_map || jsonb_build_object(item->>'key', new_id); end if;
    n_interventions := n_interventions + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p->'observations', '[]')) loop
    insert into public.intervention_observations(workspace_id, intervention_id, observed_on, apparent_effect, note, assessment, source_entry_id)
    values (e.workspace_id,
            coalesce(nullif(item->>'intervention_id','')::uuid, (ref_map->>(item->>'intervention_key'))::uuid),
            coalesce(nullif(item->>'observed_on','')::date, e.occurred_on, current_date),
            item->>'apparent_effect', item->>'note', nullif(item->>'assessment',''), e.id);
    n_obs := n_obs + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p->'actions', '[]')) loop
    insert into public.actions(workspace_id, title, description, owner, owner_detail, kind, due_date, due_time, due_text,
                               date_confirmed, status, priority, origin, source_entry_id, source_document_id, source_label, commitment_id)
    values (e.workspace_id, item->>'title', nullif(item->>'description',''), item->>'owner', nullif(item->>'owner_detail',''),
            coalesce(nullif(item->>'kind',''),'task'), nullif(item->>'due_date','')::date, nullif(item->>'due_time','')::time,
            nullif(item->>'due_text',''), coalesce((item->>'date_confirmed')::boolean, true),
            coalesce(nullif(item->>'status',''),'todo'), coalesce(nullif(item->>'priority',''),'medium'),
            coalesce(nullif(item->>'origin',''),'ai_suggested'), e.id, e.document_id, src,
            (ref_map->>(item->>'commitment_key'))::uuid)
    returning id into new_id;
    insert into public.action_updates(workspace_id, action_id, kind, body)
    values (e.workspace_id, new_id, 'change', 'Created from ' || coalesce(src, 'a record'));
    n_actions := n_actions + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p->'timeline', '[]')) loop
    insert into public.timeline_events(workspace_id, occurred_on, category, title, description, progress_areas, evidence_type,
                                       source_label, source_entry_id, source_document_id)
    values (e.workspace_id, coalesce(nullif(item->>'occurred_on','')::date, e.occurred_on, current_date), item->>'category',
            item->>'title', nullif(item->>'description',''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(item->'progress_areas') x), '{}'),
            coalesce(nullif(item->>'evidence_type',''),'observation'), src, e.id, e.document_id);
    n_timeline := n_timeline + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p->'profile', '[]')) loop
    insert into public.profile_entries(workspace_id, section, content, evidence_type, source_label, source_entry_id, source_document_id)
    values (e.workspace_id, item->>'section', item->>'content', item->>'evidence_type', src, e.id, e.document_id);
    n_profile := n_profile + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p->'recommendations', '[]')) loop
    insert into public.recommendations(workspace_id, title, detail, timeframe, source_entry_id)
    values (e.workspace_id, item->>'title', nullif(item->>'detail',''), coalesce(nullif(item->>'timeframe',''),'longer_term'), e.id);
    n_recs := n_recs + 1;
  end loop;

  update public.entries set review_status = 'reviewed', reviewed_at = now(), reviewed_by = auth.uid() where id = e.id;

  return jsonb_build_object('actions', n_actions, 'timeline', n_timeline, 'profile', n_profile, 'recommendations', n_recs,
                            'observations', n_obs, 'interventions', n_interventions, 'commitments', n_commitments);
end;
$$;

-- ---------------------------------------------------------------------------
-- Search now also covers commitments and intervention observations.
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
    union all
    select 'commitment', m.id, m.source_document_id, m.kind, m.description, m.source_page, m.certainty, m.created_at::date,
           ts_rank(to_tsvector('english', m.description || ' ' || coalesce(m.made_by,'')), tsq)
      from public.commitments m
     where m.workspace_id = ws and to_tsvector('english', m.description || ' ' || coalesce(m.made_by,'')) @@ tsq
  ) r
  order by 9 desc
  limit max_results;
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete everything in the workspace (records and change history), keeping the
-- accounts and the workspace itself. Storage files are removed by the app.
-- ---------------------------------------------------------------------------
create or replace function public.delete_all_records(ws uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_workspace_member(ws) then raise exception 'Not allowed'; end if;
  delete from public.chat_threads where workspace_id = ws;
  delete from public.progress_reviews where workspace_id = ws;
  delete from public.evidence_links where workspace_id = ws;
  delete from public.recommendations where workspace_id = ws;
  delete from public.actions where workspace_id = ws;
  delete from public.intervention_observations where workspace_id = ws;
  delete from public.timeline_events where workspace_id = ws;
  delete from public.interventions where workspace_id = ws;
  delete from public.commitments where workspace_id = ws;
  delete from public.profile_entries where workspace_id = ws;
  delete from public.entries where workspace_id = ws;
  delete from public.documents where workspace_id = ws;
  delete from public.redaction_terms where workspace_id = ws;
  delete from public.audit_log where workspace_id = ws;
end;
$$;

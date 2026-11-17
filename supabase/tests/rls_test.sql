-- Manual RLS check. Run against a scratch database that has the migration applied
-- and Supabase-like auth/storage schemas (see README "Testing"). Expect the last
-- three statements to fail with row-level security errors.
grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated; grant execute on all functions in schema public to authenticated;
grant all on storage.objects to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','ido@x'),('22222222-2222-2222-2222-222222222222','helen@x'),('33333333-3333-3333-3333-333333333333','stranger@x');
insert into workspaces(id,name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Family'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Other');
insert into workspace_members values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','Ido'),('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','Helen'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','33333333-3333-3333-3333-333333333333','X');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into entries(workspace_id,kind,raw_text,occurred_on) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','email','Sammy became upset during collective worship and hit a peer. Ms Blessing supported him.','2026-11-10');
insert into actions(workspace_id,title,owner) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Ask about worship alternative','ido');
update actions set status='completed';
select title,status,completed_at is not null as done from actions;
insert into action_updates(workspace_id,action_id,body) select workspace_id,id,'Emailed school' from actions;
select author_name from action_updates;
select kind,title,rank>0 from search_records('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','worship upset');
insert into storage.objects(bucket_id,name) values ('documents','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/x.pdf');
select table_name, operation, actor_name from audit_log order by id;
\echo --- stranger
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select count(*) as entries_visible from entries;
select count(*) as audit_visible from audit_log;
select count(*) from search_records('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','worship');
\set ON_ERROR_STOP 0
insert into entries(workspace_id,kind,raw_text) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','email','hack');
insert into workspace_members values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','X');
insert into storage.objects(bucket_id,name) values ('documents','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/y.pdf');

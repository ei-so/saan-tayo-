-- Room documents never enter the exposed schema. All writes serialize on a room lock.
create schema if not exists saantayo_private;
revoke all on schema saantayo_private from public, anon, authenticated;
create table saantayo_private.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host uuid not null references auth.users(id) on delete cascade,
  document jsonb not null,
  created_at timestamptz not null default now()
);
alter table saantayo_private.rooms enable row level security;
create table public.room_events (id uuid primary key references saantayo_private.rooms(id) on delete cascade, revision bigint not null default 0);
alter table public.room_events enable row level security;
revoke all on public.room_events from anon, authenticated;
grant select on public.room_events to authenticated;

create function saantayo_private.is_member(room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from saantayo_private.rooms r, jsonb_array_elements(r.document->'participants') p
    where r.id=room_id and p->>'id'=auth.uid()::text
  );
$$;
revoke all on function saantayo_private.is_member(uuid) from public;
grant usage on schema saantayo_private to authenticated;
grant execute on function saantayo_private.is_member(uuid) to authenticated;
create policy member_events on public.room_events for select to authenticated using (saantayo_private.is_member(id));

create function saantayo_private.valid_preferences(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p)='object'
    and jsonb_typeof(p->'budget')='number' and (p->>'budget')::numeric between 1 and 10000
    and jsonb_typeof(p->'distance')='number' and (p->>'distance')::numeric between 0.1 and 10
    and jsonb_typeof(p->'cuisines')='array' and jsonb_array_length(p->'cuisines')<=30
    and not exists(select 1 from jsonb_array_elements(p->'cuisines') x where jsonb_typeof(x)<>'string' or length(x #>> '{}')>80)
    and jsonb_typeof(p->'vegetarian')='boolean' and jsonb_typeof(p->'halal')='boolean'
    and jsonb_typeof(p->'allowUnknown')='boolean';
$$;
create function saantayo_private.valid_candidates(c jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(c) is distinct from 'array' or jsonb_array_length(c)>100 or pg_column_size(c)>200000 then return false; end if;
  for item in select * from jsonb_array_elements(c) loop
    if jsonb_typeof(item) is distinct from 'object' or coalesce(length(item->>'id'),0) not between 1 and 100
      or coalesce(length(item->>'name'),0) not between 1 and 160 or jsonb_typeof(item->'lat') is distinct from 'number'
      or jsonb_typeof(item->'lng') is distinct from 'number' or (item->>'lat')::numeric not between -90 and 90
      or (item->>'lng')::numeric not between -180 and 180 or jsonb_typeof(item->'distance') is distinct from 'number'
      or (item->>'distance')::numeric not between 0 and 100000 or jsonb_typeof(item->'cuisines') is distinct from 'array'
      or coalesce(item->>'source','') not in ('osm','demo') then return false; end if;
    if jsonb_typeof(item->'price') is null or jsonb_typeof(item->'price') not in ('null','number')
      or jsonb_typeof(item->'vegetarian') is null or jsonb_typeof(item->'vegetarian') not in ('null','boolean')
      or jsonb_typeof(item->'halal') is null or jsonb_typeof(item->'halal') not in ('null','boolean')
      or jsonb_array_length(item->'cuisines')>30 then return false; end if;
    if item->>'price' is not null and (item->>'price')::numeric not between 0 and 10000 then return false; end if;
    if exists(select 1 from jsonb_array_elements(item->'cuisines') x where jsonb_typeof(x)<>'string' or length(x #>> '{}')>80) then return false; end if;
  end loop;
  return (select count(*)=count(distinct x->>'id') from jsonb_array_elements(c) x);
end;
$$;
revoke all on function saantayo_private.valid_preferences(jsonb), saantayo_private.valid_candidates(jsonb) from public;

create function saantayo_private.candidate_score(c jsonb,people jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
declare x jsonb; p jsonb; n numeric:=jsonb_array_length(people); votes numeric:=0; affordability numeric:=0; distance_score numeric:=0; cravings numeric:=0; matches numeric:=0; weight numeric:=65; total numeric;
begin
  if n=0 then return null; end if;
  for x in select * from jsonb_array_elements(people) loop
    p:=x->'prefs';
    if (p->>'budget')::numeric<=0 or (p->>'distance')::numeric<=0 or (c->>'distance')::numeric>(p->>'distance')::numeric
      or (c->>'price' is null and not (p->>'allowUnknown')::boolean)
      or (c->>'price' is not null and (c->>'price')::numeric>(p->>'budget')::numeric)
      or ((p->>'vegetarian')::boolean and not coalesce((c->>'vegetarian')::boolean,(p->>'allowUnknown')::boolean))
      or ((p->>'halal')::boolean and not coalesce((c->>'halal')::boolean,(p->>'allowUnknown')::boolean)) then return null; end if;
    votes:=votes+coalesce((x->'votes'->>(c->>'id'))::numeric,0);
    distance_score:=distance_score+greatest(0,1-(c->>'distance')::numeric/(p->>'distance')::numeric);
    if c->>'price' is not null then affordability:=affordability+greatest(0,1-(c->>'price')::numeric/(p->>'budget')::numeric); end if;
    if jsonb_array_length(p->'cuisines')>0 then
      cravings:=cravings+1;
      if exists(select 1 from jsonb_array_elements_text(p->'cuisines') a cross join jsonb_array_elements_text(c->'cuisines') b where lower(a.value)=lower(b.value)) then matches:=matches+1; end if;
    end if;
  end loop;
  total:=55*votes/(n*2)+10*distance_score/n;
  if c->>'price' is not null then total:=total+10*affordability/n;weight:=weight+10;end if;
  if cravings>0 and jsonb_array_length(c->'cuisines')>0 then total:=total+25*matches/cravings;weight:=weight+25;end if;
  return round(100*total/weight,1);
end;
$$;
revoke all on function saantayo_private.candidate_score(jsonb,jsonb) from public;
create function saantayo_private.room_action(action text,args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); r saantayo_private.rooms; d jsonb; p jsonb; participants jsonb;
  nickname text:=trim(args->>'nickname'); candidate jsonb; winner text;
  prefs jsonb:='{"budget":300,"distance":5,"cuisines":[],"vegetarian":false,"halal":false,"allowUnknown":false}';
begin
  if uid is null then raise exception 'Sign in required'; end if;
  if pg_column_size(args)>250000 then raise exception 'Request too large'; end if;
  if action='create' then
    if length(nickname) not between 1 and 40 or nickname is null or length(trim(args->>'name')) not between 1 and 80 or args->>'name' is null then raise exception 'Enter a room name and nickname'; end if;
    if not saantayo_private.valid_candidates(args->'candidates') then raise exception 'Invalid candidates'; end if;
    if (select count(*) from saantayo_private.rooms where host=uid and created_at>now()-interval '1 hour')>=10 then raise exception 'Room creation limit reached'; end if;
    r.id:=gen_random_uuid();r.code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));r.host:=uid;
    d:=jsonb_build_object('id',r.id,'code',r.code,'name',trim(args->>'name'),'hostId',uid,'participants',jsonb_build_array(jsonb_build_object('id',uid,'name',nickname,'prefs',prefs,'votes','{}'::jsonb)), 'candidates',args->'candidates','status','waiting','winnerId',null,'mode','online');
    insert into saantayo_private.rooms(id,code,host,document) values(r.id,r.code,uid,d);
    insert into public.room_events(id) values(r.id);
    return d;
  end if;
  if action='join' then
    select * into r from saantayo_private.rooms where code=upper(trim(args->>'code')) for update;
  else
    select * into r from saantayo_private.rooms where id=(args->>'id')::uuid for update;
  end if;
  if r.id is null then raise exception 'Room unavailable'; end if;
  d:=r.document;
  select value into p from jsonb_array_elements(d->'participants') where value->>'id'=uid::text;
  if action='join' and p is null then
    if d->>'status'<>'waiting' then raise exception 'Voting has already started'; end if;
    if length(nickname) not between 1 and 40 or nickname is null then raise exception 'Enter a nickname'; end if;
    if jsonb_array_length(d->'participants')>=12 then raise exception 'This room is full'; end if;
    p:=jsonb_build_object('id',uid,'name',nickname,'prefs',prefs,'votes','{}'::jsonb);
    d:=jsonb_set(d,'{participants}',(d->'participants')||jsonb_build_array(p));
  elsif p is null then raise exception 'Room unavailable'; end if;
  if action in ('candidates','start','finish','restart','cancel','remove','select') and uid<>r.host then raise exception 'Only the host can do this'; end if;
  if action='cancel' then
    delete from saantayo_private.rooms where id=r.id;
    return null;
  elsif action='profile' then
    if d->>'status'<>'waiting' then raise exception 'Preferences are locked during voting'; end if;
    if length(trim(args->>'name')) not between 1 and 40 or args->>'name' is null or not coalesce(saantayo_private.valid_preferences(args->'prefs'),false) then raise exception 'Invalid profile'; end if;
    p:=p||jsonb_build_object('name',trim(args->>'name'),'prefs',args->'prefs');
    select jsonb_agg(case when x->>'id'=uid::text then p else x end) into participants from jsonb_array_elements(d->'participants') x;
    d:=jsonb_set(d,'{participants}',participants);
  elsif action in ('vote','undo') then
    if d->>'status'<>'voting' then raise exception 'Voting is closed'; end if;
    if action='vote' and (jsonb_typeof(args->'value') is distinct from 'number' or args->>'value' not in ('0','1','2')) then raise exception 'Invalid vote'; end if;
    if not exists(select 1 from jsonb_array_elements(d->'candidates') x where x->>'id'=args->>'restaurant') then raise exception 'Unknown restaurant'; end if;
    if action='undo' then p:=jsonb_set(p,'{votes}',(p->'votes')-(args->>'restaurant')); else p:=jsonb_set(p,array['votes',args->>'restaurant'],args->'value'); end if;
    select jsonb_agg(case when x->>'id'=uid::text then p else x end) into participants from jsonb_array_elements(d->'participants') x;
    d:=jsonb_set(d,'{participants}',participants);
  elsif action in ('candidates','start') then
    if d->>'status'<>'waiting' then raise exception 'Room has already started'; end if;
    if not saantayo_private.valid_candidates(args->'candidates') then raise exception 'Invalid candidates'; end if;
    if action='start' and jsonb_array_length(args->'candidates')=0 then raise exception 'Choose at least one restaurant'; end if;
    d:=jsonb_set(d,'{candidates}',args->'candidates');
    if action='start' then
      select coalesce(jsonb_agg(c),'[]'::jsonb) into candidate from jsonb_array_elements(d->'candidates') c where saantayo_private.candidate_score(c,d->'participants') is not null;
      if jsonb_array_length(candidate)=0 then raise exception 'No restaurants meet everyone''s preferences'; end if;
      d:=d||jsonb_build_object('status','voting','candidates',candidate);
    end if;
  elsif action='restart' then
    select jsonb_agg(jsonb_set(x,'{votes}','{}')) into participants from jsonb_array_elements(d->'participants') x;
    d:=d||jsonb_build_object('status','waiting','winnerId',null,'participants',participants);
  elsif action='remove' then
    if d->>'status'<>'waiting' or args->>'user'=r.host::text then raise exception 'Cannot remove this participant'; end if;
    select jsonb_agg(x) into participants from jsonb_array_elements(d->'participants') x where x->>'id'<>args->>'user';
    d:=jsonb_set(d,'{participants}',participants);
  elsif action='finish' then
    if d->>'status'<>'voting' then raise exception 'Room is not voting'; end if;
    if exists(select 1 from jsonb_array_elements(d->'participants') x cross join jsonb_array_elements(d->'candidates') c where not (x->'votes' ? (c->>'id'))) then raise exception 'Wait for everyone to finish voting'; end if;
    select c->>'id' into winner from jsonb_array_elements(d->'candidates') c
    where saantayo_private.candidate_score(c,d->'participants') is not null
    order by saantayo_private.candidate_score(c,d->'participants') desc,c->>'id' limit 1;
    d:=d||jsonb_build_object('status','finished','winnerId',winner);
  elsif action='select' then
    if d->>'status'<>'finished' then raise exception 'Finish voting first'; end if;
    select x into candidate from jsonb_array_elements(d->'candidates') x where x->>'id'=args->>'restaurant';
    if candidate is null or saantayo_private.candidate_score(candidate,d->'participants') is null then raise exception 'Choose an eligible restaurant'; end if;
    d:=jsonb_set(d,'{winnerId}',to_jsonb(args->>'restaurant'));
  elsif action not in ('read','join') then raise exception 'Unknown room action'; end if;
  if action<>'read' then
    update saantayo_private.rooms set document=d where id=r.id;
    update public.room_events set revision=revision+1 where id=r.id;
  end if;
  -- Private ballots until the host finalizes. Counts are safe progress metadata.
  if d->>'status'<>'finished' then
    select jsonb_agg(x||jsonb_build_object('voteCount',(select count(*) from jsonb_object_keys(x->'votes')),'votes',case when x->>'id'=uid::text then x->'votes' else '{}'::jsonb end)) into participants from jsonb_array_elements(d->'participants') x;
    d:=jsonb_set(d,'{participants}',participants);
  end if;
  return d;
end;
$$;
revoke all on function saantayo_private.room_action(text,jsonb) from public;
grant execute on function saantayo_private.room_action(text,jsonb) to authenticated;
-- Invoker-only exposed wrapper; the private implementation checks identity and membership.
create function public.saantayo_room(action text,args jsonb default '{}') returns jsonb
language sql security invoker set search_path = '' as $$ select saantayo_private.room_action(action,args); $$;
revoke all on function public.saantayo_room(text,jsonb) from public,anon;
grant execute on function public.saantayo_room(text,jsonb) to authenticated;
alter publication supabase_realtime add table public.room_events;

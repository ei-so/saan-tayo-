-- Published base records contain no proposals, private website text, credentials or permission evidence.
create table public.restaurant_records(id text primary key,record jsonb not null,lat double precision not null check(lat between -90 and 90),lng double precision not null check(lng between -180 and 180),updated_at timestamptz not null default now());
alter table public.restaurant_records enable row level security;
revoke all on public.restaurant_records from anon,authenticated;
grant select on public.restaurant_records to anon,authenticated;
create policy public_safe_catalog on public.restaurant_records for select to anon,authenticated using(true);
grant all on public.restaurant_records to service_role;
create index catalog_lat_lng on public.restaurant_records(lat,lng);

create table saantayo_private.website_permissions(
 url text primary key check(url ~ '^https://'),restaurant_id text not null references public.restaurant_records(id),reference text not null check(length(reference)>=8),
 expires_at timestamptz not null,crawl boolean not null default false,reuse boolean not null default false,vendor_processing boolean not null default false,
 revision integer not null check(revision>0),approved_by text not null check(length(approved_by)>0)
);
create table saantayo_private.enrichment_budget(
 week date primary key,jobs integer not null default 0 check(jobs between 0 and 2),firecrawl_calls integer not null default 0 check(firecrawl_calls between 0 and 2),gemini_calls integer not null default 0 check(gemini_calls between 0 and 2),input_tokens integer not null default 0 check(input_tokens between 0 and 20000)
);
create table saantayo_private.enrichment_jobs(
 id uuid primary key default gen_random_uuid(),week date not null,source_url text not null,permission_revision integer not null,
 state text not null default 'reserved' check(state in('reserved','pending_review','failed')),firecrawl_reserved boolean not null default false,gemini_reserved boolean not null default false,
 result jsonb,source_hash text,created_at timestamptz not null default now(),unique(week,source_url,permission_revision)
);
create table saantayo_private.catalog_provenance(place_id text not null references public.restaurant_records(id),source_id text not null,evidence jsonb not null,primary key(place_id,source_id));
create table saantayo_private.search_cache(key text primary key,records jsonb not null,expires_at timestamptz not null);
create table saantayo_private.search_quota(ip_hash text not null check(ip_hash ~ '^[a-f0-9]{64}$'),minute timestamptz not null,hits integer not null,primary key(ip_hash,minute));
alter table saantayo_private.website_permissions enable row level security;
alter table saantayo_private.enrichment_budget enable row level security;
alter table saantayo_private.enrichment_jobs enable row level security;
alter table saantayo_private.catalog_provenance enable row level security;
alter table saantayo_private.search_cache enable row level security;
alter table saantayo_private.search_quota enable row level security;
grant usage on schema saantayo_private to service_role;
grant all on all tables in schema saantayo_private to service_role;
-- Service role only; exposed invoker wrapper cannot confer elevated privileges.
create function saantayo_private.safe_catalog_record(r jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare base jsonb; provenance jsonb;
begin
 if not coalesce(saantayo_private.valid_candidates(jsonb_build_array(r)),false) or r->>'source'='demo' or jsonb_typeof(r->'id')is distinct from 'string' or jsonb_typeof(r->'name')is distinct from 'string' or jsonb_typeof(r->'category')is distinct from 'string' or jsonb_typeof(r->'updatedAt')is distinct from 'string' then raise exception 'Invalid public catalog record';end if;
 select coalesce(jsonb_agg(jsonb_build_object('source',x->'source','sourceId',x->'sourceId','url',x->'url','retrievedAt',x->'retrievedAt','attribution',x->'attribution','confidence',case when jsonb_typeof(x->'confidence')='number' and (x->>'confidence')::numeric between 0 and 1 then x->'confidence'else 'null'::jsonb end)),'[]') into provenance from jsonb_array_elements(coalesce(r->'provenance','[]')) x where x->>'source' in('osm','overture');
 base:=jsonb_build_object('id',r->'id','name',r->'name','category',r->'category','cuisines',case when r->>'moderationStatus'='pending_review' then '[]'::jsonb else r->'cuisines' end,'lat',r->'lat','lng',r->'lng','distance',r->'distance','price',null,'vegetarian',null,'halal',null,'image',null,'source',r->'source','updatedAt',r->'updatedAt','provenance',provenance,'moderationStatus',case when r->>'moderationStatus'='pending_review' then 'pending_review' else 'unreviewed' end);
 if length(r->>'website')<=1000 and r->>'website'~'^https?://' then base:=base||jsonb_build_object('website',r->>'website');end if;
 if length(r->>'sourceURL')<=1000 and r->>'sourceURL'~'^https://' then base:=base||jsonb_build_object('sourceURL',r->>'sourceURL');end if;
 if length(r->>'address')<=300 then base:=base||jsonb_build_object('address',r->>'address');end if;
 if length(r->>'contact')<=80 then base:=base||jsonb_build_object('contact',r->>'contact');end if;
 return base;
end;
$$;
grant execute on function saantayo_private.valid_candidates(jsonb)to service_role;
create function saantayo_private.enforce_safe_catalog()returns trigger language plpgsql security invoker set search_path=''as $$begin
 new.record:=saantayo_private.safe_catalog_record(new.record);new.id:=new.record->>'id';new.lat:=(new.record->>'lat')::double precision;new.lng:=(new.record->>'lng')::double precision;return new;
end;$$;
revoke all on function saantayo_private.enforce_safe_catalog()from public;
grant execute on function saantayo_private.enforce_safe_catalog()to service_role;
create trigger sanitize_public_catalog before insert or update on public.restaurant_records for each row execute function saantayo_private.enforce_safe_catalog();
revoke all on function saantayo_private.safe_catalog_record(jsonb) from public;
grant execute on function saantayo_private.safe_catalog_record(jsonb) to service_role;

-- Extend the pre-existing candidate validator for attributed Overture base data.
create or replace function saantayo_private.valid_candidates(c jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
 if jsonb_typeof(c) is distinct from 'array' or jsonb_array_length(c)>100 or pg_column_size(c)>200000 then return false;end if;
 for item in select * from jsonb_array_elements(c) loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(length(item->>'id'),0) not between 1 and 100 or coalesce(length(item->>'name'),0) not between 1 and 160
   or jsonb_typeof(item->'lat') is distinct from 'number' or jsonb_typeof(item->'lng') is distinct from 'number'
   or (item->>'lat')::numeric not between -90 and 90 or (item->>'lng')::numeric not between -180 and 180
   or jsonb_typeof(item->'distance') is distinct from 'number' or (item->>'distance')::numeric not between 0 and 100000
   or jsonb_typeof(item->'cuisines') is distinct from 'array' or coalesce(item->>'source','') not in('osm','overture','demo') then return false;end if;
  if jsonb_typeof(item->'price') is null or jsonb_typeof(item->'price') not in('null','number') or jsonb_typeof(item->'vegetarian') is null or jsonb_typeof(item->'vegetarian') not in('null','boolean') or jsonb_typeof(item->'halal') is null or jsonb_typeof(item->'halal') not in('null','boolean') or jsonb_array_length(item->'cuisines')>30 then return false;end if;
  if item->>'price' is not null and (item->>'price')::numeric not between 0 and 10000 then return false;end if;
  if exists(select 1 from jsonb_array_elements(item->'cuisines') x where jsonb_typeof(x)<>'string' or length(x #>> '{}')>80)then return false;end if;
 end loop;
 return(select count(*)=count(distinct x->>'id') from jsonb_array_elements(c)x);
end;
$$;

create function saantayo_private.catalog_action(action text,args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb;safe jsonb;result jsonb;permission saantayo_private.website_permissions;job saantayo_private.enrichment_jobs;
 period date:=(date_trunc('week',now() at time zone 'UTC'))::date;minute_now timestamptz:=date_trunc('minute',now());count_now integer;tokens integer;vlat numeric;vlng numeric;radius numeric;
begin
 if current_user<>'service_role' then raise exception 'Server-only catalog operation';end if;
 if pg_column_size(args)>300000 then raise exception 'Request too large';end if;
 if action='nearby' then
  vlat:=(args->>'lat')::numeric;vlng:=(args->>'lng')::numeric;radius:=(args->>'radius')::numeric;
  if vlat is null or vlng is null or radius is null or vlat not between -90 and 90 or vlng not between -180 and 180 or radius<=0 or radius>10 then raise exception 'Invalid location';end if;
  select coalesce(jsonb_agg(x.record),'[]') into result from (select rr.record from public.restaurant_records rr
   where rr.lat between vlat-radius/110.0 and vlat+radius/110.0 and rr.lng between vlng-radius/(110.0*greatest(0.01,cos(radians(vlat)))) and vlng+radius/(110.0*greatest(0.01,cos(radians(vlat))))
   and 6371*2*asin(sqrt(least(1,power(sin(radians(rr.lat-vlat)/2),2)+cos(radians(vlat))*cos(radians(rr.lat))*power(sin(radians(rr.lng-vlng)/2),2))))<=radius
   order by rr.id limit 100)x;return result;
 elsif action='ingest' then
  if jsonb_typeof(args->'records') is distinct from 'array' or jsonb_array_length(args->'records')>100 then raise exception 'Bounded records required';end if;
  for r in select * from jsonb_array_elements(args->'records')loop
   safe:=saantayo_private.safe_catalog_record(r);
   insert into public.restaurant_records(id,record,lat,lng)values(safe->>'id',safe,(safe->>'lat')::double precision,(safe->>'lng')::double precision)
   on conflict(id)do update set record=excluded.record,lat=excluded.lat,lng=excluded.lng,updated_at=now();
   insert into saantayo_private.catalog_provenance(place_id,source_id,evidence)values(safe->>'id',safe->>'id',coalesce(r->'provenance','[]'))on conflict(place_id,source_id)do update set evidence=excluded.evidence;
  end loop;return null;
 elsif action='cache_read' then select records into result from saantayo_private.search_cache where key=args->>'key' and expires_at>now();if result is null then return null;end if;select coalesce(jsonb_agg(saantayo_private.safe_catalog_record(x)),'[]')into safe from jsonb_array_elements(result)x;return safe;
 elsif action='cache_write' then
  if jsonb_typeof(args->'records') is distinct from 'array' or jsonb_array_length(args->'records')>100 then raise exception 'Bounded records required';end if;
  select coalesce(jsonb_agg(saantayo_private.safe_catalog_record(x)),'[]')into safe from jsonb_array_elements(args->'records')x;
  delete from saantayo_private.search_cache where expires_at<now();
  insert into saantayo_private.search_cache(key,records,expires_at)values(args->>'key',safe,now()+interval '5 minutes')on conflict(key)do update set records=excluded.records,expires_at=excluded.expires_at;return null;
 elsif action='search_quota' then
  if coalesce(args->>'hash','')!~'^[a-f0-9]{64}$'then raise exception 'Hashed IP required';end if;
  delete from saantayo_private.search_quota where minute<minute_now-interval '2 minutes';
  insert into saantayo_private.search_quota(ip_hash,minute,hits)values(args->>'hash',minute_now,1)on conflict(ip_hash,minute)do update set hits=saantayo_private.search_quota.hits+1 returning hits into count_now;return to_jsonb(count_now<=12);
 elsif action='permissions' then
  select coalesce(jsonb_agg(to_jsonb(p)),'[]')into result from (select * from saantayo_private.website_permissions where crawl and reuse and vendor_processing and expires_at>now() order by url limit 20)p;return result;
 elsif action='claim' then
  select * into permission from saantayo_private.website_permissions where url=args->>'url' and revision=(args->>'revision')::integer and crawl and reuse and vendor_processing and expires_at>now()for share;
  if permission.url is null then return null;end if;
  insert into saantayo_private.enrichment_budget(week)values(period)on conflict do nothing;
  perform 1 from saantayo_private.enrichment_budget where week=period for update;
  if exists(select 1 from saantayo_private.enrichment_jobs where week=period and source_url=permission.url and permission_revision=permission.revision)then return null;end if;
  update saantayo_private.enrichment_budget set jobs=jobs+1 where week=period and jobs<2 returning jobs into count_now;
  if count_now is null then return null;end if;
  insert into saantayo_private.enrichment_jobs(week,source_url,permission_revision)values(period,permission.url,permission.revision)returning * into job;return jsonb_build_object('id',job.id);
 elsif action='reserve_call' then
  select * into job from saantayo_private.enrichment_jobs where id=(args->>'job')::uuid for update;
  if job.id is null or job.state<>'reserved' or job.week<>period then return 'false';end if;
  if not exists(select 1 from saantayo_private.website_permissions where url=job.source_url and revision=job.permission_revision and expires_at>now() and crawl and reuse and vendor_processing)then return 'false';end if;
  if args->>'provider'='firecrawl' and not job.firecrawl_reserved then
   update saantayo_private.enrichment_budget set firecrawl_calls=firecrawl_calls+1 where week=period and firecrawl_calls<2 returning firecrawl_calls into count_now;
   if count_now is null then return 'false';end if;
   update saantayo_private.enrichment_jobs set firecrawl_reserved=true where id=job.id;return 'true';
  elsif args->>'provider'='gemini' and job.firecrawl_reserved and not job.gemini_reserved then
   tokens:=(args->>'tokens')::integer;if tokens is null or tokens<=0 or tokens>10000 then return 'false';end if;
   update saantayo_private.enrichment_budget set gemini_calls=gemini_calls+1,input_tokens=input_tokens+tokens where week=period and gemini_calls<2 and input_tokens+tokens<=20000 returning gemini_calls into count_now;
   if count_now is null then return 'false';end if;
   update saantayo_private.enrichment_jobs set gemini_reserved=true where id=job.id;return 'true';
  end if;return 'false';
 elsif action='finish_job' then
  select * into job from saantayo_private.enrichment_jobs where id=(args->>'job')::uuid for update;
  if job.id is null or job.state<>'reserved' or not job.gemini_reserved or args->'result'->>'status'<>'pending_review' then raise exception 'Invalid pending result';end if;
  update saantayo_private.enrichment_jobs set state='pending_review',result=args->'result',source_hash=args->>'source_hash' where id=job.id;return null;
 elsif action='fail_job' then update saantayo_private.enrichment_jobs set state='failed' where id=(args->>'job')::uuid and state='reserved';return null;
 end if;raise exception 'Unknown catalog action';
end;
$$;
revoke all on function saantayo_private.catalog_action(text,jsonb)from public,anon,authenticated;
grant execute on function saantayo_private.catalog_action(text,jsonb)to service_role;
create function public.saantayo_catalog(action text,args jsonb default '{}')returns jsonb language sql security invoker set search_path='' as $$select saantayo_private.catalog_action(action,args);$$;
revoke all on function public.saantayo_catalog(text,jsonb)from public,anon,authenticated;
grant execute on function public.saantayo_catalog(text,jsonb)to service_role;

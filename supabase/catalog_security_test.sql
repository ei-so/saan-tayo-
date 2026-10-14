begin;
set local role service_role;
do $$
declare record jsonb:='{"id":"overture:test","name":"Fictional SQL fixture","category":"restaurant","lat":15,"lng":120.65,"distance":0,"price":120,"vegetarian":true,"halal":true,"image":"https://private.example","cuisines":["filipino"],"source":"overture","updatedAt":"2026-10-15","moderationStatus":"pending_review","privateSourceText":"secret","provenance":[]}';
 result jsonb;job jsonb;second jsonb;i integer;denied boolean;
begin
 perform public.saantayo_catalog('ingest',jsonb_build_object('records',jsonb_build_array(record)));
 result:=public.saantayo_catalog('nearby','{"lat":15,"lng":120.65,"radius":3}');
 assert jsonb_array_length(result)=1,'Nearby missing';
 assert result->0->'price'='null'::jsonb and result->0->'halal'='null'::jsonb and result->0->'cuisines'='[]'::jsonb and not(result->0 ? 'privateSourceText'),'Pending data leaked';
 perform public.saantayo_catalog('cache_write',jsonb_build_object('key','test','records',jsonb_build_array(record)));
 result:=public.saantayo_catalog('cache_read','{"key":"test"}');assert result->0->'price'='null'::jsonb,'Cached pending price leaked';
 for i in 1..12 loop assert public.saantayo_catalog('search_quota',jsonb_build_object('hash',repeat('a',64)))='true'::jsonb,'Early throttle';end loop;
 assert public.saantayo_catalog('search_quota',jsonb_build_object('hash',repeat('a',64)))='false'::jsonb,'Quota exceeded';
 insert into saantayo_private.website_permissions(url,restaurant_id,reference,expires_at,crawl,reuse,vendor_processing,revision,approved_by)values
 ('https://fictional.example/menu','overture:test','FICTIONAL TEST permission',now()+interval '1 day',true,true,true,1,'test'),
 ('https://fictional2.example/menu','overture:test','FICTIONAL TEST permission',now()+interval '1 day',true,true,true,1,'test'),
 ('https://fictional3.example/menu','overture:test','FICTIONAL TEST permission',now()+interval '1 day',true,true,true,1,'test'),
 ('https://expired.example/menu','overture:test','FICTIONAL TEST permission',now()-interval '1 day',true,true,true,1,'test');
 assert public.saantayo_catalog('claim','{"url":"https://expired.example/menu","revision":1}')is null,'Expired approval usable';
 job:=public.saantayo_catalog('claim','{"url":"https://fictional.example/menu","revision":1}');assert job is not null,'First claim missing';
 assert public.saantayo_catalog('claim','{"url":"https://fictional.example/menu","revision":1}')is null,'Duplicate claim allowed';
 assert public.saantayo_catalog('reserve_call',jsonb_build_object('job',job->>'id','provider','firecrawl','tokens',0))='true'::jsonb,'Firecrawl reservation denied';
 assert public.saantayo_catalog('reserve_call',jsonb_build_object('job',job->>'id','provider','firecrawl','tokens',0))='false'::jsonb,'Double firecrawl spend';
 assert public.saantayo_catalog('reserve_call',jsonb_build_object('job',job->>'id','provider','gemini','tokens',10001))='false'::jsonb,'Excessive input accepted';
 assert public.saantayo_catalog('reserve_call',jsonb_build_object('job',job->>'id','provider','gemini','tokens',7000))='true'::jsonb,'Gemini reservation denied';
 perform public.saantayo_catalog('fail_job',jsonb_build_object('job',job->>'id'));
 assert public.saantayo_catalog('claim','{"url":"https://fictional.example/menu","revision":1}')is null,'Uncertain failed job retried';
 second:=public.saantayo_catalog('claim','{"url":"https://fictional2.example/menu","revision":1}');assert second is not null,'Second job denied';
 assert public.saantayo_catalog('claim','{"url":"https://fictional3.example/menu","revision":1}')is null,'Third weekly job allowed';
 update saantayo_private.website_permissions set revision=2 where url='https://fictional2.example/menu';
 assert public.saantayo_catalog('reserve_call',jsonb_build_object('job',second->>'id','provider','firecrawl','tokens',0))='false'::jsonb,'Revoked permission spend allowed';
 execute 'reset role';execute 'set local role anon';
 assert (select count(*) from public.restaurant_records)=1,'Public safe catalog unavailable';
 denied:=false;begin perform public.saantayo_catalog('permissions');exception when insufficient_privilege then denied:=true;end;assert denied,'Anonymous private permissions exposed';
 denied:=false;begin execute 'insert into public.restaurant_records select * from public.restaurant_records';exception when insufficient_privilege then denied:=true;end;assert denied,'Anonymous catalog write allowed';
 execute 'reset role';
end;
$$;
rollback;

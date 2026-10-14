# Disposable local database only, with both migrations already applied. No network/vendor calls.
param([string]$Database='saantayo_pipeline_check',[int]$Port=55439)
$ErrorActionPreference='Stop'
$psqlPath='C:/Program Files/PostgreSQL/16/bin/psql.exe'
$testDirectory=Join-Path $env:TEMP ('saantayo-concurrency-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDirectory | Out-Null
$fixture=@'
set role service_role;
select public.saantayo_catalog('ingest','{"records":[{"id":"overture:concurrency-fixture","name":"FICTIONAL CONCURRENCY FIXTURE","category":"restaurant","lat":15,"lng":120.65,"distance":0,"price":null,"vegetarian":null,"halal":null,"image":null,"cuisines":[],"source":"overture","updatedAt":"2026-10-15","provenance":[]}]}');
insert into saantayo_private.website_permissions(url,restaurant_id,reference,expires_at,crawl,reuse,vendor_processing,revision,approved_by)
select 'https://fictional-concurrency-'||i||'.invalid/menu','overture:concurrency-fixture','FICTIONAL TEST ONLY',now()+interval '1 day',true,true,true,1,'regression' from generate_series(1,3)i;
'@
$fixture | & $psqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'Fixture setup failed'}
$worker=@'
set role service_role;
do $$
declare i integer;j jsonb;job_id uuid;
begin
 for i in 1..100 loop
  j:=public.saantayo_catalog('claim',jsonb_build_object('url','https://fictional-concurrency-'||(i%3+1)||'.invalid/menu','revision',1));
  if j is not null then perform pg_sleep(0.02);end if;
  for job_id in select id from saantayo_private.enrichment_jobs loop
   perform public.saantayo_catalog('reserve_call',jsonb_build_object('job',job_id,'provider','firecrawl','tokens',0));
   perform public.saantayo_catalog('reserve_call',jsonb_build_object('job',job_id,'provider','gemini','tokens',9000));
  end loop;
 end loop;
end;$$;
'@
# Each worker commits independently: the second session competes for the same week's locks.
$workerPath=Join-Path $testDirectory 'worker.sql';Set-Content -LiteralPath $workerPath -Value $worker
$processes=1..2 | ForEach-Object {
 Start-Process -FilePath $psqlPath -WindowStyle Hidden -ArgumentList @('-h','127.0.0.1','-p',"$Port",'-U','postgres','-d',$Database,'-v','ON_ERROR_STOP=1','-f',$workerPath) -RedirectStandardOutput (Join-Path $testDirectory "worker$_.log") -RedirectStandardError (Join-Path $testDirectory "worker$_.err") -PassThru
}
$processes | Wait-Process
foreach($process in $processes){$process.Refresh();if($process.ExitCode -ne 0){Get-Content (Join-Path $testDirectory '*.err');throw 'Concurrent worker failed'}}
$assertions=@'
do $$begin
 assert (select count(*)from saantayo_private.enrichment_jobs)=2,'Concurrent weekly jobs exceeded or missing';
 assert (select jobs=2 and firecrawl_calls=2 and gemini_calls=2 and input_tokens=18000 from saantayo_private.enrichment_budget limit 1),'Concurrent budget invariant failed';
 assert (select count(*)from saantayo_private.enrichment_jobs where firecrawl_reserved and gemini_reserved)=2,'Duplicate provider reservation';
end;$$;
select jobs,firecrawl_calls,gemini_calls,input_tokens from saantayo_private.enrichment_budget;
'@
$assertions | & $psqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1
if($LASTEXITCODE -ne 0){throw 'Concurrency assertions failed'}
Write-Output 'PASS: two SQL sessions, 200 competing claims, exactly 2 jobs and 2 calls per provider.'

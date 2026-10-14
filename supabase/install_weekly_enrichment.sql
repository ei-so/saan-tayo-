-- INACTIVE INSTALLER. Not a migration. Do not run without explicit schedule approval.
-- Requires pg_cron, pg_net and Vault configured by an administrator; does not install extensions.
-- Provision Vault secrets saantayo_enrichment_endpoint and saantayo_enrichment_job_secret manually.
-- Set saantayo.enable_weekly_job to 'true' in the installation session only after approval.
do $$
begin
 if current_setting('saantayo.enable_weekly_job',true) is distinct from 'true' then raise exception 'Weekly scheduling has not been explicitly enabled';end if;
 if not exists(select 1 from saantayo_private.website_permissions where crawl and reuse and vendor_processing and expires_at>now())then raise exception 'No approved websites; schedule remains inactive';end if;
 if not exists(select 1 from vault.decrypted_secrets where name='saantayo_enrichment_endpoint' and decrypted_secret ~ '^https://[^/]+/api/enrich$')or not exists(select 1 from vault.decrypted_secrets where name='saantayo_enrichment_job_secret' and length(decrypted_secret)>=32)then raise exception 'Approved HTTPS endpoint and strong job secret required';end if;
 perform cron.schedule('saantayo-weekly-enrichment','0 2 * * 1',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='saantayo_enrichment_endpoint'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='saantayo_enrichment_job_secret')),
  body:='{}'::jsonb
 );
 $job$);
end;
$$;

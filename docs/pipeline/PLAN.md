# Bacolor discovery and enrichment implementation

User authorizes implementing the specified stack while preserving all existing features. No production deployment, active Cron, paid billing or bulk import. Default pilot at most 20 places. Bacolor bbox: 120.64,14.985,120.665,15.01. Bbox area cap 0.02 square degrees and output cap 100 unless explicitly approved.

## Shared contracts

server/places.ts exports PlaceRecord extending Restaurant, with provenance: {source:'osm'|'overture',sourceId:string,url:string,retrievedAt:string,attribution:string,confidence:number|null}[] and moderationStatus:'unreviewed'|'pending_review'|'approved'|'rejected'. Exports fromRestaurant(r), normalizeOverture(raw,retrievedAt?), deduplicatePlaces(records). source union includes overture, added in src/domain.ts by root. Dedup uses stable IDs, names, coordinates and addresses, never silently combines distinct branches or drops conflicting facts.

server/catalog.ts exports readNearby(lat,lng,radius):Promise<PlaceRecord[]> and ingestPlaces(records):Promise<void>. Unconfigured read returns []; configured failure throws. Search never calls Firecrawl or Gemini. Safe cached output excludes all pending AI facts; prices and dietary hard constraints remain unknown until human approval.

server/evidence.ts exports extractionSchema and validateExtraction(output,sourceText):{claims:unknown,issues:string[],status:'pending_review'}. Every claimed cuisine, menu item, price, opening hour and dietary fact needs exact supporting source text; semantic ambiguity is rejected or pending. Quote presence alone does not validate unrelated values, negated dietary claims, currencies or price units. No automatic AI approval.

api/enrich.ts invokes server/enrichment.ts, is protected by server-only ENRICHMENT_JOB_SECRET and ENRICHMENT_ENABLED=false by default. Credentials: SUPABASE_URL, SUPABASE_SECRET_KEY, FIRECRAWL_API_KEY, GEMINI_API_KEY. Default 2 jobs/week, persisted atomic call quotas and idempotency keys. Exact approved website URLs require a documented permission reference, expiry, safe HTTPS/DNS and robots allowance. No deep crawling, no following unapproved redirects. Gemini exact model gemini-3.5-flash-lite structured schema. Weekly Monday02UTC Supabase Cron installer is separate and inactive until explicitly run. Uncertain failed paid attempts consume quota and do not retry automatically.

## Ownership and verification

Places task: normalization/dedup tests, bounded current-taxonomy Python importer, actual small OSM/Overture pilot and source attribution. Query remote GeoParquet with predicate pushdown; no full-dataset download. No paid calls.

Backend task: new migration and SQL tests, catalog, evidence validation, Firecrawl/Gemini clients, protected job endpoint, permission records, quotas, idempotency and inactive weekly Cron SQL. Server-only writes, RLS on exposed tables, public-safe reads. Local Postgres regression, no cloud writes.

Root task: discovery cache/catalog merge, durable rate-limit integration, metadata UI and domain compatibility, package/docs, full test/build/browser checks. Existing source reference files stay untouched. Review concurrency, cross-branch dedup, negation, invented excerpt/value, SSRF, robots, failures, quota exhaustion, unknown facts and absent credentials.

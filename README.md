# SaanTayo?

## Bacolor discovery and enrichment pipeline

Nearby search merges live OSM with the Supabase catalog and a five-minute shared cache when server credentials are configured. It never calls Firecrawl or Gemini. All AI results remain private pending review; unknown or unreviewed prices and dietary claims cannot become verified matching constraints. Source attribution, retrieval dates, provider confidence and review status appear in place details.

Read [pipeline setup](docs/pipeline/SETUP.md), [backend permission and quota rules](docs/pipeline/BACKEND.md), and [the actual 20-record Bacolor pilot](docs/pipeline/PILOT.md). Migrations and a separate inactive weekly Cron installer are included. No business website is currently approved; `ENRICHMENT_ENABLED=false` keeps all crawling and paid extraction off.

A responsive barkada restaurant decision PWA, initially focused on Bacolor, Pampanga. Paper, charcoal and orange Shared Menu design. Local demo works without keys; its venues are fictional and clearly marked. OSM discovery uses real mapped venues with unknown prices and diets honestly retained.

## Run and verify

Node 22+ is recommended. Run `npm ci`, `npm test`, then `npm run dev`. `npm run build` checks types and creates `dist`. The development server also serves `/api/discover`, so live searches work locally when the map providers are reachable. Production API hosting uses Vercel. The local demo remains usable without network access.

## Optional online rooms

No Supabase or Vercel project has been created or deployed by this implementation. Online mode is off by default. When an authorized Supabase project exists:

1. Apply `supabase/migrations/20261014153422_rooms.sql` with Supabase migrations. Enable anonymous sign-ins in Auth. Add CAPTCHA and suitable anonymous-auth limits before public launch; a guest loses access after clearing browser storage or signing out.
2. Configure the publishable key and project URL using `.env.example`. Never put a secret or service-role key in `VITE_*` variables.
3. Set `VITE_ENABLE_ONLINE=true` only for the intended environment. For Vercel previews explicitly set `VITE_DEPLOYMENT_ENV=preview` and keep `VITE_ALLOW_PREVIEW_ONLINE=false`; enable only with a separate test Supabase project. Build-time flags cannot detect an incorrectly configured preview environment.
4. Validate the migration, RLS, anonymous authentication and realtime with two actual browser sessions before enabling public access. Run Supabase database security advisors. Review private-schema API exposure and keep `saantayo_private` out of the Data API exposed schema list.

Only members can read snapshots. Only the host can replace candidates, start, finish, restart, cancel or remove a guest. Guests update their own preferences and votes. Private ballots are withheld until results are finalized, with progress counts exposed separately. Votes are locked after finish; finishing waits for complete ballots. Candidate eligibility and weighted ranking are checked server-side. Hosts can confirm an eligible alternative after finish. Realtime carries revision IDs, never private ballots; polling repairs disconnect gaps. Limits: 12 guests, 100 candidates, 10 rooms per host per hour. Invitation codes grant join access, so share privately. Automatic expiry and moderation are not implemented; admins should establish retention and anonymous-user cleanup before launch.

## Map data and images

`GET /api/discover?lat=14.9966&lng=120.6514&radius=3` queries Overpass around the requested point, including restaurants, food courts, fast food, cafes, ice cream, bakeries and food-tagged stalls. Radius must be positive and no greater than 10 km. A query returns up to 150 mapped elements; incomplete provider results fail visibly. OSM may omit vendors or outdated venues. Prices, opening status, diets and availability need verification with the venue.

Map data: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Search uses [Overpass](https://overpass-api.de/). API cache lasts five minutes; duplicate concurrent searches share a request; throttling permits 12 requests per minute per IP per warm instance. These in-memory protections reset on cold starts and do not enforce a global quota: configure Vercel Firewall or a shared limiter before high-traffic public launch. Provider failures never switch to fictional restaurants.

On network failure or upstream server errors, search tries one alternative public instance, [Private Coffee](https://overpass.private.coffee/), listed in the [OSM Overpass instance directory](https://wiki.openstreetmap.org/wiki/Overpass_API). Each request times out after 25 seconds; at most two provider requests occur. A 429 or 406 stops immediately without trying another provider. Public providers are shared community resources; production commercial traffic needs an appropriate self-hosted or paid provider and enforced shared quotas.

OSM image fields are not sufficient evidence of reuse permission. Live photos currently remain absent; restaurant initials are a deliberate placeholder. Add only venue-approved or verified openly licensed photos, including source, author and attribution. Do not treat illustrative food photos as photos of a specific restaurant.

## Deployment

Import the GitHub repository into the authorized Vercel team, select Vite and use the supplied `vercel.json`. If the source is stored under `app/`, set that as the Root Directory. Add environment variables separately by environment; no secrets are committed. Deploy only after reviewing local validation and online integration checks. Vercel HTTPS supports installation and geolocation. The PWA caches the app shell, not live restaurant freshness or online room snapshots. Local history stays in the current browser.

The current implementation has local tests and build checks; it has not been verified against a live Supabase database, live Vercel deployment, or production multi-device authentication.

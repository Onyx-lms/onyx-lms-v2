# Where this runs, and why it matters

`vercel.json` pins the functions to **`bom1` (Mumbai)**. That is not a
preference; it is where the database is.

The Supabase project's pooler is `aws-0-ap-south-1.pooler.supabase.com` —
Mumbai. The functions used to run in `sin1` (Singapore), so every single query
crossed the Bay of Bengal and came back: roughly 50ms each way, paid once per
query rather than once per request. A page that makes eight queries in series
paid it eight times, and the measured floor on even the smallest API call —
`GET /sections`, returning 4kb — was over 300ms with almost none of it spent
reading anything.

Two rules follow from that, and both are easy to break by accident:

1. **If the Supabase project moves region, this must move with it.** The two
   are a pair. A database migrated to Frankfurt with the functions left in
   Mumbai would be slower than either arrangement is today, and nothing would
   fail — it would just get worse, everywhere, at once.

2. **Do not add a second region.** Multiple regions sound faster and are not:
   the read still has to reach Mumbai, so a function in São Paulo serves a page
   by making its queries across the Atlantic and the Indian Ocean. One region,
   next to the data, is the arrangement that wins.

It also happens to be near the people using this — the institutions on the
platform are in Hyderabad — so the same choice shortens the browser's own
round trip. That is a bonus rather than the reason.

## Measuring it again

`node --env-file=.env qa-live/latency-report.mjs` walks the product as every
role and prints the slowest screens first. It reports the median of three runs,
and the cold first separately, because a serverless function's first call in a
while pays a start-up cost that is real but is not the page's speed.

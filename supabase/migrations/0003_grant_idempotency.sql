-- A payment webhook can be, and eventually will be, delivered more than
-- once for the same purchase. Nothing about the grants table so far stops a
-- repeat delivery from minting a second grant: cash and rewind packs stack,
-- so a replayed webhook would hand the same $50,000 out twice.
--
-- `external_id` is that purchase's outside id (a Stripe event id, so far -
-- nothing here is Stripe-specific about the column itself), and the unique
-- index turns a second insert of the same one into a no-op via PostgREST's
-- `Prefer: resolution=ignore-duplicates`, rather than a race the caller has
-- to guard against by hand.

alter table public.grants add column if not exists external_id text;

create unique index if not exists grants_external_id_uniq
  on public.grants (external_id)
  where external_id is not null;

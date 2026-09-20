-- The grant ceiling was a billion, which a late game desk passes on its own.
-- Asking for more than that got the raw Postgres constraint name thrown at
-- the owner, which reads like a bug rather than a limit.
--
-- The ceiling is still there, and still the point: it is what stops a
-- mistyped amount landing in somebody's account. It is just set somewhere a
-- deliberate grant will not hit. Nothing here is real currency.

alter table public.grants drop constraint if exists amount_sane;

alter table public.grants add constraint amount_sane
  check (amount is null or (amount >= 0 and amount <= 1000000000000000));

-- Levels join the list of things an owner can hand out.
--
-- Raising only, which is what the progression model supports: levels are
-- reached by earning the XP for them, and reaching one fires its reward and
-- its unlock. There is no matching way down, because taking a level back
-- would mean taking unlocks back with it, and a half unlocked desk is a
-- worse thing to hand somebody than a high one.

alter table public.grants drop constraint if exists grants_kind_check;

alter table public.grants add constraint grants_kind_check
  check (kind in ('cash', 'rewinds', 'pass', 'vip', 'level'));

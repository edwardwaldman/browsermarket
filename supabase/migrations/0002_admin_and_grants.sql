-- Owner controls.
--
-- Two things that must not be confused. Unlocking features in your own save is
-- a local toy: this is a single player game, anybody could edit their own save
-- anyway, and nothing on the server changes. Handing cash to another account is
-- a real privilege and is enforced here, in the database, because a check in
-- the browser is a suggestion to anybody who opens the console.
--
-- Money is never written into somebody else's save blob. An admin writes a
-- grant row; that player's client claims it on next load. The grant is the
-- audit trail, and a corrupt write cannot destroy a save that way.

-- ── who is an owner ──────────────────────────────────────────────────────
-- Data rather than a hardcoded address, so a second owner is an insert.
create table if not exists public.admin_emails (
  email     text primary key,
  added_at  timestamptz not null default now()
);

-- No policies at all, deliberately. With RLS on and nothing granted, the
-- anon and authenticated roles cannot read a row of this, so the list of who
-- has power is not published to the client. Only the security definer
-- functions below can see it.
alter table public.admin_emails enable row level security;

insert into public.admin_emails (email) values ('edwardwaldman@proton.me')
  on conflict (email) do nothing;

alter table public.profiles add column if not exists is_admin boolean not null default false;

-- ── the admin test ───────────────────────────────────────────────────────
-- security definer so it can read profiles without re-entering the policies
-- that call it, which would recurse forever.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ── grants ───────────────────────────────────────────────────────────────
create table if not exists public.grants (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  kind        text        not null check (kind in ('cash', 'rewinds', 'pass', 'vip')),
  amount      numeric,
  item        text,
  note        text,
  granted_by  uuid        references auth.users (id),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  constraint amount_sane check (amount is null or (amount >= 0 and amount <= 1000000000)),
  constraint note_len check (note is null or char_length(note) <= 200)
);

create index if not exists grants_user_idx on public.grants (user_id, claimed_at);

alter table public.grants enable row level security;

drop policy if exists "read own grants"   on public.grants;
drop policy if exists "claim own grants"  on public.grants;
drop policy if exists "admin reads grants" on public.grants;
drop policy if exists "admin makes grants" on public.grants;

create policy "read own grants" on public.grants
  for select using (auth.uid() = user_id);

-- A player may only mark their own grant claimed. The trigger below stops the
-- update touching anything else, so this cannot be used to mint a larger one.
create policy "claim own grants" on public.grants
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "admin reads grants" on public.grants
  for select using (public.is_admin());

create policy "admin makes grants" on public.grants
  for insert with check (public.is_admin() and granted_by = auth.uid());

-- A claim sets the timestamp and nothing else. Without this the update policy
-- above would let somebody rewrite their own grant's amount before claiming it.
create or replace function public.freeze_claimed_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if old.claimed_at is not null then
    raise exception 'That grant is already claimed';
  end if;
  -- Everything but the claim stamp is put back to what it was.
  new.user_id    := old.user_id;
  new.kind       := old.kind;
  new.amount     := old.amount;
  new.item       := old.item;
  new.note       := old.note;
  new.granted_by := old.granted_by;
  new.created_at := old.created_at;
  new.claimed_at := now();
  return new;
end;
$$;

drop trigger if exists grants_freeze on public.grants;
create trigger grants_freeze before update on public.grants
  for each row execute function public.freeze_claimed_grant();

-- ── an owner can see who is playing ──────────────────────────────────────
drop policy if exists "admin reads profiles" on public.profiles;
create policy "admin reads profiles" on public.profiles
  for select using (public.is_admin());

-- Read only. An owner can look at a save to help with a problem, and cannot
-- overwrite one: grants are the supported way to change somebody's account.
drop policy if exists "admin reads saves" on public.cloud_saves;
create policy "admin reads saves" on public.cloud_saves
  for select using (public.is_admin());

-- ── seeding ──────────────────────────────────────────────────────────────
-- Extends the signup hook so an owner who has not registered yet becomes one
-- the moment they do, without anybody having to remember.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, is_admin)
  values (
    new.id,
    exists (select 1 from public.admin_emails a where lower(a.email) = lower(new.email))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- And anyone already registered gets it now.
update public.profiles p
   set is_admin = true
  from auth.users u
 where u.id = p.id
   and exists (select 1 from public.admin_emails a where lower(a.email) = lower(u.email))
   and p.is_admin is distinct from true;

-- ── functions are not an API ─────────────────────────────────────────────
-- PostgREST exposes every function in the public schema as an RPC, so a
-- trigger function is callable directly by anyone holding the publishable key.
-- They still run inside their triggers, which execute as the table owner.
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.bump_save_revision() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.freeze_claimed_grant() from public, anon, authenticated;

-- is_admin stays callable by a signed-in user on purpose: it reports only
-- whether the caller themselves is an owner.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

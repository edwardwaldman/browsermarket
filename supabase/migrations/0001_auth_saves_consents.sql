-- Browser Stock Exchange: accounts, cloud saves and the consent record.
--
-- Three tables, all of them owned by the user they describe and none of them
-- readable by anybody else. Every policy is written against auth.uid(), so a
-- leaked publishable key gets an attacker exactly nothing: it can create a
-- session for an address they control and read that account's own rows.

-- ── profiles ─────────────────────────────────────────────────────────────
-- One row per account. The consent columns are the current state; the audit
-- trail of how it got there lives in consent_events.
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  display_name          text,
  marketing_opt_in      boolean     not null default false,
  marketing_opt_in_at   timestamptz,
  terms_version         text,
  terms_accepted_at     timestamptz,
  privacy_version       text,
  privacy_accepted_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint display_name_len check (display_name is null or char_length(display_name) <= 40)
);

-- ── cloud saves ──────────────────────────────────────────────────────────
-- One save per account. `revision` is bumped by the trigger below so two
-- devices writing at once cannot silently lose the loser's progress: the
-- client keeps the revision it last read and refuses to overwrite a newer one.
create table if not exists public.cloud_saves (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  payload          jsonb       not null,
  revision         bigint      not null default 1,
  net_worth        numeric,
  level            integer,
  client_saved_at  timestamptz,
  updated_at       timestamptz not null default now(),
  -- A save is a game state, not a file host. 2MB is far more than the real
  -- payload needs and stops the table being used as free storage.
  constraint payload_size check (pg_column_size(payload) < 2 * 1024 * 1024)
);

-- ── consent events ───────────────────────────────────────────────────────
-- Append only. A record of what was agreed to and when is the point of it, so
-- there is deliberately no update or delete policy: nobody can rewrite it,
-- including the user it belongs to.
create table if not exists public.consent_events (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  kind        text        not null check (kind in ('terms', 'privacy', 'marketing_opt_in', 'marketing_opt_out')),
  version     text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists consent_events_user_idx on public.consent_events (user_id, created_at desc);

-- ── row level security ───────────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.cloud_saves    enable row level security;
alter table public.consent_events enable row level security;

drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "insert own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
create policy "read own profile"   on public.profiles for select using  (auth.uid() = id);
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "update own profile" on public.profiles for update using  (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "read own save"   on public.cloud_saves;
drop policy if exists "write own save"  on public.cloud_saves;
drop policy if exists "update own save" on public.cloud_saves;
drop policy if exists "delete own save" on public.cloud_saves;
create policy "read own save"   on public.cloud_saves for select using  (auth.uid() = user_id);
create policy "write own save"  on public.cloud_saves for insert with check (auth.uid() = user_id);
create policy "update own save" on public.cloud_saves for update using  (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own save" on public.cloud_saves for delete using  (auth.uid() = user_id);

drop policy if exists "read own consents"  on public.consent_events;
drop policy if exists "write own consents" on public.consent_events;
create policy "read own consents"  on public.consent_events for select using (auth.uid() = user_id);
create policy "write own consents" on public.consent_events for insert with check (auth.uid() = user_id);
-- No update or delete policy on consent_events, on purpose.

-- ── triggers ─────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- The revision is server side so a client cannot claim to be newer than it is.
create or replace function public.bump_save_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.revision   := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

drop trigger if exists cloud_saves_bump on public.cloud_saves;
create trigger cloud_saves_bump before update on public.cloud_saves
  for each row execute function public.bump_save_revision();

-- A profile row the moment the account exists, so the client never has to
-- guess whether one is there before it can record a consent against it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

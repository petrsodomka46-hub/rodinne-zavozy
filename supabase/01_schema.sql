-- Rodinné závozy – databázové schéma.
-- Spusťte celé v Supabase: SQL Editor → New query → vložit → Run.

-- Členové rodiny (propojení přihlášeného uživatele s rolí).
create table if not exists public.members (
  id    uuid primary key references auth.users(id) on delete cascade,
  key   text unique not null,
  role  text not null check (role in ('parent', 'child'))
);

-- Jízdy: jeden řádek = jedna cesta jednoho dítěte.
create table if not exists public.rides (
  id           uuid primary key default gen_random_uuid(),
  child_id     uuid not null references public.members(id) on delete cascade,
  ride_date    date not null,
  ride_time    time not null,
  -- school_* = škola, activity_* = kroužek, other_* = ostatní (místo vyplní dítě)
  kind         text not null,
  place        text not null default '',
  -- need = potřebuje odvoz od rodiče, parent = veze rodič (driver_id),
  -- walk = pěšky, bike = na kole, scooter = na skútru, bus = autobus/MHD,
  -- other = s jiným rodičem (other_name)
  mode         text not null default 'need',
  driver_id    uuid references public.members(id) on delete set null,
  other_name   text,
  note         text,
  series_id    uuid,
  cancelled    boolean not null default false,
  created_by   uuid references public.members(id) on delete set null,
  updated_by   uuid references public.members(id) on delete set null,
  confirmed_by uuid references public.members(id) on delete set null,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.rides drop constraint if exists rides_kind_check;
alter table public.rides add constraint rides_kind_check check (kind in (
  'school_to', 'school_from', 'activity_to', 'activity_from', 'other_to', 'other_from'));

alter table public.rides drop constraint if exists rides_mode_check;
alter table public.rides add constraint rides_mode_check check (mode in (
  'need', 'parent', 'walk', 'bike', 'scooter', 'bus', 'other'));

create index if not exists rides_date_idx on public.rides (ride_date, ride_time);

-- Pomocné funkce pro oprávnění.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where id = auth.uid());
$$;

create or replace function public.is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where id = auth.uid() and role = 'parent');
$$;

-- Pravidla pro děti: mohou zadávat a měnit jen své jízdy, nemohou si samy
-- přiřadit rodiče a jakákoli podstatná změna ruší potvrzení rodiče.
create or replace function public.rides_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed boolean;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;

  if public.is_parent() then
    return new;
  end if;

  if new.child_id is distinct from auth.uid() then
    raise exception 'Můžeš zadávat jen své vlastní jízdy.';
  end if;

  if tg_op = 'INSERT' then
    if new.mode = 'parent' then new.mode := 'need'; end if;
    new.driver_id := null;
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.cancelled := false;
    return new;
  end if;

  changed := (new.ride_date, new.ride_time, new.kind, new.place, new.mode, coalesce(new.other_name, ''))
    is distinct from (old.ride_date, old.ride_time, old.kind, old.place, old.mode, coalesce(old.other_name, ''));

  if changed then
    if new.mode = 'parent' then new.mode := 'need'; end if;
    new.driver_id := null;
    new.confirmed_by := null;
    new.confirmed_at := null;
  else
    new.mode := old.mode;
    new.driver_id := old.driver_id;
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists rides_guard on public.rides;
create trigger rides_guard before insert or update on public.rides
  for each row execute function public.rides_guard();

-- Řízení přístupu: data vidí jen členové rodiny.
alter table public.members enable row level security;
alter table public.rides   enable row level security;

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (public.is_member());

drop policy if exists rides_read on public.rides;
create policy rides_read on public.rides for select to authenticated
  using (public.is_member());

drop policy if exists rides_insert on public.rides;
create policy rides_insert on public.rides for insert to authenticated
  with check (public.is_parent() or child_id = auth.uid());

drop policy if exists rides_update on public.rides;
create policy rides_update on public.rides for update to authenticated
  using (public.is_parent() or child_id = auth.uid())
  with check (public.is_parent() or child_id = auth.uid());

drop policy if exists rides_delete on public.rides;
create policy rides_delete on public.rides for delete to authenticated
  using (public.is_parent() or child_id = auth.uid());

-- Živé aktualizace mezi telefony.
do $$
begin
  alter publication supabase_realtime add table public.rides;
exception when duplicate_object then null;
end $$;

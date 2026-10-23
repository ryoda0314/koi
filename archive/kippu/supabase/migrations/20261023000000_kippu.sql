-- ふたり旅きっぷ: one "space" per couple. Inside it the app keeps small JSON documents at fixed
-- paths, the same model the browser app uses:
--   app/members                     the two names
--   trips/{id}                      a trip or a date (kind = "trip" | "date")
--   trips/{id}/(plan|money|checks)/{id}
--   spots/{id}                      the shared wish list (may be tagged to a trip)
--   memories/{id}                   photos + a note, after going somewhere
-- Nobody signs up: each device signs in anonymously, and opening a share link (edit or view)
-- makes that device a member of the space.

-- ---------- tables ----------
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  edit_token text not null unique,
  view_token text not null unique,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('edit', 'view')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index space_members_user on public.space_members (user_id);

create sequence public.docs_rev;
create table public.docs (
  space_id uuid not null references public.spaces on delete cascade,
  path text not null,
  parent text not null,
  data jsonb,                                   -- null = deleted (kept so every device hears about it)
  rev bigint not null default nextval('public.docs_rev'),
  updated_at timestamptz not null default now(),
  primary key (space_id, path)
);

-- server-side settings: create_passcode, ai_daily_limit, ai_global_daily_limit
create table public.app_settings (
  key text primary key,
  value text not null
);

create table public.ai_usage (
  space_id uuid not null references public.spaces on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (space_id, day)
);

-- ---------- row level security ----------
alter table public.spaces enable row level security;          -- only through the functions below
alter table public.app_settings enable row level security;    -- never readable from the browser
alter table public.ai_usage enable row level security;

alter table public.space_members enable row level security;
create policy "see own memberships" on public.space_members
  for select to authenticated using (user_id = (select auth.uid()));

alter table public.docs enable row level security;
create policy "members read docs" on public.docs
  for select to authenticated using (
    exists (select 1 from public.space_members m where m.space_id = docs.space_id and m.user_id = (select auth.uid()))
  );
-- no insert/update/delete policies: writes go through doc_write(), which checks the edit role

-- live updates for the docs table
alter publication supabase_realtime add table public.docs;

-- ---------- helpers ----------
create function public.new_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

create function public.can_edit(p_space uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.space_members
    where space_id = p_space and user_id = (select auth.uid()) and role = 'edit')
$$;

-- nested objects merge key by key; anything else replaces (same rule as the browser)
create function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  out jsonb := coalesce(a, '{}'::jsonb);
begin
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(out -> k) = 'object' then
      out := out || jsonb_build_object(k, public.jsonb_deep_merge(out -> k, v));
    else
      out := out || jsonb_build_object(k, v);
    end if;
  end loop;
  return out;
end $$;

-- ---------- spaces ----------
create function public.create_space(passcode text default '') returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  want text;
  recent int;
  s public.spaces;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select value into want from public.app_settings where key = 'create_passcode';
  if coalesce(want, '') <> '' and coalesce(passcode, '') <> want then raise exception 'bad_passcode'; end if;
  select count(*) into recent from public.spaces where created_by = uid and created_at > now() - interval '1 hour';
  if recent >= 5 then raise exception 'resource_exhausted'; end if;
  insert into public.spaces (edit_token, view_token, created_by)
    values (public.new_token(), public.new_token(), uid) returning * into s;
  insert into public.space_members (space_id, user_id, role) values (s.id, uid, 'edit');
  return json_build_object('space_id', s.id, 'edit_token', s.edit_token);
end $$;

-- opening a share link: join (or stay in) the space; the link decides the role
create function public.join_space(token text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  s public.spaces;
  r text;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select * into s from public.spaces where edit_token = token;
  if found then
    r := 'edit';
  else
    select * into s from public.spaces where view_token = token;
    if not found then raise exception 'not_found'; end if;
    r := 'view';
  end if;
  insert into public.space_members as m (space_id, user_id, role) values (s.id, uid, r)
    on conflict (space_id, user_id) do update
    set role = case when m.role = 'edit' then 'edit' else excluded.role end
    returning m.role into r;
  return json_build_object(
    'space_id', s.id, 'role', r,
    'edit_token', case when r = 'edit' then s.edit_token end,
    'view_token', case when r = 'edit' then s.view_token end);
end $$;

-- whether a passcode is needed to make a new space (the passcode itself stays secret)
create function public.app_info() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('need_passcode',
    coalesce((select value from public.app_settings where key = 'create_passcode'), '') <> '')
$$;

-- ---------- documents ----------
create function public.doc_write(p_space uuid, p_op text, p_path text, p_body jsonb default null) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  cur jsonb;
  nxt jsonb;
  trip text;
  n int;
  r bigint;
begin
  if not public.can_edit(p_space) then raise exception 'permission_denied'; end if;
  if p_path !~ '^(app/members|trips/[A-Za-z0-9_-]{1,40}|trips/[A-Za-z0-9_-]{1,40}/(plan|money|checks)/[A-Za-z0-9_-]{1,40}|(spots|memories)/[A-Za-z0-9_-]{1,40})$' then
    raise exception 'invalid_argument' using detail = 'unknown document path';
  end if;
  if p_op not in ('set', 'update', 'delete') then raise exception 'invalid_argument' using detail = 'unknown operation'; end if;

  if p_op = 'delete' then
    -- deleting a trip takes its plan, money and checks with it
    update public.docs set data = null, rev = nextval('public.docs_rev'), updated_at = now()
      where space_id = p_space and data is not null
        and (path = p_path or (p_path ~ '^trips/[^/]+$' and parent = any (array[p_path || '/plan', p_path || '/money', p_path || '/checks'])));
    get diagnostics n = row_count;
    return case when n > 0 then currval('public.docs_rev') else 0 end;
  end if;

  if p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'invalid_argument' using detail = 'document must be an object'; end if;
  if p_body::text ~ '"(__proto__|constructor|prototype)"\s*:' then raise exception 'invalid_argument' using detail = 'bad key'; end if;

  select data into cur from public.docs where space_id = p_space and path = p_path for update;
  if p_op = 'update' and cur is null then raise exception 'invalid_argument' using detail = 'missing document'; end if;

  -- a child of a trip that was deleted in the meantime would be orphaned
  trip := substring(p_path from '^(trips/[^/]+)/');
  if trip is not null and not exists (select 1 from public.docs where space_id = p_space and path = trip and data is not null) then
    raise exception 'invalid_argument' using detail = 'missing trip';
  end if;

  if cur is null then
    select count(*) into n from public.docs where space_id = p_space and data is not null;
    if n >= 5000 then raise exception 'quota_exceeded'; end if;
  end if;

  nxt := case when p_op = 'update' then public.jsonb_deep_merge(cur, p_body) else p_body end;
  if octet_length(nxt::text) > 16384 then raise exception 'too_large'; end if;

  insert into public.docs (space_id, path, parent, data)
    values (p_space, p_path, regexp_replace(p_path, '/[^/]+$', ''), nxt)
    on conflict (space_id, path) do update
    set data = excluded.data, rev = nextval('public.docs_rev'), updated_at = now()
    returning rev into r;
  return r;
end $$;

-- ---------- AI usage (called by the "ai" Edge Function with the caller's own token) ----------
create function public.ai_take_turn(p_space uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Tokyo')::date;
  lim int := coalesce((select value::int from public.app_settings where key = 'ai_daily_limit'), 100);
  glim int := coalesce((select value::int from public.app_settings where key = 'ai_global_daily_limit'), 500);
  total int;
  used int;
begin
  if not public.can_edit(p_space) then return 'permission_denied'; end if;
  select coalesce(sum(count), 0) into total from public.ai_usage where day = d;
  if total >= glim then return 'daily_limit'; end if;
  insert into public.ai_usage as u (space_id, day, count) values (p_space, d, 1)
    on conflict (space_id, day) do update set count = u.count + 1
    returning u.count into used;
  if used > lim then return 'daily_limit'; end if;
  return '';
end $$;

-- only signed-in devices may call these
revoke execute on function public.create_space(text), public.join_space(text), public.doc_write(uuid, text, text, jsonb),
  public.ai_take_turn(uuid), public.can_edit(uuid), public.new_token(), public.jsonb_deep_merge(jsonb, jsonb)
  from public, anon;
grant execute on function public.create_space(text), public.join_space(text), public.doc_write(uuid, text, text, jsonb),
  public.ai_take_turn(uuid), public.can_edit(uuid) to authenticated;
grant execute on function public.app_info() to anon, authenticated;

-- ---------- realtime: presence ("who is here") and ♡ on the private channel space:{id} ----------
create policy "members receive on their space" on realtime.messages
  for select to authenticated using (
    exists (select 1 from public.space_members m
      where m.user_id = (select auth.uid()) and (select realtime.topic()) = 'space:' || m.space_id::text)
  );
create policy "members send on their space" on realtime.messages
  for insert to authenticated with check (
    exists (select 1 from public.space_members m
      where m.user_id = (select auth.uid()) and (select realtime.topic()) = 'space:' || m.space_id::text)
  );

-- ---------- photos: private bucket, files under {space_id}/ ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

create policy "members see photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and exists (select 1 from public.space_members m
      where m.user_id = (select auth.uid()) and m.space_id::text = (storage.foldername(name))[1])
  );
create policy "editors add photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'photos' and exists (select 1 from public.space_members m
      where m.user_id = (select auth.uid()) and m.role = 'edit' and m.space_id::text = (storage.foldername(name))[1])
  );
create policy "editors remove photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'photos' and exists (select 1 from public.space_members m
      where m.user_id = (select auth.uid()) and m.role = 'edit' and m.space_id::text = (storage.foldername(name))[1])
  );

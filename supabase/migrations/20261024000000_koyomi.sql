-- ふたりごよみ: one space per couple. Inside it the app keeps small JSON documents at fixed paths:
--   app/members               the two names, and which devices belong to whom
--   avail/{YYYY-MM-DD}        each one's free time that day: { a, b, na, nb } (all | day | night | no, and a note)
--   plans/{id}                a day to meet, proposed by one of them or set
--   plans/{id}/steps/{id}     what to do that day
--   wishes/{id}               things the two would like to do some day
-- Nobody signs up: each device signs in anonymously, and opening the invite link makes it a member.
-- Everything is prefixed koyomi_, so the app can live in a Supabase project shared with other apps.

-- ---------- tables ----------
create table public.koyomi_spaces (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.koyomi_members (
  space_id uuid not null references public.koyomi_spaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index koyomi_members_user on public.koyomi_members (user_id);

create sequence public.koyomi_rev;
create table public.koyomi_docs (
  space_id uuid not null references public.koyomi_spaces on delete cascade,
  path text not null,
  parent text not null,
  data jsonb,                                    -- null = deleted (kept so the other phone hears about it)
  rev bigint not null default nextval('public.koyomi_rev'),
  updated_at timestamptz not null default now(),
  primary key (space_id, path)
);

-- server-side settings: create_passcode, ai_daily_limit, ai_global_daily_limit
create table public.koyomi_settings (
  key text primary key,
  value text not null
);

create table public.koyomi_ai_usage (
  space_id uuid not null references public.koyomi_spaces on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (space_id, day)
);

-- ---------- row level security ----------
alter table public.koyomi_spaces enable row level security;    -- only through the functions below
alter table public.koyomi_settings enable row level security;  -- never readable from the browser
alter table public.koyomi_ai_usage enable row level security;

alter table public.koyomi_members enable row level security;
create policy "koyomi: see own memberships" on public.koyomi_members
  for select to authenticated using (user_id = (select auth.uid()));

alter table public.koyomi_docs enable row level security;
create policy "koyomi: members read docs" on public.koyomi_docs
  for select to authenticated using (
    exists (select 1 from public.koyomi_members m where m.space_id = koyomi_docs.space_id and m.user_id = (select auth.uid()))
  );
-- no insert/update/delete policies: every write goes through koyomi_write()

alter publication supabase_realtime add table public.koyomi_docs;

-- ---------- helpers ----------
create function public.koyomi_new_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

create function public.koyomi_is_member(p_space uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.koyomi_members where space_id = p_space and user_id = (select auth.uid()))
$$;

-- nested objects merge key by key; anything else replaces (the same rule as the browser)
create function public.koyomi_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  out jsonb := coalesce(a, '{}'::jsonb);
begin
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(out -> k) = 'object' then
      out := out || jsonb_build_object(k, public.koyomi_deep_merge(out -> k, v));
    else
      out := out || jsonb_build_object(k, v);
    end if;
  end loop;
  return out;
end $$;

-- ---------- spaces ----------
-- whether a passcode is needed to make a new space (the passcode itself stays secret)
create function public.koyomi_app_info() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('need_passcode',
    coalesce((select value from public.koyomi_settings where key = 'create_passcode'), '') <> '')
$$;

create function public.koyomi_create_space(passcode text default '') returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  want text;
  recent int;
  s public.koyomi_spaces;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select value into want from public.koyomi_settings where key = 'create_passcode';
  if coalesce(want, '') <> '' and coalesce(passcode, '') <> want then raise exception 'bad_passcode'; end if;
  select count(*) into recent from public.koyomi_spaces where created_by = uid and created_at > now() - interval '1 hour';
  if recent >= 5 then raise exception 'resource_exhausted'; end if;
  insert into public.koyomi_spaces (token, created_by) values (public.koyomi_new_token(), uid) returning * into s;
  insert into public.koyomi_members (space_id, user_id) values (s.id, uid);
  return json_build_object('space_id', s.id);
end $$;

-- opening the invite link: this device joins (or stays in) the space
create function public.koyomi_join(invite text) returns json
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  s public.koyomi_spaces;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select * into s from public.koyomi_spaces where token = invite;
  if not found then raise exception 'not_found'; end if;
  if not exists (select 1 from public.koyomi_members where space_id = s.id and user_id = uid)
     and (select count(*) from public.koyomi_members where space_id = s.id) >= 12 then
    raise exception 'full';
  end if;
  insert into public.koyomi_members (space_id, user_id) values (s.id, uid) on conflict do nothing;
  return json_build_object('space_id', s.id);
end $$;

-- the invite link, for members only
create function public.koyomi_invite(p_space uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.koyomi_is_member(p_space) then raise exception 'permission_denied'; end if;
  return (select token from public.koyomi_spaces where id = p_space);
end $$;

-- a new invite link; the old one stops working (devices already in stay in)
create function public.koyomi_new_invite(p_space uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  t text := public.koyomi_new_token();
begin
  if not public.koyomi_is_member(p_space) then raise exception 'permission_denied'; end if;
  update public.koyomi_spaces set token = t where id = p_space;
  return t;
end $$;

-- ---------- documents ----------
-- op: set (replace), update (deep merge into an existing doc), merge (deep merge, creating it if missing), delete
create function public.koyomi_write(p_space uuid, p_op text, p_path text, p_body jsonb default null) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  cur jsonb;
  nxt jsonb;
  plan text;
  n int;
  r bigint;
begin
  if not public.koyomi_is_member(p_space) then raise exception 'permission_denied'; end if;
  if p_path !~ '^(app/members|avail/[0-9]{4}-[0-9]{2}-[0-9]{2}|plans/[A-Za-z0-9_-]{1,40}|plans/[A-Za-z0-9_-]{1,40}/steps/[A-Za-z0-9_-]{1,40}|wishes/[A-Za-z0-9_-]{1,40})$' then
    raise exception 'invalid_argument' using detail = 'unknown document path';
  end if;
  if p_op not in ('set', 'update', 'merge', 'delete') then raise exception 'invalid_argument' using detail = 'unknown operation'; end if;

  if p_op = 'delete' then
    -- deleting a plan takes its steps with it
    update public.koyomi_docs set data = null, rev = nextval('public.koyomi_rev'), updated_at = now()
      where space_id = p_space and data is not null
        and (path = p_path or (p_path ~ '^plans/[^/]+$' and parent = p_path || '/steps'));
    get diagnostics n = row_count;
    return case when n > 0 then currval('public.koyomi_rev') else 0 end;
  end if;

  if p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'invalid_argument' using detail = 'document must be an object'; end if;
  if p_body::text ~ '"(__proto__|constructor|prototype)"\s*:' then raise exception 'invalid_argument' using detail = 'bad key'; end if;

  select data into cur from public.koyomi_docs where space_id = p_space and path = p_path for update;
  if p_op = 'update' and cur is null then raise exception 'invalid_argument' using detail = 'missing document'; end if;

  -- a step of a plan that was deleted in the meantime would be orphaned
  plan := substring(p_path from '^(plans/[^/]+)/');
  if plan is not null and not exists (select 1 from public.koyomi_docs where space_id = p_space and path = plan and data is not null) then
    raise exception 'invalid_argument' using detail = 'missing plan';
  end if;

  if cur is null then
    select count(*) into n from public.koyomi_docs where space_id = p_space and data is not null;
    if n >= 5000 then raise exception 'quota_exceeded'; end if;
  end if;

  nxt := case when p_op in ('update', 'merge') then public.koyomi_deep_merge(cur, p_body) else p_body end;
  if octet_length(nxt::text) > 16384 then raise exception 'too_large'; end if;

  insert into public.koyomi_docs (space_id, path, parent, data)
    values (p_space, p_path, regexp_replace(p_path, '/[^/]+$', ''), nxt)
    on conflict (space_id, path) do update
    set data = excluded.data, rev = nextval('public.koyomi_rev'), updated_at = now()
    returning rev into r;
  return r;
end $$;

-- ---------- AI usage (counted by the app's /api/ai with the caller's own token) ----------
create function public.koyomi_ai_turn(p_space uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Tokyo')::date;
  lim int := coalesce((select value::int from public.koyomi_settings where key = 'ai_daily_limit'), 60);
  glim int := coalesce((select value::int from public.koyomi_settings where key = 'ai_global_daily_limit'), 300);
  total int;
  used int;
begin
  if not public.koyomi_is_member(p_space) then return 'permission_denied'; end if;
  select coalesce(sum(count), 0) into total from public.koyomi_ai_usage where day = d;
  if total >= glim then return 'daily_limit'; end if;
  insert into public.koyomi_ai_usage as u (space_id, day, count) values (p_space, d, 1)
    on conflict (space_id, day) do update set count = u.count + 1
    returning u.count into used;
  if used > lim then return 'daily_limit'; end if;
  return '';
end $$;

-- only signed-in devices may call these
revoke execute on function public.koyomi_create_space(text), public.koyomi_join(text), public.koyomi_invite(uuid),
  public.koyomi_new_invite(uuid), public.koyomi_write(uuid, text, text, jsonb), public.koyomi_ai_turn(uuid),
  public.koyomi_is_member(uuid), public.koyomi_new_token(), public.koyomi_deep_merge(jsonb, jsonb)
  from public, anon;
grant execute on function public.koyomi_create_space(text), public.koyomi_join(text), public.koyomi_invite(uuid),
  public.koyomi_new_invite(uuid), public.koyomi_write(uuid, text, text, jsonb), public.koyomi_ai_turn(uuid),
  public.koyomi_is_member(uuid) to authenticated;
grant execute on function public.koyomi_app_info() to anon, authenticated;

-- ---------- realtime: who is here, on the private channel koyomi:{space} ----------
create policy "koyomi: members receive" on realtime.messages
  for select to authenticated using (
    (select realtime.topic()) like 'koyomi:%' and exists (select 1 from public.koyomi_members m
      where m.user_id = (select auth.uid()) and (select realtime.topic()) = 'koyomi:' || m.space_id::text)
  );
create policy "koyomi: members send" on realtime.messages
  for insert to authenticated with check (
    (select realtime.topic()) like 'koyomi:%' and exists (select 1 from public.koyomi_members m
      where m.user_id = (select auth.uid()) and (select realtime.topic()) = 'koyomi:' || m.space_id::text)
  );

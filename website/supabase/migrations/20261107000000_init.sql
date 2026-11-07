-- DaamDekho schema for Supabase (Postgres).
--
-- Security model:
--  * Row Level Security is on for every table and there are no policies, so
--    the public API keys cannot read or write tables directly.
--  * The website talks to the database only through the functions below
--    (PostgREST RPC). They run as their owner (SECURITY DEFINER) with a fixed
--    search_path.
--  * Functions that write need a write token. The token lives in the private
--    `config` table (insert it once, see website/README.md) and in the
--    website's WRITE_TOKEN environment variable, so nobody can write by
--    calling the RPC endpoint directly with the public key.

-- ------------------------------------------------------------------ tables

create table if not exists public.products (
  key text primary key,              -- "<store>:<id>", e.g. "flipkart:MOBGZ12345"
  store text not null,
  pid text not null,
  url text not null,                 -- canonical product URL
  title text,
  image text,
  mrp numeric(12, 2),
  first_seen bigint not null,        -- ms since epoch
  last_seen bigint not null,
  last_price numeric(12, 2),         -- latest day's median price
  low_price numeric(12, 2),
  low_day date,
  high_price numeric(12, 2),
  typical_price numeric(12, 2),      -- median of daily prices, last 90 days (5+ days of data)
  days integer not null default 0,
  reporters integer not null default 0,
  clicks integer not null default 0
);
create index if not exists products_last_seen_idx on public.products (last_seen desc);

-- One price per product, per day (India time), per anonymous reporter.
create table if not exists public.observations (
  key text not null references public.products (key) on delete cascade,
  day date not null,
  client text not null,              -- salted hash of the extension's random id
  price numeric(12, 2) not null,
  t bigint not null,
  primary key (key, day, client)
);

-- Daily upload counters for rate limiting (per client hash and per IP hash).
create table if not exists public.usage (
  who text not null,
  day date not null,
  points integer not null default 0,
  primary key (who, day)
);
create index if not exists usage_day_idx on public.usage (day);

-- Private settings (the write token). Never exposed.
create table if not exists public.config (
  key text primary key,
  value text not null
);

alter table public.products enable row level security;
alter table public.observations enable row level security;
alter table public.usage enable row level security;
alter table public.config enable row level security;
revoke all on public.products, public.observations, public.usage, public.config from anon, authenticated;

-- --------------------------------------------------------------- internals

create or replace function public.check_write_token(p_token text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_token is null or not exists (select 1 from config where key = 'write_token' and value = p_token) then
    raise exception 'invalid write token' using errcode = '42501';
  end if;
end;
$$;

-- India-time calendar day for an epoch-ms timestamp.
create or replace function public.ist_day(p_ms bigint)
returns date
language sql
immutable
set search_path = public
as $$
  select (to_timestamp(p_ms / 1000.0) at time zone 'Asia/Kolkata')::date;
$$;

-- Recompute a product's aggregates from its observations.
-- Daily price = lower median across reporters (always a price someone saw),
-- so one wrong or fake report cannot move it once a few people report.
create or replace function public.refresh_product(p_key text, p_now bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := ist_day(p_now);
begin
  with daily as (
    select day, percentile_disc(0.5) within group (order by price) as price
      from observations
     where key = p_key and day >= v_today - 730
     group by day
  )
  update products p set
    last_price    = (select price from daily order by day desc limit 1),
    low_price     = (select min(price) from daily),
    low_day       = (select day from daily order by price asc, day desc limit 1),
    high_price    = (select max(price) from daily),
    typical_price = (select percentile_disc(0.5) within group (order by price)
                       from daily where day > v_today - 90 having count(*) >= 5),
    days          = (select count(*) from daily),
    reporters     = (select count(distinct client) from observations where key = p_key)
  where p.key = p_key;
end;
$$;

-- ------------------------------------------------------------- write API

-- Store validated price reports. The website validates and normalises every
-- field first; points: [{key, store, pid, url, title, image, mrp, price, t, day}].
-- Returns {"accepted": n} or {"error": "rate_limited"}.
create or replace function public.ingest_prices(
  p_token text,
  p_client text,
  p_ip text,
  p_points jsonb,
  p_now bigint,
  p_client_limit integer,
  p_ip_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := ist_day(p_now);
  v_n integer := coalesce(jsonb_array_length(p_points), 0);
  v_used_client integer;
  v_used_ip integer;
  v_key text;
begin
  perform check_write_token(p_token);
  if v_n = 0 then
    return jsonb_build_object('accepted', 0);
  end if;

  select coalesce(sum(points) filter (where who = p_client), 0),
         coalesce(sum(points) filter (where who = p_ip), 0)
    into v_used_client, v_used_ip
    from usage
   where day = v_today and who in (p_client, p_ip);
  if v_used_client + v_n > p_client_limit or v_used_ip + v_n > p_ip_limit then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  -- One row per product: latest point's details, first/last time seen.
  insert into products (key, store, pid, url, title, image, mrp, first_seen, last_seen)
  select distinct on (key) key, store, pid, url, title, image, mrp,
         min(t) over (partition by key), max(t) over (partition by key)
    from jsonb_to_recordset(p_points)
      as x(key text, store text, pid text, url text, title text, image text, mrp numeric, t bigint)
   order by key, t desc
  on conflict (key) do update set
    title      = coalesce(products.title, excluded.title),
    image      = coalesce(products.image, excluded.image),
    mrp        = coalesce(excluded.mrp, products.mrp),
    first_seen = least(products.first_seen, excluded.first_seen),
    last_seen  = greatest(products.last_seen, excluded.last_seen);

  -- One row per product and day for this reporter: the latest price wins.
  insert into observations (key, day, client, price, t)
  select distinct on (key, day) key, day, p_client, price, t
    from jsonb_to_recordset(p_points) as x(key text, day date, price numeric, t bigint)
   order by key, day, t desc
  on conflict (key, day, client) do update set
    price = excluded.price,
    t     = excluded.t
  where excluded.t >= observations.t;

  insert into usage (who, day, points) values (p_client, v_today, v_n), (p_ip, v_today, v_n)
  on conflict (who, day) do update set points = usage.points + excluded.points;
  delete from usage where day < v_today - 7;

  for v_key in select distinct x.key from jsonb_to_recordset(p_points) as x(key text) loop
    perform refresh_product(v_key, p_now);
  end loop;

  return jsonb_build_object('accepted', v_n);
end;
$$;

create or replace function public.record_click(p_token text, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_write_token(p_token);
  update products set clicks = clicks + 1 where key = p_key;
end;
$$;

-- -------------------------------------------------------------- read API

create or replace function public.get_product(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p) - 'clicks' from products p where p.key = p_key;
$$;

-- Daily median series: [{"day": "YYYY-MM-DD", "price": n}, ...] oldest first.
create or replace function public.get_series(p_key text, p_since date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'price', price) order by day), '[]'::jsonb)
    from (
      select day, percentile_disc(0.5) within group (order by price) as price
        from observations
       where key = p_key and day >= p_since
       group by day
    ) d;
$$;

-- Real drops: seen in the last 2 days, 5+ days of data, at least 5% under
-- the typical (median) price. A median ignores a short pre-sale price hike.
create or replace function public.list_deals(p_since bigint, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(d) order by d.last_price / d.typical_price, d.key), '[]'::jsonb)
    from (
      select key, store, pid, title, image, last_price, typical_price, low_price, days
        from products
       where last_seen >= p_since and days >= 5 and typical_price > 0
         and last_price <= typical_price * 0.95
       order by last_price / typical_price asc
       limit least(p_limit, 100)
    ) d;
$$;

create or replace function public.list_recent(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(d) order by d.last_seen desc), '[]'::jsonb)
    from (
      select key, store, pid, title, image, last_price, typical_price, low_price, days, last_seen
        from products
       where days >= 2
       order by last_seen desc
       limit least(p_limit, 100)
    ) d;
$$;

create or replace function public.list_sitemap(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(d) order by d.last_seen desc), '[]'::jsonb)
    from (
      select store, pid, last_seen
        from products
       where days >= 2
       order by last_seen desc
       limit least(p_limit, 50000)
    ) d;
$$;

-- ------------------------------------------------------------- privileges

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.ingest_prices(text, text, text, jsonb, bigint, integer, integer),
  public.record_click(text, text),
  public.get_product(text),
  public.get_series(text, date),
  public.list_deals(bigint, integer),
  public.list_recent(integer),
  public.list_sitemap(integer)
to anon, authenticated;

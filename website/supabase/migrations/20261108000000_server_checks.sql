-- Server-side price checks: the website fetches a product's page when someone
-- pastes its link, and a schedule re-checks every product regularly, so
-- history builds up even without extension users.
--
-- Server reports are stored as observations from the reporter 'server'
-- (real reporters are 32-character hashes, so they cannot collide).

alter table public.products add column if not exists last_checked bigint;
alter table public.products add column if not exists check_failures integer not null default 0;
alter table public.products add column if not exists last_error text;
create index if not exists products_last_checked_idx on public.products (last_checked asc nulls first);

-- Users = distinct real reporters; the server's own checks are not a user.
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
    reporters     = (select count(distinct client) from observations where key = p_key and client <> 'server')
  where p.key = p_key;
end;
$$;

-- Record the outcome of a server check; creates the product row if needed so
-- the schedule keeps trying products whose first check failed.
create or replace function public.mark_checked(
  p_token text, p_key text, p_store text, p_pid text, p_url text, p_now bigint, p_ok boolean, p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_write_token(p_token);
  insert into products (key, store, pid, url, first_seen, last_seen, last_checked, check_failures, last_error)
  values (p_key, p_store, p_pid, p_url, p_now, p_now, p_now,
          case when p_ok then 0 else 1 end,
          case when p_ok then null else left(p_error, 200) end)
  on conflict (key) do update set
    last_checked   = p_now,
    check_failures = case when p_ok then 0 else products.check_failures + 1 end,
    last_error     = case when p_ok then null else left(p_error, 200) end;
end;
$$;

-- Products due for a re-check, least recently checked first. Products that
-- failed 30 times in a row are skipped (removed or permanently blocked).
create or replace function public.list_due(p_token text, p_before bigint, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform check_write_token(p_token);
  return (
    select coalesce(jsonb_agg(to_jsonb(d) order by d.last_checked asc nulls first, d.key), '[]'::jsonb)
      from (
        select key, store, pid, url, last_checked
          from products
         where (last_checked is null or last_checked < p_before) and check_failures < 30
         order by last_checked asc nulls first
         limit least(p_limit, 200)
      ) d
  );
end;
$$;

-- Count one use for `p_who` today; false (and not counted) when over the limit.
create or replace function public.bump_usage(p_token text, p_who text, p_now bigint, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := ist_day(p_now);
  v_used integer;
begin
  perform check_write_token(p_token);
  select points into v_used from usage where who = p_who and day = v_today;
  if coalesce(v_used, 0) >= p_limit then
    return false;
  end if;
  insert into usage (who, day, points) values (p_who, v_today, 1)
  on conflict (who, day) do update set points = usage.points + 1;
  return true;
end;
$$;

revoke execute on function
  public.refresh_product(text, bigint),
  public.mark_checked(text, text, text, text, text, bigint, boolean, text),
  public.list_due(text, bigint, integer),
  public.bump_usage(text, text, bigint, integer)
from public, anon, authenticated;
grant execute on function
  public.mark_checked(text, text, text, text, text, bigint, boolean, text),
  public.list_due(text, bigint, integer),
  public.bump_usage(text, text, bigint, integer)
to anon, authenticated;

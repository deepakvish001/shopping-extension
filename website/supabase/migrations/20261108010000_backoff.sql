-- Back off from products whose checks fail: after n failures in a row the next
-- check waits 6h * 2^n (12h, 24h, 48h ... up to 8 days). p_before is
-- "now - 6h", so the extra wait is 6h * (2^n - 1).
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
         where check_failures < 30
           and (last_checked is null
                or last_checked < p_before - 21600000::bigint * ((1 << least(check_failures, 5)) - 1))
         order by last_checked asc nulls first
         limit least(p_limit, 200)
      ) d
  );
end;
$$;

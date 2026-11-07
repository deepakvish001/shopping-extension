-- Optional: re-check tracked products on a schedule (every 30 minutes, up to
-- 20 products per run, oldest check first, with backoff for failures).
--
-- Not a migration: run it once in the Supabase SQL editor after replacing
-- the two placeholders. YOUR_CRON_SECRET must equal CRON_SECRET on Vercel.
--
-- Before enabling, read "Live price checks" in website/README.md: automated
-- page fetching is against Amazon's and Flipkart's terms of use, and a shop
-- may block it. The bot identifies itself and backs off when refused.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'price-refresh',
  '*/30 * * * *',
  $$select net.http_post(
      url := 'https://YOUR-SITE.vercel.app/api/cron/refresh',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
  )$$
);

-- See recent runs:  select * from cron.job_run_details order by start_time desc limit 10;
-- Stop it:          select cron.unschedule('price-refresh');

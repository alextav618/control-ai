CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'update-index-rates-daily') THEN
    PERFORM cron.unschedule('update-index-rates-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'update-index-rates-daily',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url:='https://project--a3dae3fa-872d-49c9-b551-8f243ec97042.lovable.app/api/public/hooks/update-rates',
    headers:='{"Content-Type": "application/json"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);
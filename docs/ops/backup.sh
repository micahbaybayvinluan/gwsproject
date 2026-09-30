#!/bin/sh
# Daily pg_dump to S3-compatible storage, 30-day retention. Runs forever, once per day at 01:00 Manila (17:00 UTC).
set -e
apk add --no-cache curl >/dev/null 2>&1 || true
wget -q https://dl.min.io/client/mc/release/linux-amd64/mc -O /usr/local/bin/mc && chmod +x /usr/local/bin/mc
mc alias set store "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
while true; do
  now=$(date -u +%H%M)
  if [ "$now" = "1700" ]; then
    f=gws-$(date -u +%Y%m%d).sql.gz
    pg_dump | gzip > /tmp/$f
    mc cp /tmp/$f store/$S3_BUCKET/$f
    mc rm --older-than "${RETENTION_DAYS}d" --recursive --force store/$S3_BUCKET/ || true
    rm /tmp/$f
    sleep 61
  fi
  sleep 30
done

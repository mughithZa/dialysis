# Deploying to a VPS

Three containers: `mongo` (MongoDB 7 as a single-node replica set, needed for transactions), `app` (the API plus the built client, one Node process) and `caddy` (reverse proxy with automatic HTTPS).

## Requirements

- A VPS with Docker and the Docker Compose plugin.
- A DNS record pointing your domain at the VPS, and ports 80 and 443 open (Caddy needs both to get its certificate).

## Environment variables

Copy `deploy/.env.example` to `deploy/.env` and fill it in.

| Variable | Meaning |
| --- | --- |
| `DOMAIN` | Public host name, e.g. `dialysis.example.org`. Caddy gets a certificate for it. |
| `SESSION_SECRET` | Signs session cookies. Required: the app refuses to start in production without it. `openssl rand -hex 32` |
| `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT` | Web-push keys and a contact (`mailto:` or https URL). Without keys, reminders are not sent. |
| `APP_TZ` | Time zone for session dates and reminders. Default `Asia/Damascus`. |

Generate the VAPID keys once and keep them (changing them invalidates every patient's reminder subscription):

```sh
npx web-push generate-vapid-keys
```

Copy the public key into `VAPID_PUBLIC` and the private key into `VAPID_PRIVATE`.

## First run

```sh
cp deploy/.env.example deploy/.env      # then edit it
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
curl https://YOUR-DOMAIN/api/health      # {"ok":true}
```

MongoDB initiates its replica set by itself through its healthcheck, and the app waits until it is healthy. The first start can take a minute while the certificate is issued.

The database starts empty. Create the first program manager account by seeding (below) or directly in MongoDB; there is no sign-up screen.

## Demo data

Seeds two centres with staff, 20 patients and a few weeks of history. All demo passwords are `demo1234`; the program manager is `pm`. Only do this on a throwaway or demo server: it refuses to run unless you confirm, and it does nothing if the `pm` user already exists.

```sh
docker compose -f deploy/docker-compose.yml run --rm -e ALLOW_DEMO_SEED=1 app npm run seed:demo -w server
```

## Updating

```sh
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

The data lives in the `dialysis_mongo-data` volume and survives rebuilds. Open sessions in browsers pick up the new version on the next reload.

## Logs and stopping

```sh
docker compose -f deploy/docker-compose.yml logs -f app
docker compose -f deploy/docker-compose.yml down        # keeps the data volumes
```

## Backups

Not set up in this POC. Before holding real data, schedule `mongodump` of the `mongo-data` volume (for example `docker compose exec mongo mongodump --archive --gzip > backup.gz`) and copy it off the server.

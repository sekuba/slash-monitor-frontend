# Slashmon Offense Collector

The offense collector is a standalone Node.js service that polls one local Aztec
node for pending slash offenses, stores observations in SQLite, and exposes a
small read-only HTTP API. It does not import or run the Slashmon frontend.

The collector calls only:

```text
aztecAdmin_getSlashOffenses("all")
```

It never proxies caller-supplied JSON-RPC methods and never exposes the Aztec
admin URL or API key through its HTTP API.

## Requirements

- Node.js 24 or newer
- An Aztec node with offense collection enabled
- `SENTINEL_ENABLED=true` on the Aztec node if inactivity offenses are required
- Access to the Aztec admin endpoint, normally `http://127.0.0.1:8880`

No package installation or runtime npm dependencies are required. SQLite is
provided by Node 24's `node:sqlite` module.

## Run Locally

```bash
cd collector
cp .env.example .env
set -a
. ./.env
set +a
npm start
```

The default API address is `http://127.0.0.1:8790`. The first poll runs
immediately.

Do not expose Aztec's port 8880. If the Aztec node uses API-key authentication,
put the key printed by the node in `AZTEC_ADMIN_API_KEY`. The collector sends it
only as the `x-api-key` request header.

## Restart Behavior

The SQLite database is the source of continuity:

- Failed polls do not modify offense records.
- Connection failures use exponential backoff up to `COLLECTOR_MAX_BACKOFF_MS`.
- A successful poll resets the backoff immediately.
- An absent offense is marked withdrawn only after
  `COLLECTOR_WITHDRAW_AFTER_MISSED_POLLS` successful snapshots.
- A withdrawn offense that reappears is reactivated and retains its history.
- Poll and failure state persists across collector and machine restarts.

The collector continues serving the last snapshot while the Aztec node is
restarting. `/health` reports `degraded` while that snapshot is still fresh and
`stale` with HTTP 503 after `COLLECTOR_STALE_AFTER_MS`.

## HTTP API

### `GET /live`

Process liveness only. It does not depend on the Aztec node and is suitable for
systemd or other process supervision.

### `GET /health`

Returns upstream reachability, snapshot freshness, polling timestamps, and
failure state. Response status is:

- `healthy`: latest poll succeeded and data is fresh
- `degraded`: latest poll failed but the previous snapshot remains fresh
- `stale`: a previous snapshot exists but is too old; HTTP 503
- `unavailable`: no successful snapshot exists; HTTP 503

### `GET /api/v1/status`

Returns health, active/withdrawn record counts, and non-secret collector timing
configuration.

### `GET /api/v1/offenses`

Returns offense observations. Query parameters:

| Parameter | Default | Allowed values |
| --- | --- | --- |
| `status` | `active` | `active`, `withdrawn`, `all` |
| `sequencer` | unset | One address, repeated addresses, or a comma-separated list |
| `limit` | `100` | 1 to 1000 |
| `offset` | `0` | 0 to 1000000 |

Example:

```bash
curl 'http://127.0.0.1:8790/api/v1/offenses?status=all&limit=50'
```

Query one sequencer:

```bash
curl 'http://127.0.0.1:8790/api/v1/offenses?sequencer=0x1111111111111111111111111111111111111111'
```

Query several sequencers by repeating the parameter:

```bash
curl 'http://127.0.0.1:8790/api/v1/offenses?sequencer=0x1111111111111111111111111111111111111111&sequencer=0x2222222222222222222222222222222222222222'
```

A comma-separated `sequencer` value is also accepted. Addresses are normalized
to lowercase, duplicates are ignored, and at most 100 addresses can be queried
at once. The pagination total reflects the address filter.

Big integers are decimal strings. A record has this shape:

```json
{
  "id": "64-character-sha256-id",
  "sequencer": "0x...",
  "amount": "2000000000000000000000",
  "offenseType": 3,
  "offenseTypeName": "inactivity",
  "epochOrSlot": "42",
  "timeUnit": "epoch",
  "status": "active",
  "firstSeenAt": "2026-07-21T08:00:00.000Z",
  "lastSeenAt": "2026-07-21T08:00:15.000Z",
  "withdrawnAt": null,
  "observationCount": 2,
  "reactivationCount": 0,
  "missedPolls": 0
}
```

Unknown future numeric offense types are retained as `unknown_<number>` instead
of causing the whole snapshot to fail.

### `GET /api/v1/offenses/:id`

Returns a single active or historical offense.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AZTEC_ADMIN_URL` | `http://127.0.0.1:8880` | Private Aztec admin JSON-RPC URL |
| `AZTEC_ADMIN_API_KEY` | unset | Admin API key sent as `x-api-key` |
| `COLLECTOR_DATABASE_PATH` | `./data/offenses.sqlite` | Persistent SQLite path |
| `COLLECTOR_POLL_INTERVAL_MS` | `15000` | Delay after a successful poll |
| `COLLECTOR_MAX_BACKOFF_MS` | `60000` | Maximum failure retry delay |
| `COLLECTOR_REQUEST_TIMEOUT_MS` | `10000` | Admin request timeout |
| `COLLECTOR_STALE_AFTER_MS` | `60000` | Age at which data becomes stale |
| `COLLECTOR_WITHDRAW_AFTER_MISSED_POLLS` | `3` | Successful omissions before withdrawal |
| `COLLECTOR_BIND_HOST` | `127.0.0.1` | HTTP API bind address |
| `COLLECTOR_PORT` | `8790` | HTTP API port |
| `COLLECTOR_CORS_ORIGIN` | `*` | API CORS origin |
| `COLLECTOR_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

Additional defensive limits are documented in `.env.example` defaults in the
source configuration module.

## systemd

The supplied unit uses `DynamicUser`, a persistent systemd state directory,
automatic process restarts, and filesystem hardening.

1. Place this repository at `/opt/slashmon` or adjust `WorkingDirectory` in the
   unit.
2. Create `/etc/slashmon-offense-collector.env` containing at least the admin
   URL and, when enabled, the API key. Make it readable only by root.
3. Install and enable the unit:

```bash
sudo install -m 0644 deploy/slashmon-offense-collector.service /etc/systemd/system/
sudo install -m 0600 .env /etc/slashmon-offense-collector.env
sudo systemctl daemon-reload
sudo systemctl enable --now slashmon-offense-collector
sudo systemctl status slashmon-offense-collector
```

The database is stored in
`/var/lib/slashmon-offense-collector/offenses.sqlite` and survives reboots.

## Development

```bash
npm test
npm run check
```

Tests use only Node's built-in test runner.

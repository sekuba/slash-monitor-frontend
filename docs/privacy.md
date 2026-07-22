# Privacy notes

Sequencer addresses are public. The fact that a particular browser or Telegram
account watches a particular address is not. Slashmon treats that association as
sensitive operational data.

## What the backend needs

To route alerts, the backend stores the minimum channel material it needs:

- watched network and sequencer addresses;
- a Telegram chat identifier or Web Push endpoint and encryption keys;
- subscription state and opaque management/link tokens;
- event and delivery status needed for retries and debugging; and
- source health/checkpoint data.

It does not need seed phrases, validator private keys, wallet signatures, or an
Aztec node's full keystore. If anything asks for those, it is not Slashmon.

The SQLite file and its backups contain sensitive associations. Production uses
mode `0600` through systemd's state directory and `UMask=0077`. Backups deserve
the same treatment, preferably encrypted before leaving the host.

## Who can observe what

The Slashmon operator can see subscription/address associations and delivery
metadata in the database. Keep logs sparse: never log Telegram tokens, Aztec
admin keys, RPC credentials, Web Push auth material, one-time link tokens, or
full provider request URLs.

Telegram receives the bot conversation and its delivery metadata. Telegram bot
chats are convenient and persistent, but they are not end-to-end encrypted.
Anyone choosing Telegram should assume Telegram can learn the alert contents
and which account received them.

Web Push payloads are encrypted for the browser subscription. The browser's
push provider still sees routing and timing metadata, and a notification may be
visible on a locked screen. The UI should offer concise/redacted notification
text where possible; opening Slashmon can show the detail.

The HTTPS reverse proxy can log IP addresses and request paths. Do not put
sequencer lists or management tokens in URLs, and configure access-log
retention deliberately instead of accepting an eternal default.

Public API reads contain health metadata, active offenses proposed by
Slashmon's Aztec node, and node-local and Ethereum L1 events. Node-local events
identify public sequencer addresses and are labelled pending; they do not expose
who watches those addresses or any delivery metadata. Watch-list bearer
capabilities remain required for watch management and saved-watch views.
Endpoint-scoped catch-up and notification-test events remain private. The
retired v1 offense endpoints return HTTP 410.

## User controls

Watches should be opt-in, scoped by network, easy to list or pause, and possible
to delete without contacting an operator. Opaque management credentials are
bearer secrets: possession grants control of that endpoint, so they belong in
browser storage or the bot conversation and must never be included in analytics
or logs.

Browser storage is isolated by origin, not pathname. Production notification
watches therefore require a dedicated Slashmon domain/subdomain. GitHub project
Pages under `name.github.io/project/` share storage with every other project
owned by that account; Slashmon treats such hosts as public-monitor-only and
will not persist a management capability there. A narrow service-worker scope
does not change that browser security boundary.

Because the management capability lives in browser storage, the production PWA
must not load analytics, tag managers, ad code, chat widgets, or other
third-party JavaScript. Pin a restrictive Content Security Policy at the HTTPS
proxy; the runbook includes the required connection exceptions for the API and
public L1 RPCs.

Revoked or expired Web Push endpoints and blocked Telegram chats are disabled
after endpoint-scoped permanent provider errors. Operational source-event
history remains for auditability, while terminal-only notification tests are
removed after 7 days, unverified endpoints after 24 hours, terminal
endpoint-scoped catch-up events and sent/failed delivery rows after 30 days,
and expired or consumed Telegram link tokens after 24 hours. Pending work is
never pruned.

## Signal

Signal would offer a different transport privacy tradeoff, but the usual server
automation stack is unofficial and operationally fragile. Slashmon v2 does not
advertise or support Signal delivery. The channel-neutral outbox leaves room
for a carefully operated experiment later.

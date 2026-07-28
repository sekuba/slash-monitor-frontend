# Privacy

Validator addresses and onchain slashing data are public. Connecting an address
to a browser, IP address, Web Push endpoint, or Telegram account is sensitive.

## Backend data

The SQLite database contains:

- watched validator addresses and hashed management/link tokens;
- Telegram chat IDs or Web Push endpoints and encryption material;
- node-local offense observations and public L1 monitor state;
- canonical scan checkpoints and grouped confirmed slash records; and
- notification jobs, delivery state, tests, and abuse-control counters.

Slashmon never needs validator keys, seed phrases, wallet signatures, or an
Aztec keystore. Treat the database, backups, and environment file as secrets.
The systemd unit uses a private state directory and `UMask=0077`.

Public API responses expose source health and public protocol observations.
They do not expose watch membership, management tokens, channel endpoints, or
delivery state. A management token reveals and controls only its own watch.

Deleting a watch removes its channels and prevents future delivery. Dead or
unverified endpoints, expired one-time tokens, tests, counters, and terminal
delivery work are pruned on bounded schedules.

## Provider exposure

- The Slashmon operator can associate watches with normal server access
  metadata.
- Telegram sees bot messages, recipients, contents, and timing. Bot chats are
  not end-to-end encrypted.
- Web Push payloads are encrypted for the browser subscription, but the push
  provider still sees routing and timing. Notifications may appear on a locked
  screen.
- The HTTPS proxy sees client IP addresses and request paths.
- A browser-selected public Ethereum RPC sees that browser's IP address and
  contract reads.

Logs must not contain RPC credentials, provider tokens, management/link tokens,
Web Push key material, Telegram associations, or complete secret URLs.

## Browser capability

The management token is stored for the whole browser origin, not one pathname.
Host the alert-enabled app on a dedicated origin with a restrictive Content
Security Policy and no analytics, ads, tag managers, chat widgets, or other
third-party scripts.

The independent L1 view stores only its public RPC choice locally and does not
need the management capability.

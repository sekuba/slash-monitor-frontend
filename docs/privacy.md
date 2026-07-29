# Privacy

Sequencer addresses are public. The association between an address and a
particular browser, IP address, or Telegram account is sensitive.

## Stored by the backend

The SQLite database contains:

- watched network and sequencer addresses;
- hashed management and one-time link tokens;
- Telegram chat IDs or Web Push endpoints and encryption material;
- per-sequencer public duty observations and completed inactivity ratios;
- public observations, projected cases and transitions, source checkpoints,
  and retry state.

Slashmon never needs validator keys, seed phrases, wallet signatures, or an
Aztec keystore. Protect the database and backups as secrets. The systemd unit
uses a private state directory and `UMask=0077`.

Public API responses expose source health and public-address cases built from
the Aztec node, Sentinel, and Ethereum L1. They do not expose watch membership,
channel endpoints, tokens, or delivery state. Notification tests remain only
in the delivery outbox and never enter protocol history.

## Provider exposure

- The Slashmon operator can read the database associations and normal server
  access metadata.
- Telegram sees bot conversations, alert contents, recipients, and timing.
  Telegram bot chats are not end-to-end encrypted.
- Web Push encrypts payloads for the browser subscription, while the browser's
  push provider still sees routing and timing metadata. Notifications may be
  visible on a locked screen.
- The HTTPS proxy can see IP addresses and request paths. Management tokens and
  sequencer lists are never placed in Slashmon URLs. Telegram enrollment uses
  a short-lived, single-use token in the `t.me` link.

Logs must not contain RPC credentials, provider tokens, management or link
tokens, Web Push key material, Telegram chat associations, or full secret URLs.

## Browser capability

The management token grants control of a watch. It is stored by browser origin,
not pathname. A production PINGME site therefore needs a dedicated origin and a
restrictive Content Security Policy without analytics, tag managers, ads, chat
widgets, or other third-party scripts. Shared GitHub Pages origins are suitable
only for Monitor.

Monitor can store one custom public Ethereum RPC URL per network in browser
storage. That RPC sees the browser's IP address and on-chain read requests.

Deleting a watch removes its channels and prevents future delivery. Provider
errors disable dead endpoints. The backend prunes expired one-time tokens and
terminal delivery history on bounded retention schedules; pending work and
protocol observations are retained for continuity.

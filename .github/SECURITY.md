# Security Policy

ShinobiX runs a live public beta at <https://shinobijourney.com/> with real
player accounts and saves. Please read the scope and testing rules below before
probing anything — the rules exist to keep other players' progress intact, not
to discourage reports.

## Supported versions

Only `main`, as currently deployed, is supported. There are no maintained
release branches; a fix ships by landing on `main` and redeploying. Reports
against an older checkout are welcome but will be verified against `main` first.

## Reporting a vulnerability

**Report privately. Do not open a public issue, and do not post details in
Discord.**

Use GitHub's private vulnerability reporting on this repository:
<https://github.com/Timehue/ShinobiX/security/advisories/new>. It is private
between you and the maintainers and needs no email address from either side.

If that form is unavailable to you, send a direct message to a maintainer via
the Discord in the README asking for a private channel — send the details only
after one is open, never in a public channel.

A useful report includes: what you did, what happened, what you expected, and
the smallest reproduction you have. A request/response pair or a short script
beats a screenshot.

## What to expect

This is a solo-maintained project, so timelines are best-effort rather than
contractual:

- Acknowledgement within about 5 days.
- An assessment — accepted, needs-more-info, or out of scope — within about 14 days.
- Credit in the fix commit if you want it. Say so in the report; the default is
  to credit you by your GitHub handle.

## In scope

The things that would actually hurt players:

- Authentication and session handling — session-token forgery or replay,
  password/recovery-code weaknesses, Google sign-in or guest-account flows that
  let one player reach another's account.
- Save integrity — reading, corrupting, or writing another player's save.
- Server-authoritative reward paths — any way to mint currency, XP, items, or
  ranked standing that the server does not recompute or gate on a single-use
  minted token.
- Admin, moderation, and cron endpoints reachable without admin credentials.
- Rate-limit or lock bypasses that enable the above.
- Stored XSS, SSRF, or injection in any handler under `api/`.
- Secrets exposed by the repository or by a deployed bundle.

## Out of scope

- Gameplay balance, drop rates, progression pacing, or economy tuning. Those are
  design decisions — open a normal issue.
- Client-side manipulation the server already rejects. Editing values in the
  browser is expected; the report needs to show the **server** accepting them.
- Missing security headers, cookie flags, or TLS configuration with no
  demonstrated impact.
- Self-XSS, clickjacking on pages with no state-changing action, and reports
  consisting only of automated-scanner output.
- Denial of service, volumetric or stress testing, and anything targeting
  Railway, Supabase, or Cloudflare infrastructure rather than this application.

## Testing rules

- Test against your own accounts only. Do not read, modify, or delete another
  player's save, inventory, currency, or clan state — if a proof of concept
  requires a second account, make a second account.
- Stop at the first confirmation. Demonstrating that one currency mint works is
  enough; do not farm it, and do not keep what you minted.
- No denial of service, no load testing, no spam of live channels, and no social
  engineering of players, moderators, or the maintainer.
- Do not exfiltrate data. If a bug exposes other players' data, capture only
  enough to prove it, say so in the report, and delete the rest.

Reports that follow these rules will not be pursued as a Terms of Service
violation, and an account used in good faith for testing will not be banned for
the testing itself.

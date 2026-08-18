# Auth & Anti-Cheat Patterns

Reference for how player authentication and reward integrity work, and the
patterns to follow when touching either. Written after the 2026 security audit
(see `security-audit-*.md` for the original findings). Keep this in sync if you
change the flows below.

---

## 1. Player auth — token-first credentials

### Server side (`api/_auth.ts`, `api/player-auth.ts`)

Two trust levels:

- **player** — `x-player-token` (preferred) **or** `x-player-name` + `x-player-password`.
- **admin** — `x-admin-password` (`ADMIN_PASSWORD` full, `ADMIN_CONTENT_PASSWORD` content-only).

The **session token** is a stateless HMAC:
`v2.<b64url(name)>.<expEpochMs>.<sessionEpoch>.<sig>`, signed with
`SESSION_SECRET`, 24h TTL, minted by `/api/player-auth` on
register/login/verify. It removes the ~100ms scrypt verify from the hot path.
The trailing `sessionEpoch` is per-account revocation state
(`auth-session:<slug>`), bumped by password change, account deletion, admin
reset, and guest claim — every token minted before the bump stops verifying.
The older `v1.<name>.<expEpochMs>.<sig>` form is still accepted, but only while
an account's epoch is still zero.

> **If `SESSION_SECRET` is unset the server issues NO token** and everything
> transparently falls back to the password path. Any client change here MUST
> keep that no-token path working.
>
> The exception, and the reason `playerSessionsEnabled()` exists: an account
> with **no password** has nothing to fall back to. Google and guest accounts
> are refused at creation while sessions are disabled, rather than created and
> then permanently unenterable.

`authedPlayer()` is the single chokepoint: token path first (no scrypt, no KV),
then password path, and the **same ban gate applies to both** — a token can
never bypass a ban.

### Client side (`shinobij.client/src/authFetch.ts`)

A global `window.fetch` interceptor (`installAuthFetch`) attaches auth to every
relative `/api/` request. It sends **token-only when a token exists** (never
token + password together) so an expired token surfaces a 401 → one-shot
`refreshToken` re-mint, instead of silently falling back to the server's scrypt
path forever.

**Token-first credential rule (audit M5).** Once a session token exists, the
reusable plaintext password is **not** persisted:

- `setActiveToken(token)` purges the persisted password from both stores *after*
  the token is safely stored.
- `setActivePlayer(name, password)` persists the password **only when no token
  exists** (the no-token server case); with a token it clears it instead.
- The per-account blob (`PLAYER_ACCOUNTS_STORAGE`) stores the account's `token`,
  not its `password`. A successful online login migrates old entries.
- Startup auto-login rides the persisted token (no password needed).

**Safety property — no lockout.** Online login always verifies the password
server-side and mints a fresh token, so the worst case is "re-enter your
password," never a lockout. No-token servers are unchanged.

**Accepted trade-offs:** offline login (server unreachable) and account-switching
after 24h token expiry now require re-entering the password. The guarded reads
of the (now usually-absent) stored password — offline verify, legacy upgrade,
character delete — all degrade gracefully.

**Invariant:** do not reintroduce durable plaintext-password storage. New
credential write paths must be token-first and degrade safely.

### Passwordless accounts (Google sign-in, guest play)

An account is identified by its `safeName` slug and nothing else. Google and
guest play are additional *doors* to the same account, not a second identity
system: both resolve to a slug, and from there the ordinary session token does
all the work. `auth:<slug>` gains `google?: { sub, email, linkedAt }`,
`guest?: true`, and `createdAt?`, and its `hash`/`salt` become **optional**.

Load-bearing consequences:

- **Every password comparison must fail closed on a missing hash.**
  `verifyAgainst()` guards `!record.hash || !record.salt` explicitly. Do not
  "simplify" that to optional chaining — the legacy-rehash branch compares
  `current.hash !== record.hash`, which is `false` when both are `undefined`,
  and would then write a password hash onto a Google-only record.
- **`verify` answers 200, not 500,** for a passwordless account, and says which
  door to use. A thrown 500 would be an oracle telling an attacker exactly which
  names are Google or guest accounts, defeating the `DUMMY_AUTH_RECORD`
  enumeration guard.
- **`change` doubles as "set your first password"** on a passwordless account,
  authorised by the session token instead of an old password. It re-checks the
  ban, and it spreads the existing record so setting a password cannot unlink
  Google.
- **`delete` accepts the session token** as proof of ownership, or a Google or
  guest player could never remove their own character.

**Google flow** (`api/_google-auth.ts`, `api/auth/google/*`) is a server-side
authorization-code flow modelled on `api/patreon/`. Notes that matter:

- The CSP (`api/_http-security.ts`) blocks Google's hosted script, One Tap, and
  any Google iframe. A top-level redirect is unaffected — hence no SDK.
- The signed `state` carries `{ mode, name?, epoch?, nonce }` with a 5-minute
  TTL. In link mode the account's **session epoch** is sealed in, so a link
  authorised by a session that has since ended is refused. The `nonce` is
  generated by the browser and must be echoed at claim time, so a flow completed
  in someone else's browser yields a ticket they cannot redeem.
- The ID token's signature is **not** verified, because it comes straight back
  from Google's token endpoint over TLS — which is only sound because
  `TOKEN_URL` is a hard-coded constant. If that ever becomes configurable, JWKS
  verification stops being optional. `aud` / `iss` / `exp` / `nonce` /
  `email_verified` are all checked regardless.
- Identity is keyed on Google's `sub`, never the email, and uniqueness is
  enforced with an NX write to `auth-google:<sub>`. Locking stays on
  `auth:<slug>` everywhere so there is only ever one lock to order.
- The callback returns a **single-use handoff ticket** in the URL, never a
  session token. The client strips it immediately and trades it over POST.

**Guest play** is a real account with a real save and no owner. Its extra piece
is `guest-resume:<random>`, a server-issued opaque credential the browser keeps
and redeems for a fresh token — the guest's only way back after the 24h token
lapses. Linking Google clears the `guest` flag **and rotates the epoch**, so the
anonymous browser stops holding a credential to an account that now has an owner.

The daily cron (`api/cron/_guest-sweep.ts`) reclaims **credential-less** guests
idle for 14 days — see `isCredentialLessGuest` below; setting a password takes
an account out of the sweep permanently, exactly as linking Google does.
Activity is read from `player:registry.lastSeen`, which the save path already
writes — there is no per-heartbeat touch write, and nothing that would make the
hottest endpoint in the game contend the auth lock. It **rotates** the session
epoch rather than deleting `auth-session:<slug>`: a missing epoch reads as zero,
so deleting it would let an old token authenticate as whoever registers the
freed name next.

### Self-serve recovery: `auth-recovery:<slug>`

**Recovery is a code you were given and kept, not an email link — because there
is no email.** Accounts are keyed by the `safeName` slug and nothing else.
Registration never collects an address and guest play collects nothing, so the
only accounts carrying one are the Google-linked ones, which already recover by
signing in with Google. An email flow would therefore cover approximately none
of the population that needs it while *looking* like the problem was solved. For
an account whose only identifier is a public name, recovery can honestly mean
one thing: present a secret you were issued. A player who kept nothing still
ends at a moderator, and the UI says so on the form rather than after it.

`api/_recovery-code.ts` owns the format and storage; `player-auth.ts` owns the
two actions.

- **`recovery-issue`** mints a code and returns the plaintext once, requiring a
  session token for that name or the current password. It is the authenticated
  act of writing down a spare key, so it deliberately does **not** rotate the
  session epoch: nothing is revoked, and rotating would sign the player out of
  their other devices as the price of taking a safety measure. The epoch
  rotation lands on `recover`, which is the half that changes a password.
- **`recover`** trades a code for a new password: rotates the epoch, sets the
  hash under the account lock, consumes the code, and mints a replacement in the
  same response so nobody finishes recovery holding nothing. Banned accounts are
  refused here exactly as in `verify`, or recovery would be the way around it.
- **`change` issues a code when the account has none yet**, which covers both a
  guest claiming their character (the same response that starts the revocation
  above) and accounts predating the feature. A routine password change on an
  account that already has a code leaves it alone — silently invalidating a code
  someone wrote down would turn a password change into a future lockout.
- **`admin-recovery`** is the operator's tool, and the one to reach for first.
  It mints a code and hands it to the ADMIN to relay, after they have verified
  who they are talking to; the player then redeems it and picks a password the
  operator never sees. It **rotates the session epoch** — the opposite of the
  choice `recovery-issue` makes, and for a clear reason: there the account's own
  owner is taking a safety measure and signing out their other devices would be
  a punishment for it, whereas here somebody *else* is minting a credential onto
  the account, which is exactly the case the rotation rule exists for.
  It **leaves the password alone**, deliberately. Clearing it would lock out an
  attacker who knows it, but it would also strand the player if the hand-off
  never arrives, and on a guest-flagged record it would make the account
  credential-less again — re-opening both the resume key and the 14-day sweep.
- **`adminreset` still sets a password outright**, and stays for the case a code
  cannot serve: an account somebody else is *already* in, where the attacker's
  known password has to stop working this second rather than whenever the player
  redeems. It **deletes the code**, and never returns one to the admin — an
  admin reset is what you ask for when you have lost control of an account, so
  the outstanding spare key is exactly the thing to invalidate.

Neither admin action is a new privilege: a full admin could always take an
account with `adminreset`. What changed is that the ordinary "I forgot my
password" request no longer *requires* an operator to choose, know, and paste a
working credential into a chat log.

Three properties are load-bearing:

- **No enumeration oracle.** `recover` answers a wrong code, an account with no
  code, and a name nobody registered with one identical `200 {ok:false}` — the
  same reasoning that makes `verify` answer 200 for a passwordless account. The
  Hall of Legends is a public list of every name worth probing.
- **No per-account attempt lockout, on purpose.** The obvious hardening is wrong
  here: the code carries ~100 bits of entropy, so guessing is hopeless with or
  without one, while a name-keyed counter would let anyone lock a specific player
  out of their own recovery for ten requests. The IP budget is the bound that
  costs no victim anything.
- **The code dies with the account.** Slugs are reusable, so a surviving
  `auth-recovery:<slug>` would be a working credential to whoever registers the
  name next. Every delete path clears it, `claimNewAccountSlug` clears it again
  on the way in as a backstop against a half-failed deletion, and the full
  server reset wipes `auth-recovery:*` explicitly — it sits beside `auth:<slug>`
  rather than under it, so the `auth:*` pattern never reaches it, exactly like
  `auth-google:*` and `guest-resume:*`. `server-reset.test.ts` guards all four.
- **All three actions are exempt from the maintenance freeze**
  (`_launch-controls.ts`), like `verify` and `change`. Freezing recovery would
  mean the one incident an operator most wants players able to work around is
  the one where nobody can get back in.

Stored as salted **SHA-256**, not scrypt, and the asymmetry is deliberate:
passwords are low-entropy and human-chosen, so they need a slow KDF to make a
leaked hash expensive; a 100-bit CSPRNG draw has no dictionary to search, so
there is nothing for slowness to buy. A stolen KV dump still yields no usable
codes, which is the whole job.

**Guests are shut out of every player-visible text channel** until the account
gains a real credential. An account created anonymously, three per hour per
fingerprint, with no email and no owner is the cheapest possible spam and
harassment vehicle, so `api/_guest-gate.ts` gates the tavern (`village/chat`,
read *and* post), direct messages (`messages`, POST only — an existing inbox
stays readable), clan chat (`clan/chat/send`) and battle chat (`pvp/chat`).

Signs left in the world (`sector/trail-sign.ts`) are gated the same way, since
they are name-attributed text strangers read. Only the `leave` path — `spark`
is a wordless thumbs-up with nothing to moderate, and a new player should be
able to cheer someone's sign on day one.

**One predicate, `isCredentialLessGuest` in `player-auth.ts`: `guest` AND
passwordless.** Both halves are load-bearing. Linking Google clears the `guest`
flag outright, but setting a first password (`player-auth` action `change`)
deliberately spreads the record and *keeps* it — so selecting on the flag alone
catches someone who has a real, portable credential. Either door releases them.

**This closed a hole in `guest-resume`, and the ORDER it was closed in is the
point.** That branch revoked the browser's resume credential with
`if (!record.guest)`. Because only the Google link clears that flag, an account
claimed with a **password** kept its resume key live: a browser once used for
guest play went on minting fresh 24h tokens, TTL refreshing on each use, and the
password never locked it out (the epoch rotation in `change` does not help —
that path mints a new token). It now reads `isCredentialLessGuest`, deletes the
key, and names the door that actually works for that record instead of assuming
Google.

It was left open deliberately until then. Revoking a browser's last credential
before there was a **self-serve password reset** would have stranded anyone who
set a password and forgot it, since recovery needed an admin. The reset path
shipped first (§1, `auth-recovery:<slug>`), and only then did the predicate
flip — the same response that retires the resume key now hands the player the
recovery code that replaces it.

⚠ **Keep it single.** The tavern lock and account RECLAMATION
(`api/cron/_guest-sweep.ts`) ask the same question — "does this character belong
to anybody?" — with wildly different consequences. They were written with
different predicates once, and the result was that a player who set a password
could talk in the tavern and still have their character **deleted** for
inactivity two weeks later. `_guest-gate-wiring.test.ts` now asserts both read
the shared helper, and that the sweep's old `if (!record?.guest)` selector never
returns.

Two properties of that gate are load-bearing:

- It **fails open** on a storage error. The record read cannot tell "not a
  guest" from "could not tell", so failing closed would silence every player's
  chat during one Supabase blip. This is an anti-spam gate, not a currency
  path — the opposite of the `withKvLock({failClosed:true})` rule in §3.
- The client learns the lock from `GET /api/player/account-status`, never from
  localStorage. `socialLocked` is computed server-side from the same switch the
  endpoints read, so the UI lock and the gate cannot drift — including under the
  `DISABLE_GUEST_SOCIAL_LOCK=1` rollback, which must reopen both at once.
  `api/_guest-gate-wiring.test.ts` asserts each handler still calls the gate,
  after the identity is known and before the work it prevents.

The browser fingerprint (`fingerprint.ts` → `x-client-fp`) is a **soft**
anti-alt signal only — trivially spoofable. Never gate auth, rate-limit, or
anti-cheat decisions on it as if it were trusted.

---

## 2. Reward integrity — the mint-token pattern

**Rule: the client is never trusted for rewards, currency, XP, or outcomes.**
Either recompute the reward server-side, or gate it on a server-minted,
single-use token.

Use the **mint-token pattern** when there is no server-side session to
cross-check (single-player / client-driven activities):

1. **Mint at start** — a `*-start` endpoint verifies eligibility + a daily mint
   cap, **seals the reward-relevant params into the token** (so they can't be
   tampered with at redeem), stores it at `<prefix>:<player>:<uuid>` with a TTL,
   and returns the token id.
2. **Redeem once** — the report endpoint **requires** the token, verifies
   ownership (and a maturity/time-gate where the activity has a duration),
   **atomically deletes it before granting** (`kv.del` first), and computes the
   reward from the **sealed token values**, not the client body.
3. **No fallback** where the rollout allows it — an action without a valid,
   matured token earns nothing.

### Instances

| Activity | Mint | Redeem | Notes |
|----------|------|--------|-------|
| **Pet expeditions** (M1) | `api/missions/expedition-start.ts` | `api/missions/report-pet-event.ts` | Token seals `expType`/`duration`/`petLevel` (**duration derived from `expType` server-side** so scout's Ryo rate can't ride ruins' 4h). `endsAt` time-gate (must fully elapse, 60s skew grace). Single-use. **No fallback.** 12/day mint cap. Client stores the token in the persisted `pet.expedition.token` (survives reload). |
| **AI raids** | `api/missions/raid-start.ts` | `api/missions/report-raid.ts` | Sibling pattern. 5-min `raid-token`. **Keeps a fallback** for stale clients (rate-limit-only when absent). |
| **PvP raids / PvP-win** | — | `report-raid.ts` / `report-pvp-win.ts` | No token needed: cross-validate `battleId` against the real `PvpSession` (done + winner + recency) + NX idempotency. |
| **PvP reward claim** | — | `api/pvp/claim-rewards.ts` | Loads the session, verifies caller is the recorded winner/loser, recomputes Elo + base reward under lock with an NX receipt (exactly-once). |

**Idempotency:** prefer `kv.set(key, v, { nx: true })` reservations or single-use
token deletion for exactly-once semantics.

---

## 3. Server-authoritative shared economy

- **War Supply** (audit H4): clients cannot set a sector's `warSupply` via
  `world-state` writes. `resolveClaimedWarSupply()` (`api/_territory-supply.ts`)
  owns it on the claiming path — carry `prev` for the same owner, reset to 0 on a
  fresh claim / ownership flip. Accrual is derived lazily from `lastSupplyAt` at
  collect time (`collectTerritorySupply`), so freezing the stored value loses
  nothing. `TERRITORY_WAR_SUPPLY_MAX` is an absolute backstop for the
  admin-exempt path.
- **Read-modify-write on shared keys** (treasury, seal pool, bank, territory)
  MUST go through `withKvLock` (`api/_lock.ts`), `{ failClosed: true }` for any
  currency/economy critical section. Lock the **shared resource** key
  (e.g. `clan-seal-pool:<clan>`), not just the actor's `save:<name>` — two
  different actors hold different save locks and would still race the shared row.
- **Debit before credit; never re-credit.** `collect-supply` keeps a deliberate
  "lose, never duplicate" stance: it zeroes sectors first, then credits the
  treasury; on a credit failure it records an unreconciled-loss audit key and
  returns 503 rather than risk a double-credit mint.

---

## 4. Checklist — adding a client-reported reward endpoint

- [ ] Recompute or **seal** the reward server-side; never trust the client body.
- [ ] Use the **mint-token pattern** (start endpoint + single-use redeem) when
      there's no server session to cross-check.
- [ ] Daily cap **and** rate limit.
- [ ] Idempotency (NX reservation or delete-token-on-use).
- [ ] `withKvLock` (`failClosed`) around any shared-state read-modify-write.
- [ ] **Register the new endpoint in `server.ts`** (cPanel parity) and confirm
      the client call path matches the handler file path (Vercel parity).
- [ ] `npm test` (repo root) + `npm run lint` (`shinobij.client/`).

---

## 5. Fable-5 security-hardening pass (2026-07-17)

### 5.1 PvP base-reward authorization (`api/pvp/session.ts`, `claim-rewards.ts`)

A non-admin browser must never decide that a battle is reward-bearing or invent a
reward-bearing NPC. `sealBaseRewardStamp()` (exported, unit-tested) owns the
decision at session creation:

- **`baseRewards` is honored only when BOTH fighters resolve to authoritative
  saves** (real players), or the creator is admin. A fabricated no-save NPC
  opponent — "mint ryo vs a bot you invented" — no longer opts a session into
  base rewards. Every legitimate base-reward flow is player-vs-real-player
  (challenge accept, sector raid vs a real defender); save-less AI guards take a
  separate client `raidAi` path that never sets `baseRewards`.
- **A non-admin cannot self-assign the Death's Gate (sector 99) 2× multiplier.**
  The 2× is honored only when the server confirms from **presence** that BOTH
  fighters are at sector 99. An attacker controls only their own presence, so the
  opponent being at 99 (which they cannot fake) is what gates the bonus — it
  applies only to a genuine Death's Gate fight, and an unverified claimed `99` is
  neutralized to `0`. (The home-terrain buff reads the raw body sector and is
  separately gated on server-verified territory ownership.)
- **Fail-closed and not silent:** a denied base-reward request runs the fight but
  grants no base rewards and logs a `[pvp/session] base-reward request denied`
  marker.
- **Settlement re-verifies independently** (`settleBaseForWinner`): base ryo/XP is
  paid only when the LOSER has an authoritative save at the money-moving step —
  session creation is not the only enforcement point. A pre-gate legacy session or
  a no-save loser never pays out.

### 5.2 Non-owner save projection is an explicit allowlist (`api/save/[name].ts`)

Foreign player-save reads go through `buildPublicSaveDTO()` — an explicit **root +
character allowlist**, private by default. The old projection allowlisted
`character` but spread the entire top-level save, leaking `savedBloodlines`,
`creator*`, `activeTraining`, `missionProgress`, `currentSector`,
`triggeredEvents`, `_saveVersion`, and any field added later. Now:

- Base foreign read → `{ character: <PUBLIC_CHAR_FIELDS> }` only.
- `?combatOnly=1` additionally exposes `savedBloodlines / creatorJutsus /
  creatorItems` (the minimal scouting surface the client's `fetchPlayerCombatSave`
  consumes). PvP itself re-hydrates the opponent's loadout server-side, so nothing
  private is required by foreign clients.
- A newly added top-level or character field is **private until explicitly
  listed** — enforced by `_public-save-dto.test.ts` (sentinel-secret contract).

### 5.3 Lock release is an atomic compare-and-delete (`api/_lock.ts`, `_storage.ts`)

`KvLike.delIfEqual(key, expected)` deletes a key only if its stored value still
equals the caller's token, in one row-locked statement (`DELETE … WHERE key=$1 AND
value=$2::jsonb`). Lock release now uses it instead of a `get`-then-`del`, which
raced: between the read and the delete the short-TTL lock could expire and a NEW
holder re-acquire it, and the stale holder would delete the new holder's lock.
`api/pvp/move.ts` releases its per-move lock the same way. Fails safe — a backend
that cannot match the value deletes nothing (the lock lingers to its TTL), never
another holder's lock.

### 5.4 Route-specific body limits (`server.ts`, `api/_body-limits.ts`)

`classifyBodyLimit()` scopes the 50 MB JSON parser to the exact image/import
routes — no longer the whole `/admin/*` tree, where an unauthenticated caller
could force a 50 MB buffer + parse before a handler's auth check. Player saves get
a dedicated 1 MB parser, so an oversized save is rejected at the parser boundary
(matching the save handler's 1 MB cap) rather than after a 5 MB parse.

### 5.5 cPanel DNS fallback cannot recurse (`app.js`, `cpanel-dns.cjs`)

`makeCustomLookup()` binds the ORIGINAL `dns.lookup` captured **before** the global
patch, so a failed `resolve4` terminates in Node's real resolver instead of
re-entering the patched `customLookup` (previously infinite recursion). No project
hostname or fallback IP is embedded in source (env-driven only).

### 5.6 Admin session tokens (`api/_auth.ts`, `admin-auth.ts`, client `authFetch.ts`)

The admin panel used to keep the reusable `ADMIN_PASSWORD` in `sessionStorage` and
attach it (`x-admin-password`) to **every** admin request. A short-lived signed
session token replaces that:

- `/api/admin-auth` mints `av1.<role>.<expMs>.<epoch>.<sig>` on login (`issueAdminToken`).
  The client stores the token, drops the password from storage, and sends
  `x-admin-token`. `authFetch` **swaps** any `x-admin-password` for the token on
  the wire, so even the ~100 call sites that set the password header never send
  the plaintext. `isAdmin`/`isFullAdmin` verify the token statelessly (HMAC +
  expiry + epoch, no KV — they stay synchronous); `player-auth.ts`'s admin
  operations now use `isFullAdmin` too.
- **Revocation:** bump `ADMIN_SESSION_EPOCH` (redeploy) to invalidate every
  outstanding token; rotating `ADMIN_SESSION_SECRET` does the same immediately.
- **INERT WITHOUT `ADMIN_SESSION_SECRET`:** no token is minted, the client keeps
  the password path, behaviour is unchanged — so enabling admin sessions is
  opt-in and cannot lock a single-operator deployment out.
- **`ADMIN_STRICT_TOKEN_ONLY=1`** makes the server reject the reusable-password
  admin path (token-only end state). Default off so the migration can't lock out.
- **Residual (documented):** the admin credential lives in `sessionStorage`
  (token), readable by same-origin XSS — an accepted intermediate per the plan;
  an HttpOnly cookie + CSRF is the next step.

### 5.7 Anonymous challenge inbox is no longer anon-readable (`supabase-schema.sql`)

`challenges:*` was removed from the anon SELECT allowlist AND the Realtime
publication filter. The browser never actually subscribed to it — challenges
arrive over the **authenticated** HTTP heartbeat + a Socket.IO nudge
(`api/player/challenge.ts` `kickPlayer`), and the stored payload is already
redacted (`projectChallenge`) — so the anon grant only let anyone with the public
anon key enumerate every player's projected challenge inbox. Delivery is
unaffected. **Ops step:** apply the two-statement `ALTER POLICY` / `ALTER
PUBLICATION` on the live DB (the schema file is the canonical end state);
`supabase-schema-security.test.ts` guards against re-adding the grant.

### 5.8 Atomic, exactly-once PvP settlement (`api/pvp/_reward-settlement.ts`, `claim-rewards.ts`)

Rating, base-reward, and item-consumption settlement used to write an idempotency
receipt to one KV key and the credited save to another. A crash (deploy / OOM /
DB blip) between the two left the receipt placed but the save un-credited — and
the retry then skipped, **permanently losing** the reward/rating (it only ever
failed toward "player got less", never a mint).

The idempotency marker now lives **inside the credited save**
(`character.serverSettlementReceipts`, a server-owned field the sanitizer
preserves), reusing the same machinery shop/inventory settlement use. Credit +
receipt land in **one `kv.set`** — a single Postgres row write, which is atomic:

- crash BEFORE the write → nothing persisted → retry re-credits (fresh);
- crash AFTER the write → credit + receipt together → retry skips (replay).

No cross-row transaction, no migration. The idempotency key is server-derived
from the battleId (`pvp-<kind>-<battleId>`), so it can't be forged, and each
fighter's save tracks its own settlement — a two-sided rating recovers each side
on its own retry. Rating and item-consumption are now fully atomic. The base
reward's payout is atomic too; its two *auxiliary* rows (the repeat-opponent
decay counter and the daily stat-growth budget) can, in the rare crash-between-
those-and-the-write case, advance twice — which only shrinks a *future* reward
(still fails toward less), and is strictly better than losing the whole payout.
Covered by `api/pvp/_reward-settlement.test.ts` (exactly-once, crash-before-write
recovery, independent two-sided rating).

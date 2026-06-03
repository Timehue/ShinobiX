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

The **session token** is a stateless HMAC: `v1.<name>.<expEpochMs>.<sig>`, signed
with `SESSION_SECRET`, 24h TTL, minted by `/api/player-auth` on
register/login/verify. It removes the ~100ms scrypt verify from the hot path.

> **If `SESSION_SECRET` is unset the server issues NO token** and everything
> transparently falls back to the password path. Any client change here MUST
> keep that no-token path working.

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

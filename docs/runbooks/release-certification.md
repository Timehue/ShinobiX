# Fresh-Account Release Certification (P0-6)

The standing answer to *"would a brand-new player's rewards actually survive a
refresh?"* — asserted against the real server, on every CI run.

```bash
npm run certify:release                                   # boot a server and certify
npm run certify:release -- --url=https://staging.example  # certify a running server
npm run certify:release -- --keep-alive --port=41999      # leave the server up to poke at
```

Exit 0 = certified. Any failed check exits non-zero and prints the failing
step plus the server's last 40 log lines.

## What it certifies

It boots the REAL Express server (`server.ts` / `dist/server.js` — the same
handler graph Railway runs), registers a REAL account over HTTP, and walks the
journey. Each check maps to a failure class from the Phase 0 audits:

| Step | What it proves | Phase 0 class |
|---|---|---|
| register | a fresh account gets a session token | token-first auth |
| first save | a tampered first save is clamped to the baseline (ryo 100, level 1, no premium currency) | fresh-registration inflation |
| tampered autosave | an ordinary save cannot mint currency, forge achievements, or equip unowned gear | save-sanitizer boundary (P0-1) |
| earn a reward | a server-authoritative reward lands and reports its balance | reward settlement (P0-2) |
| reward survives refresh | the refetched balance matches the credited balance | **"my reward disappeared"** |
| reward survives relog | the balance survives a brand-new session | same, across sessions |
| reward is idempotent | a retry reports `alreadyClaimed` and grants nothing | idempotency contract (P0-2) |
| stale autosave | a stale write is rejected **409** and the reward is still there afterwards | stale-write clobber |
| public projection | a foreign reader sees no wallet, no stats, no internal metadata | projection boundary (P0-1) |

## What it does NOT cover

The in-memory backend is not Postgres, so this does not exercise pg-specific
behavior: the atomic `kv_set_nx` lock function, the 10s read cache, or real
cross-replica contention. It certifies the **API contract and settlement
boundaries**, not the storage engine.

Point it at a staging deployment with `--url=` to cover those — same checks,
real storage. It creates two throwaway accounts per run (`certbot…`,
`certobs…`), so only run it against staging, never production.

It is also API-level by design: browser rendering stays with the Playwright
suite, which runs against a mocked preview and certifies UI, not settlement.
The two are complementary — neither alone would have caught what the other does.

## Contract details it pinned

Writing this surfaced three behaviors no mocked test could have:

1. **A first save must still echo `_baseSaveVersion`** (`0`), or the server
   answers 426 "client too old".
2. **Saves are rate-limited to one per 3s per player** (`save-burst`). A real
   client debounces; the harness waits.
3. **A session token is bound to its player**, so reading someone else's save
   requires sending your own `x-player-name` alongside the token — which is
   what the client's `authFetch` does.

If a future change breaks one of these, this is where it surfaces first.

## Adding a check

Add it inside `certify()` in `scripts/release-certification.mjs` using
`step(name)` + `check(condition, detail)`. Two rules:

- **Assert the precondition, not just the outcome.** If a write is supposed to
  be accepted-then-clamped, assert the 200 first — otherwise a rejected write
  makes the clamp assertions pass for the wrong reason (this happened while
  writing it).
- **Behave like a real client.** Respect the rate limit and send the headers
  the client sends; a certification that fights the contract just measures the
  contract's defenses.

## Where this gates

Runs in CI on every PR and push to main, after the root build so it certifies
the built `dist/server.js`. It is the pre-flight for the three pending
cutovers — `STRICT_RAW_SAVE_LEDGER=1`, the shared-content slot freeze
(`docs/runbooks/shared-content-cutover.md`), and the currency read cutover
(`docs/runbooks/currency-ledger-cutover.md`). Run it against staging with
`--url=` before flipping any of them.

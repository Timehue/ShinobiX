# Contributing to ShinobiX

ShinobiX is a live game with real player saves, maintained by one person. That
shapes what is useful to send and what will realistically happen to it — this
page is an honest description of both rather than a wish list.

## The most useful thing you can send

**A bug report.** Especially one from actually playing at
[shinobijourney.com](https://shinobijourney.com/). Open an issue with what you
did, what happened, and what you expected. Say which browser and device — several
past regressions were one browser only, and that detail has been the difference
between a fix in a day and a fix in a month.

Player-side questions ("is this a bug or am I confused?") are usually faster in
[Discord](https://discord.gg/bCQGs8r6SK).

## Security is different

Do **not** open an issue for a vulnerability. Use
[private vulnerability reporting](https://github.com/Timehue/ShinobiX/security/advisories/new).
[SECURITY.md](SECURITY.md) covers what is in scope and the testing rules that
keep a proof of concept away from other players' saves — please read those before
probing anything, because this is a live game.

## Pull requests

There is no roadmap commitment on outside pull requests, and a large unsolicited
one is likely to sit. If you want to write code, open an issue first and say what
you have in mind. Small, obviously-correct fixes are welcome without ceremony.

If you do send one, these are the things that actually block a merge:

- **`npm test` from the repo root.** It is Node's test runner and never opens a
  browser, which is the single most common surprise here.
- **Any change to a screen or component also needs the Playwright suites**, run
  from `shinobij.client/`: `npm run test:e2e`, and
  `COMBAT_LAYOUT_CAPTURE_PHASE=after COMBAT_LAYOUT_STRICT=1 npm run
  test:e2e:combat-layout`. A change can pass lint, typecheck and 8,000+ unit
  tests and still redden CI on a screen it never touched.
- **`npm run lint` in `shinobij.client/`** for frontend changes.

[CLAUDE.md](../CLAUDE.md) documents the conventions in more depth, including the
ones that are load-bearing rather than stylistic: rewards are recomputed
server-side or gated on a single-use minted token, shared-state writes go through
`withKvLock`, and every `api/**` handler must be registered by hand in
`server.ts` or it is simply unreachable.

## What will get declined

Changes to reward rates, drop odds, combat formulas, cooldowns, AP costs or
currency payouts. Those are balance decisions on a live economy, not code
opinions — open an issue and make the case instead.

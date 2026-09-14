# Logout save recovery

Prepared on `codex/first-contract-logout-recovery-20260913` from main at `83538f517` in an isolated worktree.

An immediate logout can hit the existing save burst limit after First Contract activity. Previously, the client discarded the HTTP 429 retry hint and displayed the generic loss warning. A committed contract record can already be on the server when the final generic save is rejected.

Required saves now retain a validated `retryAfterMs` hint in `SaveRateLimitError`. Logout explains the pause, distinguishes previously saved progress from unconfirmed changes, and offers **Stay logged in**, with instructions to wait and choose **Logout** again. Missing or malformed hints use general waiting advice. The existing explicit **Log out anyway** choice remains available.

The server rate limits, save serialization, version authority, conflict recovery, pending payload protection, autosave behavior, and requirement to await acknowledgement before normal logout are unchanged. Other failures keep the existing dialog. This does not claim that a rejected save committed, add automatic retries, or change contract completion or rewards.

## Validation

- 89 focused client tests passed: persistence, logout error classification, pending save/unload protection, save queue, conflicts, account/version authority, and App size.
- 67 server and First Contract tests passed: rate limits, save versions, versioned writes, Academy ownership, contract state, and mission-claim recovery.
- Focused ESLint passed for every changed TypeScript file.
- Server TypeScript build passed.
- Client TypeScript and production build, distribution verification, and size checks passed.
- 21 production-bundle browser checks passed across Chromium desktop (1366 × 768), Chromium compact (360 × 640), and WebKit mobile (390 × 844). This includes 12 logout recovery cases and all 9 existing First Contract cases in those projects.
- The existing Academy-to-First-Contract journey passed against built local Express with real authentication and persistence (0 ms starter delay; starts on desktop and switches to mobile).
- Desktop and compact-mobile dialog screenshots were inspected; copy and both actions fit without clipping. Browser output is under `shinobij.client/test-results/logout-save-recovery-*`.

The new browser fixture exercises the real client with controlled server responses, including a held acknowledgement, cancellation, explicit force-logout, missing timing hints, and contract restoration through login. These checks establish client recovery behavior; server persistence and rate-limit enforcement are covered separately.

The first Express test-runner attempt under local Node 24 exited before any tests ran. The completed Express run used the cached Node 22.23.1 runtime from the earlier release checks. The complete game-wide CI suite was not run for this local fix; the results above describe the focused coverage.

No push or production deployment was performed for this fix.

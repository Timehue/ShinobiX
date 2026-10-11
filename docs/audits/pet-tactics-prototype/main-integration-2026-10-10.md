# Pet Arena main integration

The owner requested checking live `main` and pushing the completed Pet Arena
changes to it. Before integration, both remote `main` and the public production
health endpoint reported `9df80b825159f14d3b444aeb3b964f846b67c36e`; health was
`ok: true`. Its [CI run](https://github.com/Timehue/ShinobiX/actions/runs/38074431778)
and [Production Image run](https://github.com/Timehue/ShinobiX/actions/runs/38074431719)
completed successfully. The candidate merges all 43 commits added since this
worktree's original base, preserving their save-handling and war fixes.

## Release validation

- The merged selected integration, authority, navigation, presentation and
  save-coordinator tests pass all 274 checks.
- The final selected navigation, callback-wiring, App source-budget, CI-workflow
  and deployment-config selection passes 72 checks; this selection overlaps the
  larger test run and is not an additional distinct-test count.
- The refreshed desktop/mobile browser run completes all 14 ranked rounds with
  no browser errors or failed assets, sealed drafts, reconnect, search
  cancellation, updated resource bars, one Elo receipt per participant and a
  working return to the squad builder. See [the browser report](ranked-browser-report.json).
- Local fresh-account certification against the built Express server passes
  all 92 checks, including reward idempotency, save preservation, participant
  permissions and authoritative PvP settlement. This uses isolated local memory
  storage and does not certify production Postgres contention.
- React lifecycle lint findings in the new menu were repaired: clock
  initialization is lazy, the displayed server offset uses state, and recovery
  and settlement callbacks use cancellable scheduled effects. No combat numbers
  changed. Full client lint passes with zero errors and 16 warnings.
- Client builds use every public test `VITE_*` setting from the Production Image
  workflow, including Supabase, Sentry and analytics, with a real 40-character
  source SHA. Both final builds, packaging, all size gates and deployment
  configuration checks pass.
- The broad [balance report](matchup-report.json) still owns the 12,528-match and
  24,192-signature results; the numerical resolver and roster are unchanged by
  the main integration. The species tuning watch list remains applicable.

## Installed-code allowance

Live main's Production Image measured 9,343,255 bytes of budgeted product JS/CSS.
The final integrated production-setting build measures 9,406,369 bytes, a
63,114-byte increase for the new twelve-pet mode, private command transport,
builder and illustrated menu. The older local-only checkpoint had measured
9,349,516 bytes without the full production arguments and was not a deployment
size measurement.

The total installed-code allowance is now 9,430,000 bytes, providing 23,631 bytes
of variance around the measured feature. Startup, per-chunk, CSS, gzip,
asset and separately bounded lazy Sentry limits retain their existing values.
No check is disabled and no code is excluded from its previous measurement.
The refreshed final build passes those gates before the push.

Pushing `main` invokes the repository's CI and production deployment pipeline.
Remote branch acceptance, CI completion and a live health response reporting the
new SHA are distinct events; a successful push alone does not establish the
last two. Human playtesting and a production storage failure drill remain
outside this release evidence.

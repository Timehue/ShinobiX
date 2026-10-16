# Real Postgres integration review

> Raw evidence files linked from this page (logs, transcripts, screenshots) were removed on 2026-10-16 to cut repository weight. Retrieve one with `git show 5124ba3f2:<path>`.

October 12, 2026. Follow-up to the [Anbu async/queue CI review](anbu-async-queue-ci-review.md).

## Database and isolation

The 14 previously skipped storage tests now run against **PostgreSQL 16.15**,
matching the hosted CI job's Postgres 16 major version. This uses the actual
`pg` driver and `api/_storage.ts` adapter. The suite reads the real KV table and
function definitions from `supabase-schema.sql`.

The portable binaries came from the [official EDB binary download page](https://www.enterprisedb.com/download-postgresql-binaries),
Windows archive `postgresql-16.15-5-windows-x64-binaries.zip` (373,254,386 bytes).
The downloaded archive's SHA-256 is
`43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281`.
This is a recorded download fingerprint, not a separately published signature.

The database is a new workspace-local cluster, with a random password, SCRAM
authentication, and a loopback-only listener on an automatically selected port.
No existing database or machine service was used. Binaries, credentials, and
cluster files were kept in ignored `.tmp`; credentials are absent from review logs.
The original test database was empty after the suite: no remaining KV rows,
test trigger, or test sequence. Its server was stopped and its cluster, temporary
credentials, and downloaded zip were removed. Portable runtime binaries remain
available for repeat runs. Both helper checks stopped and removed their own clusters.

## Results

| Check | Result |
| --- | --- |
| Standalone real-Postgres suite | 14 passed; 0 failed, cancelled, or skipped |
| Reusable helper against another fresh real-Postgres cluster | 14 passed; 0 failed, cancelled, or skipped; automatic shutdown and cleanup passed |
| Full unsharded `npm run test:ci`, with Postgres required | **14,781 passed; 0 failed, cancelled, or skipped; exit 0** (1,708 suites; 612,876 ms) |
| Helper syntax and npm command dispatch | Passed |
| Generated tooling handoffs and deployment contract after adding the helper | Passed |
| Whitespace check | Passed |

The tests verify all-or-nothing commits, rollback after earlier writes really
executed, expired versus live predecessors, JSONB equality, exact conditional
deletes/assertions, `FOR SHARE` blocking and committed-row rechecks, opposite-order
transaction serialization, 25 rounds of competing batches, and live/expired/stolen
lock leases. The deadlock control really produces a Postgres `40P01` victim,
whereas the same schedule through production `compareSetMany` serializes safely.
No storage implementation change or weakened assertion was needed for these 14 tests.

The full-run command sets `PG_INTEGRATION_DATABASE_URL` and
`PG_INTEGRATION_REQUIRED=1`, clears sharding, and invokes the existing canonical
`npm run test:ci`. No CI timeout, budget, assertion, or skip condition was relaxed.
The separate paid/live Tebex contract remains disabled. This is local execution;
it does not claim a hosted GitHub run, production database capacity, or deployment.

Logs: standalone Postgres,
final npm helper and cleanup,
first helper check,
full CI with Postgres enabled,
original database cleanup,
handoffs, deployment contract.

## Repeat

A new helper, [test-with-postgres.mjs](../../../scripts/test-with-postgres.mjs),
owns an isolated database for each invocation and stops/removes it afterward.
Its default runs the same full runner as `test:ci`, unsharded, with Postgres tests
required. It also propagates a failing test process's exit status.
After root/client dependencies and Postgres 16 binaries are present:

```powershell
npm run test:ci:postgres -- --pg-bin=.tmp/pg-local/pgsql/bin
```

Use your installed/portable binary directory for `--pg-bin`. Add
`--integration-only` for just the 14 tests. The helper downloads nothing, installs
no service, and ignores any supplied integration database URL in favor of its own
fresh cluster. [The CI guide](../../CI.md#real-postgres-tests-locally) records the
same command.

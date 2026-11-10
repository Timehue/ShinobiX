# One-run WebKit protocol capture

This temporary branch runs one unchanged responsive shard against source
`48b6d32b2099864aa6c8511fbc055babf30cd819`, the merge source actually tested by
CI 42840281963. It does not modify PR 87, main, product code, specs, configuration,
release gates, concurrency or deployment.

## Immutable inputs and run scope

- Source parents: main `c2fc405f08ba96839b890379551e585eccd18a8d` and helper
  `cd7394dd1bfe948186bd7348073d7cf8a7c23274`.
- Release artifact 13777075325, exact name
  `release-dist-48b6d32b2099864aa6c8511fbc055babf30cd819-42840281963`.
- ZIP SHA256: `68c92e31f0b4cee0a19d0a797c1fb1a495c97ab3ea54f4168582d1b0fa212615`.
  Workflow validates REST provenance, ZIP digest, inner tar checksum and
  `sha/run_id/run_attempt` provenance before extracting. No rebuild.
- Exact temporary branch push trigger, no PR or dispatch trigger, one
  Ubuntu 26.04 job, attempt 1 only. Normal workflows remain untouched.
- Main-idle checks before setup and immediately before the shard; any active
  main run fails closed, without a retry. Recheck before publishing as well.
- Original command: `npm run test:e2e --prefix shinobij.client -- --shard=9/12`.
  Source configuration retains two workers, one CI retry, 45-second tests,
  31-minute test step and 35-minute job. Capturing does not add any retry or timer
  that kills a child. The wrapper preserves the child exit code/signal.

## Privacy boundary and bounds

The preload is inherited by actual Playwright workers. It removes DEBUG and
DEBUG_FILE before requiring the pinned core bundle. Its SHA256 must be
`9393fa79e1c67c74edc26b610d65a4f7ed73d345a762465cc88340a33a2454ac`.
The exported debugLogger boundary is replaced before protocol/browser output
can reach stderr, worker IPC, reporters or files. No raw fallback exists.

Only fixed method/event/type enums, safe integers/booleans, timestamps and
per-process keyed HMAC identifiers/code fingerprints are emitted. Ephemeral
HMAC keys never leave memory. Expressions are classified locally; arguments,
values, URLs, headers, cookies, storage, body text, errors and launch command
lines are discarded. Unknown fields/methods are not emitted as strings.
The child environment retains only enumerated runtime paths, locale, normal
CI identity/build metadata and browser paths/display setup. It excludes tokens,
credentials, unrelated application environment and inherited Node/debug options.

Limits:

- 1 MiB protocol input, 8192 bytes per projected record, nested protocol depth 2.
  Playwright's existing logger stringify is still before its 1 MiB truncation;
  no raw log or raw payload spool is created by these tools.
- Per process: two rotating 1 MiB sanitized tail segments and one 2 MiB target
  window. At most 64 exclusive process directories, total 256 MiB plus summaries.
  One bounded 32 KiB write batch, with at most one additional 8192-byte record.
- The target window starts at the first existing helper pending marker for
  snare-pass, choose-attacker or attack-target in wide 1366x768 webkit-mobile,
  retry 0. The same console.info call is forwarded unchanged. The marker's
  locator/moves/body are never retained by the new logger.
- The window copies the newest 512 KiB of the safe tail and then retains at most
  1.5 MiB more over 90 seconds. It is allocated only once per process. The ordinary
  tail keeps rotating. The shared capture deadline is 31 minutes after launch.
- Malformed/oversized/upstream-truncated inputs, nested omissions and invalid
  IDs emit safe timestamped reason/count records. Summary counters report tail
  overwrites, target saturation, deadline losses, write failures and missing
  slots. No cap stops draining ordinary child output.

## Interpretation and limitations

Read pending-target.jsonl first for the reproduced wide mobile pending click.
Then read tail segments ordered by sequence, deduplicating matching pid/seq
records across the tail and frozen window. Request IDs are scoped by process,
page/target/session; correlate nested WebKit requests/replies separately from
outer Target envelope acknowledgements. HMAC identifiers correlate only inside
one process. Context creation maps safe world enums to handles; selectorArray
marks the pinned identity callback used by queryArrayInMainWorld. Snapshot and
probe code have separate roles and fingerprints. The tiny browser smoke tests
these classifications on actual worker traffic.

Missing responses are not proof of a browser hang if the relevant interval has
omissions, saturation, overwritten history, write failure or a missing summary.
A sudden OS kill may lose the final write batch and summary. A window on a
previous pending stage can fill before a later failure; counters reveal this.
This observes protocol send/reply boundaries, not proof that browser JavaScript
started or completed. Instrumentation itself adds bounded CPU/I/O overhead.

Ordinary existing Playwright reports/traces/screenshots remain ordinary test
evidence and can contain page content and existing browser error logs. In
particular, Playwright's pre-existing RecentLogsCollector is unchanged. New
protocol/browser debug output does not feed that collector. No claim is made
that all ordinary test evidence is sanitized.

## Local validation

Run from the source worktree with the pinned Node version:

- `node --test scripts/diagnostics/webkit-protocol/capture.test.mjs`
- `node scripts/diagnostics/webkit-protocol/smoke.mjs`

The first covers canaries, nested replies, malformed/oversized inputs, strict
browser grammar, environment removal, exact nonzero/timeout child results,
retention rotation, single-window capture, failures and POSIX signals (the
signal fixture is skipped on Windows and runs on the Ubuntu diagnostic job).
The second runs two tiny actual WebKit worker tests, not the release shard,
with HTML/JSON reports and traces. It scans retained files and all ZIP entries
for runtime-injected fake logger canaries and proves DEBUG_FILE was not opened.
It also checks actual context/selector-array/actionability/snapshot/probe events
and snapshot replies. Fixture source uses encoded synthetic inputs so the
normal source attachment cannot create a false raw-logger finding.

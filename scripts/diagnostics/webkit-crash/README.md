# One bounded WebKit crash capture

This isolated branch is evidence gathering, not a release check or a repair.
Main `bf186de065949176f957824ca88a0841cb1295cd` failed the wide Chronicle
Snare scenario in responsive shard 4. Its retained retry trace reports
`Target crashed` before test teardown, but retains no native crash reason.

The workflow runs the original shard once against that exact source and the
checksum-verified release artifact from run `43270566559`. It does not change
the test, ordinary clicks, assertions, browser package, two workers, retries,
timeouts, application behavior, or any release gate. Production credentials
are not supplied. A passing diagnostic does not establish a repair.

The only additional observations are bounded, allowlisted browser-process
events and five-second resource samples. Launch arguments, environment values,
raw protocol payloads, and unrecognized browser-debug payloads are not retained.
Ordinary test output and the existing trace/video artifacts remain ordinary
test evidence. Capture overhead can perturb scheduling, so compare timing with
that limitation in mind.

The branch-creation and attempt-one guard admits only one run. Both source
identity and absence of active main work are checked before setup and again
before the shard. A moved main, active main run, expired artifact, mismatched
digest, or failed dependency setup stops this experiment. Do not force or rerun
it to evade a failed guard. Never count its result as normal CI qualification.

Local validation runs only the Node unit tests, not another browser shard:

```sh
node --test scripts/diagnostics/webkit-crash/*.test.mjs
```

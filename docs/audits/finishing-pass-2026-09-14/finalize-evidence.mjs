import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const directory = new URL('./', import.meta.url);
const read = name => fs.readFileSync(new URL(name, directory), 'utf8');
const finalTests = read('final-root-tests.log');
assert(finalTests.includes('TEST RUN PASSED'), 'Final root suite must finish successfully before producing the handoff evidence.');
const rootCounts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'].map(key => {
 const match = finalTests.match(new RegExp(`ℹ ${key} ([0-9.]+)`));
 assert(match, `Missing final test count: ${key}`);
 return [key, Number(match[1])];
}));
assert.equal(rootCounts.fail, 0);
assert.equal(rootCounts.cancelled, 0);
assert.equal(rootCounts.skipped, 0);
assert(read('final-build.log').includes('[sizecheck] PASS.'));
assert(read('full-e2e.log').includes('641 passed (32.8m)'));
assert(read('mobile-gauntlet.log').includes('256 passed (21.4m)'));
assert(read('combat-layout.log').includes('19 passed (39.6m)'));

const logNames = [
 'scholars-before.log', 'main-scholars-after.log', 'main-root-tests.log',
 'clan-receipt-guard-before.log', 'clan-receipt-guard-after-corrected-fixture.log',
 'final-root-tests.log', 'final-build.log', 'final-server-typecheck.log',
 'main-lint.log', 'full-e2e.log', 'mobile-gauntlet.log', 'worldmap-repro.log',
 'combat-layout.log', 'firefox-solo-retry.log',
 'release-certification.log', 'release-certification-retry.log',
 'topology.log', 'rollback-readiness.log', 'mission-eligibility.log',
 'release-assets.log', 'runtime-docs-check.log',
];
const evidence = {
 auditedBase: 'ecd8d6ccaba017a6791ec0ec94f822c10658984d',
 codeCommit: '83df471d2eede0265bfad1f6a4fb89e97d33c721',
 mainAtCloseout: '21e2cc39262422cf2333b068b0588640352226b7',
 mainAdvance: '10 commits, 57 paths. Backend/shared/routes/root dependencies and client doctrine/village helpers unchanged. Newer main CSS is outside these browser results; combined integration checks remain required.',
 branch: 'codex/coherence-integrity-closeout-20260914',
 runtime: 'Node 22.23.2 on Windows; disposable memory for API fault injection and local certification',
 finalRootTests: { command: 'npm test', exitCode: 0, ...rootCounts },
 finalBuild: { command: 'npm run build', exitCode: 0, result: 'PASS; existing size warning retained; no threshold increase' },
 lint: { command: 'npm run lint (client)', exitCode: 0, errors: 0, warnings: 14 },
 fullBrowser: { command: 'npm run test:e2e -- --workers=2 (client)', exitCode: 0, passed: 641, skipped: 512, failed: 0 },
 mobileGauntlet: { exitCode: 1, passed: 256, skipped: 67, failed: 2, finding: 'World Map 44px assertions at 430x932 and 844x390. Reproduced; measured scaled size 43.97/43.95px. No proven inaccessible control, production layout change, or threshold relaxation.' },
 strictCombat: { exitCode: 1, passed: 19, skipped: 10, failed: 1, finding: 'Firefox Solo-PvE timed out at login restoration before combat. The exact unchanged case passed on a fresh memory-server retry; the original invocation remains failed.' },
 strictCombatRetry: { exitCode: 0, passed: 1, failed: 0 },
 releaseCertification: { passed: 90, failed: 0, scope: 'Local real Express with disposable memory; initial startup-only failure and successful retry both retained.' },
 productionChanges: ['api/missions/_mission-catalog.ts', 'api/_clan-save-validate.ts'],
 newBehavioralTests: ['scripts/clan-doctrine-parity.test.mjs (12)', 'api/_clan-save-receipts.test.ts (7)'],
 unresolved: ['C2 pet bonus stacking', 'C3 interrupted clan mission shared credit', 'C4 Exchange lost acknowledgement and refund', 'remaining UNRESOLVED contract and adversarial cells'],
 humanCertification: 'Not executed: real deployment/storage/backup/restore/rollback, staffed war/boss/admin/creator operations, physical Android.',
 logRetention: 'Logs and screenshots remain local in this worktree. This manifest retains their SHA-256 and outcome; they are not source-controlled product files.',
 logs: logNames.map(file => {
  const bytes = fs.readFileSync(new URL(file, directory));
  return { file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
 }),
};
fs.writeFileSync(new URL('validation-results.json', directory), JSON.stringify(evidence, null, 2) + '\n');
const minutes = (rootCounts.duration_ms / 60_000).toFixed(1);
let report = read('REPORT.md');
report = report.replace('| Final root `npm test` after C5 | Pending final run; must be updated before handoff. |', `| Final root \`npm test\` after both fixes | **${rootCounts.pass.toLocaleString('en-US')}/${rootCounts.tests.toLocaleString('en-US')} passed**, 0 failed/cancelled/skipped, ${minutes} minutes. |`);
report = report.replace('Full final suite required.', 'Final full root suite passed.');
report = report.replaceAll('assertions ;', 'assertions;').replaceAll('combinations ;', 'combinations;');
fs.writeFileSync(new URL('REPORT.md', directory), report);
fs.writeFileSync(new URL('WORKING-NOTES.md', directory), `# Finishing-pass provenance

Task-start checkout: e3c09fe10988badc2a4b6a96f1f1bf4c085428b3, substantial pre-existing changes preserved.
Audited isolated base: ${evidence.auditedBase}.
Branch: ${evidence.branch}.
Main at final read-only check: ${evidence.mainAtCloseout}; ${evidence.mainAdvance}

Read the supplied handoff, both CLAUDE.md files, LIVE_PRODUCT_STATUS, ROADMAP,
current relevant GitHub issues and the existing audit/security/runbooks.
All four workstreams and the consolidated seven-section REPORT.md are delivered.
C1 and C5 are the only production changes; 19 focused behavioral tests added.
C2 requires progression intent, C3/C4 require approved durable recovery protocols.
No UI, schema, storage structure, auth, role, economy table or deployment change.

Final root suite: ${rootCounts.pass}/${rootCounts.tests} passed, no failures/cancellations/skips, ${minutes} minutes.
Final full build passed; lint passed with 14 existing warnings.
Full browser: 641 passed, 512 skipped, no failures.
Mobile gauntlet: 256 passed, 67 skipped, two reproducible World Map size assertions.
Strict combat: 19 passed, 10 skipped, one login-stage Firefox timeout;
the exact unchanged case passed on isolated retry. Neither original red gate is hidden.
Local Express/memory release certification: 90/90 passed after a startup-only failure.
Artifact consistency and source-reference validation passed.

validation-results.json records the final log hashes and results. Raw logs and images
remain local. Original-checkout logs are preliminary provenance, not release evidence.
The memory clan probes preserve the pre-C5 result; rerunning them after the guard
changes that result, so retain historical evidence before rerunning.
No physical Android, production mutation, remote restore/rollback or staffed live
certification was performed. No GitHub issue was closed, and no branch was pushed.
`);
console.log(JSON.stringify({ finalRootTests: evidence.finalRootTests, result: 'Final evidence assembled; mobile and original strict gates retain their failures.' }, null, 2));

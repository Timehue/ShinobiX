// Capture the approved recovery follow-up separately from the original audit.
// Run after its final code commit and gates; retained raw logs are local artifacts.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const directory = 'docs/audits/finishing-pass-2026-09-14/';
const read = name => fs.readFileSync(directory + name, 'utf8');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function summary(file) {
    const log = read(file);
    return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'].map(field => {
        const match = log.match(new RegExp(`(?:#|ℹ) ${field} ([0-9.]+)`));
        assert(match, `${file}: missing ${field}`);
        return [field, Number(match[1])];
    }));
}
const finalRoot = summary('recovery-final-root-tests.log');
const focused = summary('recovery-final-focused.log');
assert.equal(finalRoot.fail, 0);
assert.equal(finalRoot.cancelled, 0);
assert.equal(focused.fail, 0);
assert.match(read('recovery-final-build.log'), /\[sizecheck\] PASS/);
assert.match(read('recovery-final-lint.log'), /0 errors, 14 warnings/);
assert.match(read('recovery-browser.log'), /4 passed/);
assert.match(read('recovery-local-certification.log'), /90\/90 checks passed/);

const codeFiles = [
    'api/_clan-points.ts', 'api/_clan-save-validate.ts',
    'api/clan/_exchange.ts', 'api/clan/exchange/purchase.ts', 'api/clan/exchange/_settlement.ts',
    'api/clan/mission/claim.ts', 'api/clan/mission/_settlement.ts',
    'api/pet/_progress.ts', 'api/pet/progress.ts', 'api/save/_state-ownership.ts',
    'shared/clan-exchange-intent.ts',
    'shinobij.client/src/lib/clan-exchange-intent.ts', 'shinobij.client/src/lib/player-api.ts',
    'shinobij.client/src/lib/save-ownership.ts',
    'api/clan/_reward-recovery.test.ts', 'api/pet/training-clan-bonus.test.ts',
    'api/_clan-save-receipts.test.ts', 'api/_settlement-contract.test.ts',
    'api/save/_sanitize-clan-points.test.ts', 'api/save/_state-ownership-parity.test.ts',
    'shinobij.client/src/lib/clan-exchange-retry.test.ts',
];
const codeCommit = execFileSync('git', ['log', '-1', '--format=%H', '--', 'api/clan/exchange/_settlement.ts'], {encoding:'utf8'}).trim();
assert(codeCommit, 'Commit the reviewed recovery code before capturing evidence.');
const results = {
    capturedAt: new Date().toISOString(),
    auditedBase: 'ecd8d6ccaba017a6791ec0ec94f822c10658984d',
    priorCodeCommit: '83df471d2eede0265bfad1f6a4fb89e97d33c721', codeCommit,
    branch: 'codex/coherence-integrity-closeout-20260914',
    ownerApprovals: ['Narrow C3/C4 recovery with protected receipts', 'Additive C2 bonus for new training', 'Local checks only'],
    runtime: process.version,
    initialFullRun: summary('recovery-root-tests.log'),
    initialFailures: ['Old Exchange source inventory marker', 'Client ownership mirror missing two new protected receipt fields'],
    finalRoot: {command:'npm test', exitCode:0, ...finalRoot},
    focused: {exitCode:0, ...focused},
    build: {command:'npm run build', exitCode:0, distAndSize:'PASS; no budget increase'},
    lint: {command:'npm run lint (client)', exitCode:0, errors:0, existingWarnings:14},
    clanBrowser: {passed:4, skipped:17, failed:0, scope:'Existing clan-integrity-ux and clan-mobile-roster specs; before final ownership-mirror correction, covered separately by parity and full root tests.'},
    localExpressMemoryCertification: {passed:90, failed:0, scope:'Built server HTTP reward/auth/persistence certification; not Postgres restart or deployed restore.'},
    originalMobileOutcomes: {gauntlet:'256 passed / 67 skipped / 2 World Map subpixel assertions', combat:'19 passed / 10 skipped / 1 login-stage Firefox timeout; unchanged isolated retry passed', fullBrowser:'641 passed / 512 skipped'},
    sourceHashes: Object.fromEntries(codeFiles.map(file => [file, sha(fs.readFileSync(file))])),
    logs: fs.readdirSync(directory).filter(file => /^(recovery.*|pet-bonus-before)\.log$/.test(file)).sort().map(file => {
        const bytes = fs.readFileSync(directory + file);
        return {file, bytes:bytes.length, sha256:sha(bytes)};
    }),
    limitations: [
        'Historical ambiguous transactions and old training rewards are untouched.',
        'Legacy no-ID Exchange callers cannot distinguish lost final success from a genuine second purchase.',
        'Session-storage identity does not promise cross-device/closed-session recovery.',
        'Current-week mission admission does not automatically reconcile prior-week pending work.',
        'Deployed storage, restore, process restart, compatible-image rollback and physical Android certification remain unexecuted by owner choice.',
        'Original browser evidence does not certify newer main CSS; combined integration gates remain required.',
    ],
};
fs.writeFileSync(directory + 'recovery-validation.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({codeCommit, finalRoot:results.finalRoot, focused:results.focused, sourceFiles:codeFiles.length, logs:results.logs.length}, null, 2));

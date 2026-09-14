// Run after the second-review code commit and final local gates.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const directory='docs/audits/finishing-pass-2026-09-14/';
const read=name=>fs.readFileSync(directory+name,'utf8');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function summary(file) {
    const log=read(file);
    return Object.fromEntries(['tests','pass','fail','cancelled','skipped','duration_ms'].map(field=>{
        const match=log.match(new RegExp(`(?:#|ℹ) ${field} ([0-9.]+)`));
        assert(match,`${file}: missing ${field}`);
        return [field,Number(match[1])];
    }));
}
function browser(file) {
    const log=read(file).replace(/\u001b\[[0-9;]*m/g,'');
    const count=word=>Number([...log.matchAll(new RegExp(`(?:^|\\n)\\s*(\\d+) ${word}\\b`,'g'))].at(-1)?.[1]??0);
    const result={passed:count('passed'),skipped:count('skipped'),failed:count('failed')};
    assert(result.passed>0,`${file}: browser suite did not complete`);
    return result;
}
const root=summary('second-review-root-tests.log');
const focused=summary('second-review-focused.log');
assert.equal(root.fail,0);
assert.equal(root.cancelled,0);
assert.equal(focused.fail,0);
assert.match(read('second-review-build.log'),/\[sizecheck\] PASS/);
assert.match(read('second-review-lint.log'),/0 errors, 14 warnings/);
const fullBrowser=browser('second-review-full-browser.log');
const strictCombat=browser('second-review-strict-combat.log');
const changedFiles=[
    'api/_storage.ts','api/_storage-save-authority.test.ts',
    'shinobij.client/src/components/ClanExchange.tsx',
    'shinobij.client/src/lib/clan-exchange-intent.ts','shinobij.client/src/lib/player-api.ts',
    'shinobij.client/src/lib/clan-exchange-recovery.ts','shinobij.client/src/lib/clan-exchange-recovery.test.ts',
    'shinobij.client/e2e/clan-exchange-recovery.spec.ts',
];
const previous=JSON.parse(read('recovery-validation.json'));
const apiHashes=JSON.parse(read('api-source-hashes.json'));
const beforeApiHashes=JSON.parse(read('api-source-hashes-before-second-review.json'));
for (const [file,hash] of Object.entries(apiHashes)) assert.equal(sha(fs.readFileSync(file)),hash,`${file}: stale API inventory hash`);
assert.deepEqual(Object.keys(apiHashes).filter(file=>apiHashes[file]!==beforeApiHashes[file]),['api/_storage.ts']);
const sourceFiles=[...new Set([...Object.keys(previous.sourceHashes),...changedFiles,'api/missions/_mission-catalog.ts'])];
const codeCommit=execFileSync('git',['log','-1','--format=%H','--','shinobij.client/src/lib/clan-exchange-recovery.ts'],{encoding:'utf8'}).trim();
assert(codeCommit,'Commit the reviewed implementation first.');
const componentPath='shinobij.client/src/components/ClanExchange.tsx';
const beforeComponent=execFileSync('git',['show',`50964ac9d:${componentPath}`],{encoding:'utf8'}).replace(/\r\n/g,'\n');
const afterComponent=fs.readFileSync(componentPath,'utf8').replace(/\r\n/g,'\n');
const renderStart='    return (\n        <div className="clan-exchange">';
assert(beforeComponent.includes(renderStart)&&afterComponent.includes(renderStart));
assert.equal(afterComponent.slice(afterComponent.indexOf(renderStart)),beforeComponent.slice(beforeComponent.indexOf(renderStart)),
    'Exchange markup, card components and dialogs must remain unchanged');
const result={
    capturedAt:new Date().toISOString(),runtime:process.version,
    reviewedStartingCommit:'50964ac9d',codeCommit,
    auditedBase:'ecd8d6ccaba017a6791ec0ec94f822c10658984d',
    scope:'Second integration review of the approved recovery implementation; local checks only.',
    reproducedBeforeFix:[
        {file:'second-review-browser-before.log',result:'One failed browser test: zero recovery requests with a saved debit and exhausted points/stock.'},
        {file:'second-review-storage-before.log',result:'Two new get/mget authority tests failed; ten existing tests passed.'},
    ],
    correctedGaps:[
        'Exchange entry/online continuation for a retained ID whose protected save receipt shows an existing debit; no automatic unpaid purchase.',
        'Private mission/Exchange receipt reads bypass the process cache so recovery sees another worker\'s commit.',
    ],
    exchangeMarkupComparison:'Identical main render, card components and dialogs to the second-review starting commit.',
    testSetupCorrections:[
        'Initial browser fixture referenced a nonexistent helper; corrected before the meaningful red reproduction.',
        'Reconnect response listener initially attached after the default Exchange tab sent its request; moved before navigation. Same production build then passed all six focused mobile cases.',
    ],
    finalDiffCorrection:'A new regression test found that the intent extraction skipped the original session-storage write on a retry after storage recovered. Restored that write, passed the regression, and restarted all required validation. Superseded broad runs were deliberately interrupted and are not counted as completed gates.',
    root:{command:'npm test',exitCode:0,...root},focused,
    build:{command:'npm run build',exitCode:0,distAndSize:'PASS; no threshold changes'},
    lint:{command:'npm run lint (client)',exitCode:0,errors:0,existingWarnings:14},
    focusedBrowser:browser('second-review-browser-after.log'),fullBrowser,
    villageRetry:{...browser('second-review-village-retry.log'),
        reason:'The broad Chromium-desktop Village case reported repeated net::ERR_NETWORK_CHANGED and failed to import an existing chunk. The exact unchanged case passed on a fresh preview.',
        asset:'assets/c-PTi7pRjH.js',buildAndSnapshotSha256:'e00f466b68efbdcb8a0b3b47a3d89ba054d1a6d9e9aa2ee43af7051d7f8835f5'},
    ceremonyRetry:{...browser('second-review-ceremony-retry.log'),
        reason:'Firefox first-contract ceremony timed out at page.goto networkidle before assertions. Screenshot showed the complete ceremony; the exact unchanged case passed on a fresh preview.'},
    strictCombat:{...strictCombat,capturePhase:'after',strict:true},
    sourceHashes:Object.fromEntries(sourceFiles.map(file=>[file,sha(fs.readFileSync(file))])),
    apiInventoryVerification:{matchedFiles:Object.keys(apiHashes).length,changedSinceSecondReviewStart:['api/_storage.ts']},
    logs:fs.readdirSync(directory).filter(file=>/^second-review.*\.log$/.test(file)).sort().map(file=>{
        const bytes=fs.readFileSync(directory+file);
        return {file,bytes:bytes.length,sha256:sha(bytes)};
    }),
    preserved:'No markup/CSS, prices, rewards, limits, visible interaction, authorization, deployment or schema change.',
    limitations:[...previous.limitations,
        'Automatic Exchange recovery needs the retained session ID and a saved debit; it runs on Exchange entry or reconnect, with no polling.',
        'Mocked Postgres query tests certify cache behavior, not a real database restart/restore.',
    ],
};
fs.writeFileSync(directory+'second-review-validation.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({codeCommit,root:result.root,fullBrowser,strictCombat,sourceFiles:sourceFiles.length,logs:result.logs.length},null,2));

const expectedNames=[
 'two clients join the same encounter; periodic damage retains known and unknown attribution',
 'recovery accepts fresh active combat, naturally defeats the boss and settles once',
 'compatible recovery resumes stored terminal encounters, exact expiry and action receipts',
 'database fault interrupts receipt publication after shared HP was banked',
 'candidate resumes interrupted recovery settlement without banking twice',
 'recovery settles the known owner and exposes leaderboard credit',
 'returning to candidate preserves save versions and settlement receipts on replay',
];
export function qualificationReport(result){
 const reasons=[],checks=result.checks??[],runtime=result.runtime??[],images=result.images??{};
 if(['candidate','recovery'].some(role=>!/^sha256:[a-f0-9]{64}$/.test(images[role]?.imageId??'')||!(/^[a-f0-9]{40}$/).test(images[role]?.source??'')||!(/^[a-f0-9]{64}$/).test(images[role]?.archiveSha256??'')))reasons.push('Pinned image identities and archive checksums are required');
 if(result.failed!==0||result.error)reasons.push('A runtime or gameplay failure was recorded');
 if(result.passed!==expectedNames.length||checks.length!==expectedNames.length||expectedNames.some(name=>checks.filter(c=>c.name===name&&c.passed===true).length!==1))reasons.push('All seven required scenarios must pass once');
 const active=checks.find(c=>c.name===expectedNames[1]),replay=checks.find(c=>c.name===expectedNames[6]);
 const legacyEnabled=result.runtimeFlags?.legacyEnabled===true;
 if(legacyEnabled&&(runtime.some(r=>r.legacyEnabled!==true)||active?.legacyOperationCreditOnce!==true
  ||checks.find(c=>c.name===expectedNames[3])?.legacyUnattributedOperations!==0
  ||checks.find(c=>c.name===expectedNames[4])?.legacyCreditBeforeInterruptedMatch!==1
  ||checks.find(c=>c.name===expectedNames[4])?.legacyPendingReceiptPresent!==true
  ||checks.find(c=>c.name===expectedNames[5])?.legacyCredit!==1
  ||checks.find(c=>c.name===expectedNames[5])?.legacyReceiptAcknowledged!==true
  ||checks.find(c=>c.name===expectedNames[5])?.interruptedPaidSaveUnchanged!==true||replay?.legacyStatsUnchanged!==true))reasons.push('Enabled Legacy credit, interrupted delivery and replay evidence is incomplete');
 if(!active?.activeBeforeHandoff||!active.expiryPreservedBeforeNewInput||!(active.freshActions>0)||!active.naturalRaidBossDefeat||!replay?.freshRecoveryActionReplayedOnCandidate)reasons.push('Fresh active-fight and cross-image replay evidence is required');
 if(runtime.map(r=>r.role).join(',')!=='candidate,recovery,candidate,recovery,candidate'||runtime.some(r=>!images[r.role]||r.imageId!==images[r.role].imageId||r.healthCommit!==images[r.role].source||r.node!=='v24.21.0'||r.pid1?.uid!==1000||r.pid1?.command?.join(' ')!=='node dist/server.js'||r.pid1?.executable!=='/usr/local/bin/node'||!r.defaultCommand||r.user!=='node'||!r.readOnlyRoot||r.publishedPorts!==false||!r.retiredAndNoDatabaseSessions))reasons.push('Exact image runtime and retirement evidence is incomplete');
 if(result.productionAccess!==false||result.postgres?.passwordAuthenticationRequired!==true||result.cleanup?.complete!==true||result.cleanup?.errors?.length!==0)reasons.push('Isolation, database authentication and successful cleanup are required');
 return{status:reasons.length?'failed':'passed',scope:'Seven isolated world-boss HTTP scenarios including fresh active-fight handoff and raid-encounter defeat; synthetic QA images only',legacyEnabled,productionReleaseEligible:false,railwayImageIdentityVerified:false,requiredScenarios:expectedNames.length,passedScenarios:checks.filter(c=>c.passed).length,reasons,images:Object.fromEntries(['candidate','recovery'].map(role=>[role,{source:images[role]?.source,imageId:images[role]?.imageId,archiveSha256:images[role]?.archiveSha256}]))};
}

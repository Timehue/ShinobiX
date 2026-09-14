import fs from 'node:fs';
import assert from 'node:assert/strict';
const directory='docs/audits/finishing-pass-2026-09-14/';
const read=name=>JSON.parse(fs.readFileSync(directory+name,'utf8'));
const contracts=read('contract-matrix.json');
const values=read('value-path-registry.json');
const mobile=read('mobile-coverage.json');
const allowed=new Set(Object.values(contracts.classificationLegend));
const missing=[];
const counts={};
assert.equal(contracts.contracts.length,33);
assert.equal(contracts.rows.length,74);
assert.equal(new Set(contracts.rows.map(row=>row.mode)).size,contracts.rows.length);
for(const row of contracts.rows){
 assert.deepEqual(Object.keys(row.cells),contracts.contracts);
 for(const cell of Object.values(row.cells)){assert(allowed.has(cell));counts[cell]=(counts[cell]??0)+1;}
 for(const source of row.evidence)if(!fs.existsSync(source))missing.push(source);
}
for(const row of mobile.rows){
 assert(Object.hasOwn(mobile.legend,row.classification));
 for(const source of row.evidence)if(!fs.existsSync(source))missing.push(source);
}
for(const row of values.rows){
 assert(fs.existsSync(row.file));
 for(const field of ['activitySource','actorBinding','activityBinding','amountAuthority','clientTrustedFields','eligibilityProof','expiry','singleUseReplayProtection','atomicBoundary','durableReceipt','retrySemantics','partialFailureRecovery','adminSearchability','tests','featureKillSwitch'])assert(Object.hasOwn(row,field),`${row.file}: ${field}`);
}
assert.deepEqual([...new Set(missing)],[]);
const result={sourceReferenceValidation:'PASS',perCellClassificationValidation:'PASS',valueRegistryFieldValidation:'PASS',contractRows:contracts.rows.length,contractsPerRow:contracts.contracts.length,contractCellsByClassification:counts,valueSourceRows:values.rows.length,valueFamilies:values.families.length,mobileRows:mobile.rows.length,mobileCoverage:Object.fromEntries(Object.keys(mobile.legend).map(code=>[code,mobile.rows.filter(row=>row.classification===code).length])),limitation:'This validates artifact consistency and source-path existence, not gameplay behavior or completeness of individual authority proofs.'};
fs.writeFileSync(directory+'artifact-validation.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));

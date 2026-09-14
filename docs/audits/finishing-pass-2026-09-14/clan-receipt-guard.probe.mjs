// Failing behavioral contract for the pending, owner-reviewed security guard.
// This audit probe is intentionally outside the automatic repository test scan.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateClanSaveWrite } from '../../../api/_clan-save-validate.ts';
const prior = { name:'Audit Clan', founderName:'founder', members:[{name:'founder'}], treasury:{ryo:1000} };
const real = [{transactionId:'real-transaction',fingerprint:'real-fingerprint',resource:'ryo',amount:100,appliedAt:1}];
const forged = [{transactionId:'forged-transaction',fingerprint:'forged-fingerprint',resource:'ryo',amount:100,appliedAt:1}];
for(const callerName of ['founder','member']) {
 test(`${callerName} cannot forge a treasury debit receipt in a clan save`,()=>{
   const next=validateClanSaveWrite(prior,{...prior,settlementReceipts:forged},{callerName,isAdmin:false}).next;
   assert.equal(next.settlementReceipts,undefined);
 });
 test(`${callerName} cannot clear or replace existing treasury debit evidence`,()=>{
   for(const incoming of [[],forged]) {
     const next=validateClanSaveWrite({...prior,settlementReceipts:real},{...prior,settlementReceipts:incoming},{callerName,isAdmin:false}).next;
     assert.deepEqual(next.settlementReceipts,real);
   }
 });
}
test('ordinary clan edits retain the server treasury evidence',()=>{
 const next=validateClanSaveWrite({...prior,settlementReceipts:real},{...prior},{callerName:'founder',isAdmin:false}).next;
 assert.deepEqual(next.settlementReceipts,real);
});

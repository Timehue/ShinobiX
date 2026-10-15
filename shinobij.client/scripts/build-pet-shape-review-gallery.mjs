// Present completed, fingerprinted inspections; never create review approvals.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
const repo=resolve(import.meta.dirname,'../..');
const receipts=JSON.parse(await readFile(resolve(repo,'docs/audits/pet-animation-shape-reviews.json')));
const ledger=JSON.parse(await readFile(resolve(repo,'docs/audits/pet-animation-visual-review-progress.json')));
const output=resolve(repo,'docs/screenshots/pet-shape-2026-10-15/index.html');
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const local=file=>escape(relative(resolve(output,'..'),resolve(repo,file)).replaceAll('\\','/'));
const cards=runtimePetModels.map(({pet})=>{
 const receipt=receipts.pets[pet.id];if(!receipt)throw new Error(`Missing completed review: ${pet.id}`);
 const progress=ledger.pets[pet.id],repairs=[];
 if(progress.promotedSha256)repairs.push('Skull binding repaired');
 if(progress.rigNormalization)repairs.push('Rig scale normalized');
 if(progress.geometryRepair)repairs.push('Detached geometry removed');
 const images=receipt.evidence.filter(file=>file.endsWith('.webp'));
 return `<details data-search="${escape(`${pet.id} ${pet.name}`.toLowerCase())}"><summary><strong>${escape(pet.name)}</strong> <span>${escape(pet.id)}</span><small>${escape(repairs.join(' · ')||'Reviewed; no additional repair needed')}</small></summary>
 <p>${escape(receipt.findings.runtime)}</p><p><b>Source:</b> ${escape(receipt.findings.source)}</p><p><b>Battle:</b> ${escape(receipt.findings.battle)}</p>
 <div class="sheets">${images.map(file=>`<figure><figcaption>${escape(file.split('/').at(-1))}</figcaption><a href="${local(file)}" target="_blank" rel="noopener"><img loading="lazy" src="${local(file)}" alt="${escape(file.split('/').at(-1))}"></a></figure>`).join('')}</div>
 <p>Source SHA-256: <code>${receipt.sha256}</code><br>Battle SHA-256: <code>${receipt.lodSha256}</code><br>Reviewed: ${escape(receipt.reviewedAt)} · ${escape(receipt.reviewer)}</p>
 <a href="${local(receipt.evidence.find(file=>file.endsWith('.json')))}">Numeric evidence</a><p>${escape(receipt.limits)}</p></details>`;
}).join('\n');
await writeFile(output,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pet animation visual review — 161 completed</title>
<style>body{font:16px/1.55 system-ui;background:#101827;color:#edf2fa;margin:0 auto;padding:28px;max-width:1500px}h1{font-size:28px}p{max-width:1000px}a{color:#9dd9ff}input{font:inherit;padding:12px;width:min(500px,90%);background:#1c2b42;color:inherit;border:1px solid #7793b4;border-radius:6px;margin:12px 0 22px}details{background:#19263b;border:1px solid #40506a;border-radius:7px;padding:16px;margin-bottom:12px}summary{cursor:pointer}summary span{color:#b1c6df;margin-left:10px}small{display:block;color:#9fdfbc;margin:5px 0 0 18px}.sheets{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}figure{margin:0}img{width:100%;height:auto;background:#101827}figcaption{font-size:12px;overflow-wrap:anywhere}code{font-size:12px;overflow-wrap:anywhere}[hidden]{display:none}</style>
<h1>161 / 161 pet animation reviews complete</h1><p>Final evidence for all 13 clips, front and side head and body views, in source and battle assets. Each pet also has a production renderer review through 16 state and transition rows. Open a pet, then click a sheet for its full resolution.</p>
<p>Raw clip columns: front 0, 12.5, 37.5, 62.5, 87.5, 100%; then the same phases from the side. Runtime columns: front 2.5, 10, 25, 50, 75, 100%; then side. Rows are labeled on each sheet.</p>
<p>This gallery records sampled visual and geometric coverage. Asset, atlas, renderer and evidence hashes must remain current; a later change requires fresh inspection.</p>
<label for="search">Find a pet</label><br><input id="search" type="search" placeholder="Name or ID" autocomplete="off"><span id="count" aria-live="polite">161 pets</span><main>${cards}</main>
<script>const search=document.querySelector('#search'),cards=[...document.querySelectorAll('details')];search.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();let shown=0;for(const card of cards){card.hidden=!card.dataset.search.includes(query);if(!card.hidden)shown++;}document.querySelector('#count').textContent=shown+' pets';});</script></html>\n`);
console.log(`Wrote completed review gallery for ${runtimePetModels.length} pets: ${output}`);

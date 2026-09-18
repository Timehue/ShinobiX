import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { vnPortraitFrame } from '../src/lib/vn-portrait-framing.ts';
const root='../tmp/vn-art-audit/sizing';
const inventory=JSON.parse(await readFile(`${root}/inventory.json`,'utf8'));
const assets=JSON.parse(await readFile(`${root}/assets.json`,'utf8'));
const npc=JSON.parse(await readFile(`${root}/all-portraits/report.json`,'utf8'));
const avatar=JSON.parse(await readFile(`${root}/avatars-final/report.json`,'utf8'));
const props=JSON.parse(await readFile(`${root}/prop-framing/report.json`,'utf8'));
const reports=[...npc,...avatar,...props];
const failures=reports.filter(r=>r.errors.length||r.overflow>1||r.actors.some(a=>a.images.some(i=>!i.width)));
const missingNpc=npc.filter(r=>!r.actors.some(a=>a.images.some(i=>new URL(i.src).pathname===assets[+r.case.name.slice(4)].src)));
if(failures.length||missingNpc.length)throw Error(JSON.stringify({failures,missingNpc}));
const fitted=assets.filter(a=>vnPortraitFrame(a.src)).map(a=>({
    asset:a.src,name:a.name,frame:vnPortraitFrame(a.src),
    consumers:inventory.rows.filter(r=>r.presentations.some(p=>p.actors.some(actor=>actor.image.split(/[?#]/)[0]===a.src))).map(r=>r.key),
    captures:[1440,390].map(width=>{
        const r=[...props,...npc].find(r=>r.viewport.width===width&&r.actors.some(actor=>actor.images.some(i=>new URL(i.src).pathname===a.src)));
        return `${root}/${props.includes(r)?'prop-framing':'all-portraits'}/${r.file}`;
    }),
}));
await writeFile('../docs/art-audit/portrait-framing.json',JSON.stringify({coverage:inventory.coverage,portraits:assets.length,fittedPortraits:fitted.length,
    npcCaptures:npc.length,finalAvatarCases:avatar.length,propRefinements:props.length,errors:failures,missingNpc,
    assets:fitted},null,2));
const images=[];
for(const [i,phase] of ['before','final'].entries()){
    images.push({input:await sharp(`${root}/${phase}/npc-8-1440.png`).resize(900,563).png().toBuffer(),left:i*900,top:30});
    images.push({input:Buffer.from(`<svg width="900" height="30"><rect width="900" height="30" fill="#111"/><text x="16" y="21" fill="white" font-size="17">${i?'After: comparable face scale, readable player portrait':'Before: full-body NPC next to waist-up player'}</text></svg>`),left:i*900,top:0});
}
await sharp({create:{width:1800,height:593,channels:3,background:'#111'}}).composite(images).jpeg({quality:92}).toFile(`${root}/before-after.jpg`);
console.log({portraits:assets.length,fitted:fitted.length,verifiedCaptures:reports.length,errors:0,missingNpc:0});

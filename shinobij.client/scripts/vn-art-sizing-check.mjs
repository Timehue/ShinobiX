import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const phase = process.argv[2] || 'after';
const output = path.resolve(`../tmp/vn-art-audit/sizing/${phase}`);
await mkdir(output, { recursive: true });
const portraits = JSON.parse(await readFile('../tmp/vn-art-audit/sizing/assets.json', 'utf8'));
const cases = [
    ...[0,8,22,28,37,42,44,50,66,75,76,77,84,97].map(i => ({ name: `npc-${i}`, ...portraits[i].scene, avatarSource: '/portraits/cinematic/toma-reed.webp' })),
    { name: 'player-square', event:'story-stormveil-village-4-0',page:0,line:0,avatarSource:'/starter-avatar-one.webp' },
    { name: 'player-wide',event:'story-stormveil-village-4-0',page:0,line:0,avatar:'wide' },
    { name: 'player-tall',event:'story-stormveil-village-4-0',page:0,line:0,avatarSource:'/portraits/cinematic/toma-reed.webp' },
];
if (process.argv.includes('--all-npcs')) {
    cases.splice(0, cases.length, ...portraits.map((portrait, i) => ({ name:`npc-${i}`, ...portrait.scene, avatarSource:'/starter-avatar-one.webp' })));
}
if (process.argv.includes('--avatars-only')) cases.splice(0,cases.length,...cases.filter(c=>c.name.startsWith('player')));
const indices=process.argv.find(a=>a.startsWith('--indices='))?.slice(10).split(',').map(Number);
if(indices) cases.splice(0,cases.length,...indices.map(i=>({name:`npc-${i}`,...portraits[i].scene,avatarSource:'/starter-avatar-one.webp'})));
const browser = await chromium.launch({ headless:true,args:['--no-proxy-server'] });
const report = [];
try {
 for (const c of cases) for (const viewport of [{width:1440,height:900},{width:390,height:844}, ...(!c.name.startsWith('npc') ? [{width:320,height:568},{width:844,height:390},{width:667,height:375}] : [])]) {
    const p = await browser.newPage({ viewport, reducedMotion:'reduce' });
    const errors=[];
    p.on('pageerror',e=>errors.push(e.message));
    p.on('response',r=>{if(r.status()>=400 && /\/portraits\//.test(r.url()))errors.push(`${r.status()} ${r.url()}`);});
    await p.addInitScript(()=>{localStorage.setItem('vnTextSpeed.v1','instant');localStorage.setItem('vnTextSize.v1','xlarge');localStorage.setItem('pet-music-muted','1');});
    const {name,...params}=c;
    await p.goto(`http://127.0.0.1:4173/?${new URLSearchParams({preview:'vn',...params})}`,{waitUntil:'domcontentloaded',timeout:90000});
    await p.locator('.cvn-root').waitFor({timeout:90000});
    await p.waitForFunction(()=>[...document.images].every(i=>i.complete));
    await p.waitForTimeout(150);
    const metrics=await p.evaluate(()=>({
        root:document.querySelector('.cvn-root').className,
        overflow:document.documentElement.scrollWidth-innerWidth,
        dialogue:document.querySelector('.cvn-dialogue-shell').getBoundingClientRect().toJSON(),
        actors:[...document.querySelectorAll('.cvn-actor')].map(a=>({name:a.querySelector('figcaption').textContent,rect:a.getBoundingClientRect().toJSON(),images:[...a.querySelectorAll('img')].map(i=>({src:i.currentSrc,width:i.naturalWidth,height:i.naturalHeight,rect:i.getBoundingClientRect().toJSON(),fit:getComputedStyle(i).objectFit}))})),
    }));
    const file=`${name}-${viewport.width}.png`;
    await p.screenshot({path:path.join(output,file)});
    report.push({file,viewport,case:c,errors,...metrics});
    console.log(file);
    await p.close();
 }
} finally {await browser.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
if(report.some(r=>r.errors.length||r.overflow>1||r.actors.some(a=>a.images.some(i=>!i.width))))process.exitCode=1;

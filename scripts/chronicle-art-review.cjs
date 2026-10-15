/* Browser evidence for the actual card, inspector and pack components.
 * Optional --dependency-root reuses an existing dependency installation read-only.
 * node scripts/chronicle-art-review.cjs [--dependency-root <checkout>]
 */
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const dependencyIndex=process.argv.indexOf('--dependency-root');
const dependencies=dependencyIndex>=0 ? path.resolve(process.argv[dependencyIndex+1]) : root;
const dependencyRequire=createRequire(path.join(dependencies,'package.json'));
const clientRequire=createRequire(path.join(dependencies,'shinobij.client/package.json'));
const esbuild=dependencyRequire('esbuild');
const sharp=dependencyRequire('sharp');
const {chromium}=clientRequire('playwright');
const out=path.join(root,'tmp/chronicle-art-review');
const evidence=path.join(root,'shinobij.client/art-source/chronicle-refresh/review');
const idsIndex=process.argv.indexOf('--ids');
const requestedIds=idsIndex>=0 ? process.argv[idsIndex+1].split(',') : [];
const tagIndex=process.argv.indexOf('--tag');
const tag=tagIndex>=0 ? process.argv[tagIndex+1].replace(/[^a-z0-9-]/gi,'') : 'pilot';
const galleryOnly=process.argv.includes('--gallery-only');
const duelReview=process.argv.includes('--duel');
const screenshotPath=label=>path.join(evidence,`${tag}-${label}.png`);
async function main(){
  fs.mkdirSync(out,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
  const production=JSON.parse(fs.readFileSync(path.join(root,'shinobij.client/art-source/chronicle-refresh/manifest.json'),'utf8'));
  const selected=requestedIds.length?requestedIds:['tc-61','story-story-ai-frostfang-village-4','pet-witness-wind','chronicle-gale-reversal','story-story-ai-frostfang-village-25','story-wandering-sage','tc-131','chronicle-forbidden-archive'];
  const artSnapshot={},snapshotFiles=new Map();
  for(const id of selected){
    const row=production.cards.find(card=>card.id===id);
    if(row?.status!=='packaged')throw Error(`Package artwork before browser review: ${id}`);
    artSnapshot[id]={runtimePath:row.runtimePath,smallPath:row.smallPath,runtimeSha256:row.runtimeSha256,smallSha256:row.smallSha256};
    for(const [asset,digest] of [[row.runtimePath,row.runtimeSha256],[row.smallPath,row.smallSha256]]){
      const bytes=fs.readFileSync(path.join(root,'shinobij.client/public',asset));
      if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error(`Artwork changed before capture: ${id}`);
      snapshotFiles.set(asset,bytes);
    }
  }
  await esbuild.build({absWorkingDir:root,entryPoints:['shinobij.client/src/cardpreview.tsx'],outfile:path.join(out,'preview.js'),bundle:true,platform:'browser',format:'esm',jsx:'automatic',nodePaths:[path.join(dependencies,'shinobij.client/node_modules'),path.join(dependencies,'node_modules')],external:['/chronicle/*','/fonts/*'],loader:{'.webp':'file','.png':'file','.svg':'dataurl'},assetNames:'qa-assets/[name]-[hash]',publicPath:'/',define:{'process.env.NODE_ENV':'"development"','import.meta.env.DEV':'true'},logLevel:'warning'});
  const publicDir=path.join(root,'shinobij.client/public');
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(snapshotFiles.has(pathname)){res.setHeader('content-type','image/webp');res.end(snapshotFiles.get(pathname));return;}
    if(pathname==='/') {res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0b0d12;color:#eee}#root{padding:'+(duelReview?'0':'24px')+'}*{box-sizing:border-box}</style><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');return;}
    const base=pathname.startsWith('/preview.') || pathname.startsWith('/qa-assets/') ? out : publicDir;
    const file=path.resolve(base,'.'+pathname);
    if(!file.startsWith(base+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const failures=[];const consoleErrors=[];const report={artSnapshot};
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
    page.on('pageerror',e=>consoleErrors.push(e.message));
    page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))failures.push(`${r.status()} ${r.url()}`);});
    const query=new URLSearchParams();if(requestedIds.length)query.set('ids',requestedIds.join(','));if(duelReview)query.set('duel','1');
    const url=`http://127.0.0.1:${server.address().port}/?${query}`;
    await page.goto(url);
    if(duelReview){
      await page.getByRole('region',{name:'Shinobi Journey Chronicle Showdown board',exact:true}).waitFor();
      await page.locator('img').evaluateAll(images=>images.forEach(img=>{img.loading='eager';}));
      await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.getByRole('region',{name:'Shinobi Journey Chronicle Showdown board',exact:true}).evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation=>animation.finished.catch(()=>{})));});
      report.figures=await page.locator('.chronicle-figure').evaluateAll(images=>images.map(img=>({src:new URL(img.currentSrc).pathname,loaded:img.complete&&img.naturalWidth>0,row:img.closest('.chronicle-zone-row')?.getAttribute('aria-label'),mirrored:img.classList.contains('chronicle-figure--flip')})));
      const manifest=JSON.parse(fs.readFileSync(path.join(root,'shinobij.client/art-source/chronicle-refresh/manifest.json'),'utf8'));
      const displayed=(requestedIds.length?requestedIds:['tc-61','tc-01','tc-131','tc-133','tc-143']).slice(0,5);
      for(const id of displayed){const row=manifest.cards.find(card=>card.id===id);if(!row?.figures?.front||!row?.figures?.back)continue;for(const direction of ['front','back'])if(!report.figures.some(figure=>figure.src===row.figures[direction].runtimePath&&figure.loaded&&!figure.mirrored))failures.push(`Missing unmirrored ${direction} figure: ${id}`);}
      if(report.figures.some(figure=>!figure.loaded))failures.push('Unloaded duel figure');
      report.images=await page.locator('img').evaluateAll(images=>images.map(img=>({src:img.currentSrc,loaded:img.complete&&img.naturalWidth>0})));
      if(report.images.some(img=>!img.loaded))failures.push('Unloaded duel image');
      const figureClearance=()=>page.evaluate(()=>{const divider=document.querySelector('.chronicle-field-divider')?.getBoundingClientRect();if(!divider)return [];return [...document.querySelectorAll('.chronicle-figure')].map(img=>{const rect=img.getBoundingClientRect();return {src:new URL(img.currentSrc).pathname,overlap:Math.max(0,Math.min(rect.bottom,divider.bottom)-Math.max(rect.top,divider.top))};});});
      report.desktopFigureClearance=await figureClearance();
      if(report.desktopFigureClearance.some(row=>row.overlap>2))failures.push('Desktop field-status strip overlaps a figure');
      await page.screenshot({path:screenshotPath('duel-desktop'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      report.mobileFigureClearance=await figureClearance();
      if(report.mobileFigureClearance.some(row=>row.overlap>2))failures.push('Mobile field-status strip overlaps a figure');
      await page.screenshot({path:screenshotPath('duel-mobile'),fullPage:true});
      report.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      report.additionalDuelViewports=[];
      for(const viewport of [{name:'tablet',width:768,height:1024},{name:'landscape',width:844,height:390}]){
        await page.setViewportSize({width:viewport.width,height:viewport.height});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const clearance=await figureClearance();
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
        report.additionalDuelViewports.push({...viewport,clearance,overflow});
        if(clearance.some(row=>row.overlap>2))failures.push(`${viewport.name} field-status strip overlaps a figure`);
        if(overflow)failures.push(`${viewport.name} duel overflows horizontally`);
        await page.screenshot({path:screenshotPath('duel-'+viewport.name),fullPage:true});
        if(viewport.name==='landscape'){
          // Short screens use the existing scrollable duel shell. Check the
          // player's full figures after scrolling their row into view too.
          await page.locator('.chronicle-zone-row.player:not(.backrow)').evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          report.landscapePlayerFigures=await page.locator('.chronicle-zone-row.player:not(.backrow) .chronicle-figure').evaluateAll(images=>images.map(img=>{
            const rect=img.getBoundingClientRect();return {src:new URL(img.currentSrc).pathname,fullyVisible:rect.top>=0&&rect.bottom<=innerHeight&&rect.left>=0&&rect.right<=innerWidth};
          }));
          if(report.landscapePlayerFigures.some(figure=>!figure.fullyVisible))failures.push('Landscape player figure cannot scroll fully into view');
          await page.screenshot({path:screenshotPath('duel-landscape-player'),fullPage:true});
        }
      }
      report.failures=failures;report.consoleErrors=consoleErrors;
      if(failures.length||consoleErrors.length||report.mobileOverflow)process.exitCode=1;
    }else{
    await page.locator('.chronicle-card__art').first().waitFor();
    await page.locator('.chronicle-card__art').evaluateAll(images=>images.forEach(img=>{img.loading='eager';}));
    await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))));
    report.images=await page.locator('.chronicle-card__art').evaluateAll(images=>images.map(img=>({src:img.currentSrc,width:img.naturalWidth,loaded:img.complete&&img.naturalWidth>0})));
    report.cardIds=requestedIds.length ? requestedIds : 'pilot';
    report.renderedCardIds=await page.locator('[data-card-preview-id]').evaluateAll(cards=>cards.map(card=>card.getAttribute('data-card-preview-id')));
    for(const id of requestedIds)if(!report.renderedCardIds.includes(id))failures.push(`Requested card did not render: ${id}`);
    for(const [id,art] of Object.entries(artSnapshot))if(!report.images.some(img=>[art.runtimePath,art.smallPath].includes(new URL(img.src).pathname)&&img.loaded))failures.push(`Replacement artwork did not render: ${id}`);
    await page.screenshot({path:screenshotPath('desktop'),fullPage:true});
    const openInspector=async()=>{
      const premium=page.locator('button.chronicle-card.rarity-legendary, button.chronicle-card.rarity-mythic');
      await (await premium.count() ? premium : page.locator('button.chronicle-card')).first().click();
      await page.locator('.chronicle-card-zoom').waitFor();
      // Capture the settled dialog, rather than a translucent frame of its
      // opening animation. The foil's intentional infinite sweep stays active.
      await page.locator('.ui-modal-backdrop').evaluate(async el=>{
        const finite=el.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations));
        await Promise.all(finite.map(animation=>animation.finished.catch(()=>{})));
      });
    };
    await openInspector();
    await page.locator('.chronicle-card-zoom').waitFor();
    report.inspectorBackdrop=await page.locator('.ui-modal-backdrop').evaluate(el=>getComputedStyle(el).position);
    await page.locator('.chronicle-card-zoom img').evaluate(img=>img.decode());
    report.inspectorFoil=await page.locator('.chronicle-card-zoom .chronicle-card__foil').evaluate(el=>({className:el.className,animation:getComputedStyle(el,'::before').animationName,mask:getComputedStyle(el).maskImage}));
    await page.screenshot({path:screenshotPath('inspector'),fullPage:true});
    await page.keyboard.press('Escape');
    await page.emulateMedia({reducedMotion:'reduce'});
    await openInspector();
    report.reducedMotionAnimation=await page.locator('.chronicle-card-zoom .chronicle-card__foil').evaluate(el=>getComputedStyle(el,'::before').animationName);
    await page.screenshot({path:screenshotPath('reduced-motion'),fullPage:true});
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:screenshotPath('mobile'),fullPage:true});
    report.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    // Capture each card while it is in the viewport. Chromium can omit text
    // behind backdrop-filter layers below the viewport in a full-page image.
    const mobileCards=page.locator('button.chronicle-card:not(.compact)');
    const mobileLayers=[];
    report.mobileCards=[];
    for(let i=0;i<await mobileCards.count();i++){
      const card=mobileCards.nth(i);
      await card.scrollIntoViewIfNeeded();
      const capture=await card.screenshot();
      const name=await card.locator('.chronicle-card__name').innerText();
      report.mobileCards.push({name,visible:await card.locator('.chronicle-card__name').isVisible()});
      mobileLayers.push({input:await sharp(capture).resize({width:252}).png().toBuffer(),left:(i%4)*264,top:Math.floor(i/4)*370});
    }
    await sharp({create:{width:1056,height:Math.ceil(mobileLayers.length/4)*370,channels:3,background:'#0b0d12'}}).composite(mobileLayers).png().toFile(screenshotPath('mobile-cards'));
    await page.evaluate(()=>window.scrollTo(0,0));
    await openInspector();
    await page.screenshot({path:screenshotPath('mobile-inspector')});
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:1100});await page.emulateMedia({reducedMotion:'no-preference'});
    if(!galleryOnly){
    const settlePack=async()=>{
      await page.locator('.pack-open-overlay').evaluate(async el=>{
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        await Promise.all(el.getAnimations({subtree:true})
          .filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations))
          .map(animation=>animation.finished.catch(()=>{})));
        await Promise.all([...el.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));
      });
    };
    await page.getByRole('button',{name:'Preview pack reveal'}).click();
    await page.locator('.pack-open-overlay').waitFor();
    await settlePack();
    await page.screenshot({path:screenshotPath('pack'),fullPage:true});
    await page.getByRole('button',{name:/Tear open/}).click();
    for(let i=0;i<8;i++){
      const top=page.getByRole('button',{name:'Flip the top card'});
      await top.waitFor({state:'visible'});await top.click();
      const revealed=page.getByRole('button',{name:/revealed — continue/});await revealed.waitFor({state:'visible'});
      if(i===7){
        await settlePack();
        await page.screenshot({path:screenshotPath('pack-legendary-reveal')});
        report.packFoil=await page.locator('.pack-card.is-flipped .chronicle-card__foil--holographic').first().evaluate(el=>getComputedStyle(el,'::before').animationName);
      }
      await revealed.click();
    }
    await page.locator('.pack-summary').waitFor();
    await settlePack();
    report.packSummaryCards=await page.locator('.pack-summary__card').count();
    if(report.packSummaryCards!==8)failures.push('Pack summary did not show all eight cards');
    await page.screenshot({path:screenshotPath('pack-summary')});
    }
    report.failures=failures;report.consoleErrors=consoleErrors;
    const brokenFoil=report.inspectorFoil.className.includes('--holographic')&&report.inspectorFoil.animation!=='chronicleFoilSweep';
    if(failures.length||consoleErrors.length||brokenFoil||report.mobileOverflow||report.inspectorBackdrop!=='fixed'||report.reducedMotionAnimation!=='none'||report.images.some(img=>!img.loaded))process.exitCode=1;
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  fs.writeFileSync(path.join(evidence,tag === 'pilot' ? 'browser-report.json' : `${tag}-browser-report.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});

import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { chronicleLegacyArtTarget,chronicleLegacyArtRedirect } from '../shared/chronicle-legacy-art.ts';
import { CHRONICLE_PAINTED_ART,CHRONICLE_PAINTED_FIGURES } from '../shared/chronicle-painted-art.ts';
import { CHRONICLE_CARD_CATALOG,CHRONICLE_TOKEN_CARDS } from '../shared/chronicle-duel.ts';

const root=path.resolve(import.meta.dirname,'..');
const publicRoot=path.join(root,'shinobij.client/public');
test('all retired files are removed and have a live, single-hop replacement',()=>{
    const report=JSON.parse(readFileSync(path.join(root,'shinobij.client/art-source/chronicle-refresh/review/obsolete-art-removal.json'),'utf8'));
    assert.equal(report.files,790);
    for(const {url,target} of report.assets){
        assert.equal(existsSync(path.join(publicRoot,url)),false,url);
        assert.equal(chronicleLegacyArtTarget(url),target,url);
        assert.ok(existsSync(path.join(publicRoot,target)),target);
        assert.equal(chronicleLegacyArtTarget(target),undefined,'must not redirect current art');
    }
});
test('current catalog, support cards and tokens resolve directly to new art',()=>{
    for(const card of [...CHRONICLE_CARD_CATALOG,...CHRONICLE_TOKEN_CARDS]){
        assert.equal(card.image,CHRONICLE_PAINTED_ART[card.id],card.id);
        assert.equal(chronicleLegacyArtTarget(card.image),undefined,card.id);
    }
    for(const [id,figures] of Object.entries(CHRONICLE_PAINTED_FIGURES)){
        assert.equal(chronicleLegacyArtTarget(`/chronicle/figures/${id}.webp`),figures.front);
        assert.equal(chronicleLegacyArtTarget(`/chronicle/figures/${id}-back.webp`),figures.back);
    }
});
test('unknown, shared, malformed and external URLs never redirect',()=>{
    for(const url of ['/chronicle/cards/unknown.webp','/chronicle/figures/constructor.webp','/chronicle/cards/__proto__.webp','/chronicle/cards/tc-01/other.webp','/chronicle/cards/../tc-01.webp','https://example.com/chronicle/cards/tc-01.webp','/portraits/wandering-sage.webp','/chronicle/fields/sky.webp','/chronicle/card-back.webp'])assert.equal(chronicleLegacyArtTarget(url),undefined,url);
});
test('the compatibility route precedes static serving and missing-asset handling',()=>{
    const server=readFileSync(path.join(root,'server.ts'),'utf8');
    const redirect=server.indexOf(', chronicleLegacyArtRedirect);');
    assert.ok(redirect>0&&redirect<server.indexOf('app.use(express.static(staticDir'));
    assert.ok(redirect<server.indexOf("res.status(404).type('text/plain').send('Static asset not found')"));
});
test('old browser requests redirect to actual image bytes; current and unknown URLs do not loop',async()=>{
    const app=express();
    app.get(/^\/chronicle\/(?:cards|figures)\//,chronicleLegacyArtRedirect);
    app.use(express.static(publicRoot));
    const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
    try{
        const base=`http://127.0.0.1:${server.address().port}`;
        for(const url of ['/chronicle/cards/tc-61.webp?v=old','/chronicle/cards/tc-61-512.webp','/chronicle/figures/tc-61.webp','/chronicle/figures/tc-61-back.webp']){
            const response=await fetch(base+url,{redirect:'manual'});
            assert.equal(response.status,302,url);
            assert.equal(response.headers.get('location'),chronicleLegacyArtTarget(url.split('?')[0]));
            assert.equal(response.headers.get('cache-control'),'public, max-age=86400');
            const image=await fetch(base+url);
            assert.equal(image.status,200,url);
            assert.match(image.headers.get('content-type'),/image\/webp/);
            assert.ok((await image.arrayBuffer()).byteLength>100);
        }
        assert.equal((await fetch(base+CHRONICLE_PAINTED_ART['tc-61'],{redirect:'manual'})).status,200);
        assert.equal((await fetch(base+'/chronicle/cards/unknown.webp',{redirect:'manual'})).status,404);
        const head=await fetch(base+'/chronicle/figures/tc-61-back.webp',{method:'HEAD',redirect:'manual'});
        assert.equal(head.status,302);
    }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

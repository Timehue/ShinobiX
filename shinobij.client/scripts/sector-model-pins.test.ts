import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build, createServer } from 'vite';
import { sectorModelPins } from './sector-model-pins.ts';

test('a newly pinned bundled or public portrait resolves through the compiled registry', async t => {
    const root = await mkdtemp(path.join(tmpdir(),'sector-pins-'));
    t.after(() => rm(root,{recursive:true,force:true}));
    const directory = path.join(root,'src/data/sector-models');
    await mkdir(directory,{recursive:true});
    for (const [slug,portrait] of [['field-guard','src/assets/guard.webp'],['gate-guard','public/guard.webp']]) {
        const source = path.join(root,portrait);
        await mkdir(path.dirname(source),{recursive:true});
        await writeFile(source,slug);
        await writeFile(path.join(directory,slug+'.json'),JSON.stringify({portrait,
            portraitSha256:createHash('sha256').update(slug).digest('hex'),manifestSha256:'1'.repeat(64)}));
    }
    const entry = path.join(root,'entry.js');
    await writeFile(entry,`import guard from '/src/assets/guard.webp';
        import { portraitModels, revisions, loadPins } from 'virtual:sector-model-pins';
        export default async () => {await loadPins(); return [portraitModels.get(guard),portraitModels.get('/guard.webp'),
            portraitModels.get('/custom/guard.webp'),revisions['field-guard']];};`);
    const compile = () => build({root,configFile:false,logLevel:'silent',plugins:[sectorModelPins(root)],
        build:{lib:{entry,formats:['es']},write:false,minify:false}});
    const result = await compile();
    assert.ok(Array.isArray(result));
    const chunk = result[0].output.find(part=>part.type==='chunk');
    assert.ok(chunk && chunk.type==='chunk');
    const metadata = result[0].output.find(part=>part.type==='asset' && part.fileName.endsWith('.json'));
    assert.ok(metadata && metadata.type==='asset');
    assert.doesNotMatch(chunk.code, /1111111111111111111111111111111111111111111111111111111111111111/);
    const fetch = globalThis.fetch;
    t.after(() => {globalThis.fetch=fetch;});
    globalThis.fetch = async url => {
        assert.equal(new URL(String(url)).pathname.endsWith(metadata.fileName), true);
        return new Response(metadata.source);
    };
    const module = path.join(root,'compiled.mjs');
    await writeFile(module,chunk.code);
    const actual=await import(pathToFileURL(module).href);
    assert.deepEqual(await actual.default(),['field-guard','gate-guard',undefined,'1'.repeat(64)]);
    const dev = await createServer({ root, configFile:false, logLevel:'silent',
        plugins:[sectorModelPins(root)], server:{middlewareMode:true, hmr:false}, optimizeDeps:{noDiscovery:true} });
    t.after(() => dev.close());
    const url = 'virtual:sector-model-pins';
    assert.match((await dev.transformRequest(url))!.code, /gate-guard/);
    const publicPin = path.join(directory,'gate-guard.json');
    await rm(publicPin);
    dev.watcher.emit('all', 'unlink', publicPin);
    assert.doesNotMatch((await dev.transformRequest(url))!.code, /gate-guard/);
    await writeFile(path.join(root,'src/assets/guard.webp'),'replacement art');
    await assert.rejects(compile,/needs a new fit/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { artHash, validateRenderedReview, validateSemanticReview, validateArtworkInputs, validateVerifiedEdgeReferences, SEMANTIC_CHECKS } from './sector-art-review-proof.mjs';

test('admission requires corrected actual reverse-edge references for every road, retaining edit ancestry',()=>{
    const exits=[{id:'9:north:10',destinationSector:10,destinationExitId:'10:south:9'},
        {id:'9:east:15',destinationSector:15,destinationExitId:'15:west:9'}];
    const neighbors=exits.map(exit=>({exit:exit.id,destination:exit.destinationSector,reverseExit:exit.destinationExitId,sha256:'frozen-neighbor'}));
    const references={edgeReferenceVersion:2,neighbors,inputs:[{file:'frozen-guide'}]};
    validateVerifiedEdgeReferences({references,exits});
    validateVerifiedEdgeReferences({references:{parentArtwork:{references}},exits});
    assert.throws(()=>validateVerifiedEdgeReferences({references:{...references,edgeReferenceVersion:1},exits}),/reverse-edge references/);
    assert.throws(()=>validateVerifiedEdgeReferences({references:{...references,neighbors:neighbors.slice(0,1)},exits}),/9:east:15/);
    assert.throws(()=>validateVerifiedEdgeReferences({references:{...references,neighbors:neighbors.map(n=>({...n,reverseExit:'wrong:edge'}))},exits}),/reverse-edge references/);
    assert.throws(()=>validateVerifiedEdgeReferences({references:{...references,inputs:[]},exits}),/reverse-edge references/);
});

test('a report-only rerun cannot make an older hatched image eligible for a repair', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sector-review-proof-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'review.png');
    const image = Buffer.from('rendered from painting A and mask A');
    await fs.writeFile(file, image);
    await fs.writeFile(file + '.json', JSON.stringify({ paintingSha256: 'painting-A', layoutSha256: 'mask-A', imageSha256: artHash(image) }));
    await validateRenderedReview({ file, paintingSha256: 'painting-A', layoutSha256: 'mask-A' });
    await assert.rejects(validateRenderedReview({ file, paintingSha256: 'painting-B', layoutSha256: 'mask-A' }), /not current/);
    await assert.rejects(validateRenderedReview({ file, paintingSha256: 'painting-A', layoutSha256: 'mask-B' }), /not current/);
    await fs.writeFile(file, Buffer.from('different screenshot'));
    await assert.rejects(validateRenderedReview({ file, paintingSha256: 'painting-A', layoutSha256: 'mask-A' }), /not current/);
});

test('packaging refuses a different prompt, mask, sector or changed model reference', async t => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sector-job-inputs-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    const file=path.join(dir,'guide.png'),reference=Buffer.from('exact geometry image');
    await fs.writeFile(file,reference);
    const manifest={sector:26,layoutSha256:'mask',promptSha256:artHash('repair'),tool:'built-in-image-gen',inputs:[{file,sha256:artHash(reference)}]};
    const input={manifest,sector:26,layoutSha256:'mask',prompt:'repair'};
    await validateArtworkInputs(input);
    await assert.rejects(validateArtworkInputs({...input,prompt:'different edit'}),/frozen inputs/);
    await assert.rejects(validateArtworkInputs({...input,layoutSha256:'other-mask'}),/frozen inputs/);
    await assert.rejects(validateArtworkInputs({...input,sector:9}),/frozen inputs/);
    await fs.writeFile(file,Buffer.from('superseded guide'));
    await assert.rejects(validateArtworkInputs(input),/reference changed/);
});

test('green color checks cannot admit unresolved roofs, obstacles, hydrology or stale visual approval', () => {
    const entry = {sector:26,sha256:'painting',layoutSha256:'layout',reviewImageSha256:'render',status:'approved',findings:[],
        checks:Object.fromEntries(SEMANTIC_CHECKS.map(check=>[check,true]))};
    const input = {sector:26,paintingSha256:'painting',layoutSha256:'layout',imageSha256:'render'};
    assert.equal(validateSemanticReview({...input,entries:[entry]}),entry);
    assert.throws(()=>validateSemanticReview({...input,entries:[{...entry,sha256:'older-painting'}]}),/current semantic/);
    assert.throws(()=>validateSemanticReview({...input,entries:[{...entry,layoutSha256:'older-layout'}]}),/current semantic/);
    assert.throws(()=>validateSemanticReview({...input,entries:[{...entry,reviewImageSha256:'older-render'}]}),/incomplete/);
    assert.throws(()=>validateSemanticReview({...input,entries:[{...entry,status:'rejected'}]}),/unresolved/);
    assert.throws(()=>validateSemanticReview({...input,entries:[{...entry,findings:['Roof blocks the village approach']}]}),/unresolved/);
    for(const check of SEMANTIC_CHECKS) assert.throws(()=>validateSemanticReview({...input,entries:[{...entry,checks:{...entry.checks,[check]:false}}]}),/incomplete/,check);
    assert.throws(()=>validateSemanticReview({...input,entries:[entry,entry]}),/unique/);
});

test('native artwork requires owner authorization, a whole-frame frozen recipe and unchanged assets/output', async t => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-sector-proof-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    const file=path.join(dir,'source.png'),output=path.join(dir,'floor.webp'),recipeFile=path.join(dir,'recipe.json');
    await fs.writeFile(file,'frozen generated asset');await fs.writeFile(output,'composed whole map');
    const inputs=[{file,sha256:artHash('frozen generated asset')}],authorizedResponse='Yes—compose and bake the finished maps (Recommended)';
    const recipe={tool:'owner-authorized-native-composition',sector:4,layoutSha256:'mask',wholeFrame:true,width:1024,height:1024,
        ownerAuthorization:{source:'Direct owner response in this chat',response:authorizedResponse,scope:'Use native composition, then bake a complete map.'},
        inputs,operations:[{kind:'contained-roof'}],output,sha256:artHash('composed whole map')};
    const serialized=JSON.stringify(recipe);await fs.writeFile(recipeFile,serialized);
    const manifest={tool:recipe.tool,sector:4,layoutSha256:'mask',promptSha256:artHash('compose approved assets'),inputs,
        ownerAuthorizedNativeComposition:true,authorizedResponse,recipeFile,recipeSha256:artHash(serialized),outputSha256:recipe.sha256};
    const input={manifest,sector:4,layoutSha256:'mask',prompt:'compose approved assets'};
    await validateArtworkInputs(input);
    await assert.rejects(validateArtworkInputs({...input,manifest:{...manifest,ownerAuthorizedNativeComposition:false}}),/owner authorization/);
    await assert.rejects(validateArtworkInputs({...input,manifest:{...manifest,authorizedResponse:undefined}}),/owner authorization/);
    await assert.rejects(validateArtworkInputs({...input,manifest:{...manifest,authorizedResponse:'Different approval'}}),/recipe/);
    await fs.writeFile(recipeFile,JSON.stringify({...recipe,width:512}));
    await assert.rejects(validateArtworkInputs(input),/recipe/);
    const wrongFrame=JSON.stringify({...recipe,width:512});await fs.writeFile(recipeFile,wrongFrame);
    await assert.rejects(validateArtworkInputs({...input,manifest:{...manifest,recipeSha256:artHash(wrongFrame)}}),/recipe/);
    await fs.writeFile(recipeFile,serialized);await fs.writeFile(output,'substituted map');
    await assert.rejects(validateArtworkInputs(input),/output changed/);
    await fs.writeFile(output,'composed whole map');await fs.writeFile(file,'substituted asset');
    await assert.rejects(validateArtworkInputs(input),/reference changed/);
});

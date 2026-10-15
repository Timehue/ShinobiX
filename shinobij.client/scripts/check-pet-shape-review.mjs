import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PET_REVIEW_CLIPS = ['idle','idle_2','walk','gallop','gallop_jump','attack','idle_hitreact1','death','entrance','cast','guard','rest','victory'];
export const PET_REVIEW_RENDER_FILES = ['shinobij.client/src/components/PetModel3D.tsx',
    'shinobij.client/src/lib/pet-combat-rig-motion.ts','shinobij.client/src/lib/pet-animation-lifecycle.ts',
    'shinobij.client/src/lib/pet-baked-support.ts','shinobij.client/src/lib/pet-model-bounds.ts'];
export async function petReviewRendererSha256(repo) {
    const hash = createHash('sha256');
    for (const path of PET_REVIEW_RENDER_FILES) hash.update(path+'\0').update((await readFile(resolve(repo,path),'utf8')).replaceAll('\r\n','\n')).update('\0');
    return hash.digest('hex');
}
export async function petReviewEvidenceFailures(repo,receipt) {
    const failures=[];
    for(const path of receipt.evidence??[]) {
        const target=resolve(repo,path),local=relative(repo,target);
        if(local.startsWith('..')||local.includes(':')){failures.push(`evidence path leaves repository: ${path}`);continue;}
        const expected=receipt.evidenceSha256?.[path];
        if(!/^[a-f0-9]{64}$/.test(expected??'')){failures.push(`evidence fingerprint missing: ${path}`);continue;}
        try { if(createHash('sha256').update(await readFile(target)).digest('hex')!==expected)failures.push(`evidence changed after inspection: ${path}`); }
        catch { failures.push(`review evidence missing: ${path}`); }
    }
    return failures;
}
export function petShapeReviewFailures(models, receipts) {
    const failures = [];
    for (const model of models) {
        const receipt = receipts[model.id];
        if (!receipt) { failures.push(`${model.id}: no animation shape review`); continue; }
        if (receipt.sha256 !== model.sha256) failures.push(`${model.id}: asset changed after review`);
        if (model.lodSha256 && receipt.lodSha256 !== model.lodSha256) failures.push(`${model.id}: battle model changed after review`);
        if (model.atlasSha256 && receipt.atlasSha256 !== model.atlasSha256) failures.push(`${model.id}: animated impostor changed after review`);
        if (model.rendererSha256 && receipt.rendererSha256 !== model.rendererSha256) failures.push(`${model.id}: production animation renderer changed after review`);
        if (!receipt.reviewer || !receipt.reviewedAt || !receipt.evidence?.length) failures.push(`${model.id}: review provenance missing`);
        if (new Set(receipt.clips ?? []).size !== PET_REVIEW_CLIPS.length || PET_REVIEW_CLIPS.some(c => !receipt.clips?.includes(c))) failures.push(`${model.id}: incomplete animation review`);
        if (['front','side'].some(v => !receipt.views?.includes(v))) failures.push(`${model.id}: missing camera view`);
        if (!receipt.fullBodyReviewed || !receipt.skullShapeReviewed || !receipt.transitionsReviewed) failures.push(`${model.id}: incomplete body, skull, or transition review`);
    }
    return failures;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const { runtimePetModels } = await import('./lib/pet-runtime-audit.mjs');
    const repo = resolve(import.meta.dirname, '../..');
    const base = process.argv.find(a => a.startsWith('--changed-from='))?.slice(15);
    const receiptPath = process.argv.find(a => a.startsWith('--receipts='))?.slice(11) ?? resolve(repo, 'docs/audits/pet-animation-shape-reviews.json');
    const receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
    let selected = runtimePetModels;
    if (base) {
        // Pass the ref as a literal argument. A missing/shallow base fails closed.
        execFileSync('git',['rev-parse','--verify',`${base}^{commit}`],{cwd:repo,stdio:'pipe'});
        const names = execFileSync('git',['diff','--name-only',base,'--'],{cwd:repo,encoding:'utf8'}).trim().split(/\r?\n/);
        const changed = new Set(names);
        selected = selected.filter(row => PET_REVIEW_RENDER_FILES.some(path => changed.has(path))
            || changed.has(relative(repo,row.path).replaceAll('\\','/'))
            || changed.has(`shinobij.client/public/pet-models/warfront-lod/${relative(resolve(repo,'shinobij.client/public/pet-models'),row.path).replaceAll('\\','/')}`)
            || changed.has(`shinobij.client/public/pet-models/warfront-impostors/${relative(resolve(repo,'shinobij.client/public/pet-models'),row.path).replaceAll('\\','/').replace(/\.glb$/,'.webp')}`));
    }
    const models = [];
    const rendererSha256 = await petReviewRendererSha256(repo);
    for (const row of selected) {
        const local = relative(resolve(repo,'shinobij.client/public/pet-models'),row.path);
        models.push({ id:row.pet.id, sha256:createHash('sha256').update(await readFile(row.path)).digest('hex'),
            lodSha256:createHash('sha256').update(await readFile(resolve(repo,'shinobij.client/public/pet-models/warfront-lod',local))).digest('hex'),
            atlasSha256:createHash('sha256').update(await readFile(resolve(repo,'shinobij.client/public/pet-models/warfront-impostors',local.replace(/\.glb$/,'.webp')))).digest('hex'), rendererSha256 });
    }
    const failures = petShapeReviewFailures(models,receipts.pets);
    for(const model of models)if(receipts.pets[model.id])failures.push(...(await petReviewEvidenceFailures(repo,receipts.pets[model.id])).map(f=>`${model.id}: ${f}`));
    console.log(JSON.stringify({ reviewedModels:models.length, scope:base ? 'changed-models' : 'entire-roster', failures },null,2));
    if (failures.length) process.exitCode=1;
}

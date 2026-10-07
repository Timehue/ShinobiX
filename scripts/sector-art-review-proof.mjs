import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const artHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const SEMANTIC_CHECKS = ['walkableGround', 'visibleObstacles', 'landmarkFootprints', 'purposefulRoutes', 'coherentHydrology', 'biomeAndStyle'];

/** Older guides could mirror the whole neighbor before cropping its reverse edge. */
export function validateVerifiedEdgeReferences({references,exits}) {
    const verified=new Set();
    const seen=new Set();
    for(let current=references;current&&!seen.has(current);current=current.parentArtwork?.references) {
        seen.add(current);
        if(current.edgeReferenceVersion!==2)continue;
        for(const neighbor of current.neighbors??[]) {
            const exit=exits.find(exit=>exit.id===neighbor.exit);
            if(exit&&neighbor.destination===exit.destinationSector&&neighbor.reverseExit===exit.destinationExitId
                &&neighbor.sha256&&current.inputs?.length)verified.add(exit.id);
        }
    }
    const missing=exits.filter(exit=>!verified.has(exit.id));
    if(missing.length)throw Error(`Artwork lacks verified reverse-edge references: ${missing.map(exit=>exit.id).join(', ')}`);
}

export async function validateArtworkInputs({ manifest, sector, layoutSha256, prompt }) {
    if(manifest.sector!==sector||manifest.layoutSha256!==layoutSha256||manifest.promptSha256!==artHash(prompt)
        ||!['built-in-image-gen','owner-authorized-native-composition'].includes(manifest.tool)||!manifest.inputs?.length)throw Error('Artwork job does not match its frozen inputs');
    if(manifest.tool==='owner-authorized-native-composition') {
        if(manifest.ownerAuthorizedNativeComposition!==true||typeof manifest.authorizedResponse!=='string'||!manifest.authorizedResponse.trim()||!manifest.recipeFile||!manifest.recipeSha256)
            throw Error('Native artwork lacks explicit owner authorization and a frozen recipe');
        const bytes=await fs.readFile(manifest.recipeFile),recipe=JSON.parse(bytes.toString('utf8'));
        if(artHash(bytes)!==manifest.recipeSha256||recipe.tool!==manifest.tool||recipe.sector!==sector
            ||recipe.layoutSha256!==layoutSha256||recipe.wholeFrame!==true||recipe.width!==1024||recipe.height!==1024
            ||recipe.ownerAuthorization?.source!=='Direct owner response in this chat'
            ||recipe.ownerAuthorization?.response!==manifest.authorizedResponse
            ||!recipe.ownerAuthorization?.scope?.includes('native composition')||!recipe.operations?.length
            ||JSON.stringify(recipe.inputs?.map(({file,sha256})=>({file,sha256})))!==JSON.stringify(manifest.inputs.map(({file,sha256})=>({file,sha256}))))
            throw Error('Native artwork recipe does not match authorized frozen inputs');
        if(recipe.sha256!==manifest.outputSha256||artHash(await fs.readFile(recipe.output))!==recipe.sha256)
            throw Error('Native artwork output changed after composition');
    }
    for(const input of manifest.inputs) {
        if(input.sha256!==artHash(await fs.readFile(input.file)))throw Error('Artwork reference changed after the job was recorded');
    }
}

export function validateSemanticReview({ sector, paintingSha256, layoutSha256, imageSha256, entries }) {
    const matching = entries.filter(entry => entry.sector === sector && entry.sha256 === paintingSha256 && entry.layoutSha256 === layoutSha256);
    if (matching.length !== 1) throw Error(`Sector ${sector} lacks a unique current semantic review`);
    const review = matching[0];
    if (review.status !== 'approved' || !Array.isArray(review.findings) || review.findings.length
        || review.reviewImageSha256 !== imageSha256 || SEMANTIC_CHECKS.some(check => review.checks?.[check] !== true)) {
        throw Error(`Sector ${sector} has unresolved or incomplete semantic artwork review`);
    }
    return review;
}

/** Bind the rendered review itself to its painting and mask, independently of a report. */
export async function validateRenderedReview({ file, paintingSha256, layoutSha256 }) {
    const proof = JSON.parse(await fs.readFile(file + '.json', 'utf8'));
    const imageSha256 = artHash(await fs.readFile(file));
    if (proof.paintingSha256 !== paintingSha256 || proof.layoutSha256 !== layoutSha256
        || proof.imageSha256 !== imageSha256) {
        throw Error('Hatched review image is not current; rerun alignment with rendering enabled');
    }
    return proof;
}

// Exercise the compiled Profile upload with an isolated private object store.
import sharp from 'sharp';
if (process.env.NODE_ENV !== 'test' || process.env.SHINOBIX_QA_MEMORY_KV !== '1' || process.env.DISABLE_SCHEDULED_JOBS !== '1')
    throw Error('Profile detail QA requires disposable game storage');
const account = 'a'.repeat(32);
Object.assign(process.env,{AVATAR_MODEL_PROFILE_DETAIL_ENABLED:'1',AVATAR_MODEL_CREATION_ENABLED:'1',
    R2_PUBLIC_BASE:'http://127.0.0.1:'+process.env.PORT+'/review-assets',
    AVATAR_MODEL_READ_DAILY_LIMIT:'10',AVATAR_MODEL_READ_PLAYER_DAILY_LIMIT:'2',
    OPENAI_API_KEY:'local-fixture', AVATAR_MODEL_R2_ACCOUNT_ID:account,
    AVATAR_MODEL_R2_PRIVATE_BUCKET:'review-private', AVATAR_MODEL_R2_ACCESS_KEY_ID:'fixture', AVATAR_MODEL_R2_SECRET_ACCESS_KEY:'fixture'});
const original = globalThis.fetch, objects = new Map();
let lastDetail;
globalThis.fetch = async (input,options) => {
    const url = new URL(input.url ?? input);
    if (url.href.startsWith(process.env.R2_PUBLIC_BASE+'/')) return new Response(null,{status:404});
    if (url.href === 'https://api.openai.com/v1/moderations') {
        const image = JSON.parse(options.body).input[0].image_url.url;
        const pixels = buf => sharp(buf).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer();
        const expected = await pixels(Buffer.from(lastDetail));
        const submitted = await pixels(Buffer.from(image.split(',')[1],'base64'));
        if (!submitted.equals(expected)) throw Error('Make Model supplied different pixels from the current detailed upload');
        // End the check before paid classification. The fitted art is checked against the same upload separately.
        return Response.json({results:[{flagged:true}]});
    }
    if (url.hostname !== account+'.r2.cloudflarestorage.com') return original(input,options);
    if (!/^\/review-private\/avatar-model\/private\/profile-detail\/[a-f0-9]{64}$/.test(url.pathname)) throw Error('Unexpected review key');
    if (options.method === 'PUT') {
        lastDetail = await options.body.arrayBuffer();
        objects.set(url.pathname,lastDetail);
    }
    if (options.method === 'DELETE') objects.delete(url.pathname);
    if (options.method === 'GET' && !objects.has(url.pathname)) return new Response(null,{status:404});
    return new Response(options.method === 'GET' ? objects.get(url.pathname) : null);
};
await import('../dist/server.js');

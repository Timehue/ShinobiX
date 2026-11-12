import { createHash, createHmac } from 'node:crypto';
import sharp from 'sharp';
import { decodeBase64Image } from '../images.js';
import { kv } from '../_storage.js';
import { privateObjectRequest, readVerifiedPrivateObject } from './_private-files.js';
import { withKvLock } from '../_lock.js';

const maxBytes = 1024 * 1024;
const maxSide = 1024;
export const profileDigest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
type Detail = { thumbnail: string; source: string };
type Slots = [Detail | null, Detail | null];
const registry = (owner: string) => 'avatar-model:profile-detail:' + owner;
const slotKey = (owner: string, index: number) => profileDigest(Buffer.from(owner + '/' + index));
export const withProfileDetailLock = <T>(owner: string, action: () => Promise<T>) =>
    withKvLock(registry(owner)+':lock', action, { ttlSec: 180, failClosed: true });

/** The upload client has already rendered this still to an upright, metadata-free canvas. */
export async function prepareProfileDetail(owner: string, value: unknown) {
    if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 32)
        throw new RangeError('Invalid profile image size');
    const decoded = decodeBase64Image(value);
    if (!decoded || decoded.buf.length > maxBytes || !['image/webp','image/jpeg'].includes(decoded.mime))
        throw new RangeError('Expected a static profile image');
    const image = sharp(decoded.buf, { limitInputPixels: maxSide * maxSide, failOn: 'warning' });
    const meta = await image.metadata();
    if (meta.format !== (decoded.mime === 'image/webp' ? 'webp' : 'jpeg') ||
        !meta.width || !meta.height || Math.max(meta.width,meta.height) > maxSide ||
        (meta.pages ?? 1) !== 1 || meta.exif || meta.xmp || meta.iptc || meta.orientation)
        throw new RangeError('Unsupported profile image');
    const source = profileDigest(decoded.buf);
    // Bind even changes invisible at 256 px. The public tag is opaque and scoped to this account.
    const secret = process.env.AVATAR_MODEL_R2_SECRET_ACCESS_KEY;
    if (!secret) throw new Error('Private portrait storage unavailable');
    const tag = createHmac('sha256',secret).update('profile-thumbnail/v1\0'+owner+'\0'+source).digest('hex');
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:sj="urn:shinobij:portrait" sj:upload="' + tag + '"/></rdf:RDF></x:xmpmeta>';
    const thumb = await image.resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
        .withXmp(xmp).webp({ quality: 80 }).toBuffer();
    return { detail: decoded.buf, source, thumbnail: profileDigest(thumb), image: 'data:image/webp;base64,' + thumb.toString('base64') };
}

/** Called under the account lock. Keep the currently published source through failed uploads. */
export async function stageProfileDetail(owner: string, currentThumbnail: string | null, fit: Awaited<ReturnType<typeof prepareProfileDetail>>) {
    const key = registry(owner);
    const stored = await kv.get<Slots>(key);
    const slots: Slots = stored ? [...stored] : [null,null];
    const same = slots.findIndex(slot => slot?.source === fit.source && slot.thumbnail === fit.thumbnail);
    const index = same >= 0 ? same : slots[0]?.thumbnail === currentThumbnail ? 1 : 0;
    slots[index] = { source: fit.source, thumbnail: fit.thumbnail };
    // Track the bounded object before writing so even an interrupted upload can be erased.
    if (!await kv.compareSetMany?.([{op:'cas',key,expected:stored,value:slots}])) throw new Error('Concurrent profile update');
    const object = slotKey(owner,index);
    const response = await privateObjectRequest('profile-detail',object,'PUT',fit.detail);
    await response.body?.cancel();
    if (!response.ok) throw new Error('Unable to store private profile detail');
    await readVerifiedPrivateObject('profile-detail',object,fit.source,maxBytes);
}

export async function matchingProfileDetail(owner: string, thumbnail: string) {
    const slots = await kv.get<Slots>(registry(owner));
    const index = slots?.findIndex(slot => slot?.thumbnail === thumbnail) ?? -1;
    if (index < 0) return null;
    return readVerifiedPrivateObject('profile-detail',slotKey(owner,index),slots![index]!.source,maxBytes);
}

export async function eraseProfileDetail(owner: string) {
    const key = registry(owner);
    await withProfileDetailLock(owner, async () => {
        const slots = await kv.get<Slots>(key);
        if (!slots) return;
        for (const [index,slot] of slots.entries()) {
            if (!slot) continue;
            const res = await privateObjectRequest('profile-detail',slotKey(owner,index),'DELETE');
            await res.body?.cancel();
            if (!res.ok && res.status !== 404) throw new Error('Unable to erase private profile detail');
        }
        if (!await kv.compareSetMany?.([{op:'delete',key,expected:slots}])) throw new Error('Concurrent profile deletion');
    });
}

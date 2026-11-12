import { kv, type KvCasOp } from '../_storage.js';
import { safeName } from '../_utils.js';
import { decodeBase64Image, perImageKey, readImageValuesReport } from '../images.js';

/** Profile publishes under the lowercase display name. Older saves can use the account slug. */
export async function readSavedPortrait(owner: string, character: unknown) {
    const name = character && typeof character === 'object' && 'name' in character ? character.name : null;
    const names = new Set<string>();
    if (typeof name === 'string' && safeName(name) === owner) names.add(name.toLowerCase());
    names.add(owner);

    const guards: KvCasOp[] = [];
    for (const alias of names) {
        const id = 'avatar:' + alias;
        const key = perImageKey(id);
        const current = await kv.get<string>(key);
        guards.push({ op: 'assert', key, expected: current });
        if (current) return { decoded: decodeBase64Image(current), guards };
        const legacy = await readImageValuesReport('avatar', [id]);
        if (legacy.unread.length) throw new Error('Avatar store unavailable');
        if (legacy.values[id]) return { decoded: decodeBase64Image(legacy.values[id]), guards };
    }
    return { decoded: null, guards };
}

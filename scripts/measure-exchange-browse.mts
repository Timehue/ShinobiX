/**
 * Sunscar Exchange browse cost, measured on a seeded near-capacity market.
 *
 *   node --import tsx scripts/measure-exchange-browse.mts [--listings=2000] [--pet-images=0.1]
 *
 * Runs the real /api/festival/exchange handler in-process against the
 * in-memory KV (SHINOBIX_QA_MEMORY_KV, the store the integration tests use —
 * it never touches staging or production). For every request shape it reports:
 *   - payloadBytes: bytes of the JSON the client receives
 *   - storageOps / storageRows: every KV call the request makes and how many
 *     rows (or hash fields) came back
 *   - storageBytes: JSON size of everything those calls returned. A projected
 *     read counts its projected rows — what Postgres's mgetProjected returns —
 *     because the in-memory store has no database-side projection and the
 *     script gives it the same one-query projection production runs.
 *   - medianMs: wall clock over five runs. In-process, no network: this is
 *     serialization/CPU cost only. On Railway every storage op also pays a
 *     Supabase round trip, so the op count matters more than this number.
 *
 * The legacy request (`{ action: 'browse' }`, what a client without server
 * paging sends) is always measured; the bounded requests are measured when the
 * server supports them (a `market` block in the reply).
 */
import { projectKvValue } from '../api/_storage-projection.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'measure-exchange-browse-session-secret';

type Obj = Record<string, any>;
const arg = (name: string, fallback: number) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.split('=')[1]) : fallback;
};
const LISTINGS = arg('listings', 2000);
const PET_IMAGE_SHARE = arg('pet-images', 0.1);

void (async () => {
    const { kv } = await import('../api/_storage.js');
    const { issuePlayerToken } = await import('../api/_auth.js');
    const exchange = (await import('../api/festival/exchange.js')).default as unknown as (req: never, res: never) => Promise<unknown>;

    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const categories = ['weapons', 'armor', 'accessories', 'consumables', 'materials', 'pets', 'cards', 'resources'];
    const sellers = Array.from({ length: 120 }, (_, i) => `seller${i}`);
    const bigImage = `data:image/webp;base64,${'A'.repeat(40_000)}`;
    const imageEvery = PET_IMAGE_SHARE > 0 ? Math.max(1, Math.round(1 / PET_IMAGE_SHARE)) : 0;

    function listing(i: number): Obj {
        const category = categories[i % categories.length];
        const kind = category === 'pets' ? 'pet' : category === 'cards' ? 'card' : category === 'resources' ? 'resource' : 'item';
        const rarity = rarities[(i * 7) % rarities.length];
        const currency = i % 3 === 0 ? 'fateShards' : 'ryo';
        const price = 50 + ((i * 7919) % 250_000);
        const id = i.toString(16).padStart(32, '0');
        const name = `${rarity} ${category} ${i}`;
        const description = `A ${rarity} ${category.slice(0, -1)} carried across the Sunscar dunes. Lot ${i} of the caravan ledger, inspected and sealed by the Exchange.`;
        const petIndex = Math.floor(i / categories.length);
        const definition: Obj = kind === 'pet'
            ? { id: `pet-${i}`, name, rarity, level: 1 + (i % 80), attack: 40 + i % 50, defense: 30 + i % 40, hp: 300 + i % 200, speed: 20 + i % 30,
                element: ['Fire', 'Water', 'Wind'][i % 3], trait: 'Keen', generation: 1 + i % 4, breedingUsesRemaining: 3,
                moves: Array.from({ length: 4 }, (_, m) => ({ id: `move-${m}`, name: `Move ${m}`, power: 20 + m * 5, element: 'Fire' })),
                ...(imageEvery && petIndex % imageEvery === 0 ? { image: bigImage } : {}) }
            : { id: `item-${i}`, name, rarity, slot: category === 'weapons' ? 'hand' : category === 'armor' ? 'body' : 'item', levelReq: 1 + i % 90,
                bonuses: { attack: i % 20, defense: i % 15 }, description, image: `/items/${category}/${i % 40}.webp` };
        const asset = { kind, id: String(definition.id), name, category, rarity, description,
            stats: [{ label: 'Attack', value: String(i % 20) }, { label: 'Defense', value: String(i % 15) }],
            ...(typeof definition.image === 'string' ? { image: definition.image } : {}), level: 1 + i % 90 };
        const seller = sellers[i % sellers.length];
        const fee = Math.floor(price * 5 / 100);
        return { id, seller, sellerName: seller, asset, quantity: 1 + (i % 3), price, currency, fee, proceeds: price - fee,
            createdAt: 1_790_000_000_000 + i * 60_000, state: 'active', fingerprint: JSON.stringify([kind, asset.id, 1, price]),
            sealed: { asset, definition, stackable: false } };
    }

    for (const key of await kv.keys('*')) await kv.del(key);
    const live: Record<string, number> = {};
    for (let i = 0; i < LISTINGS; i += 1) {
        const l = listing(i);
        await kv.set(`sunscar-exchange:listing:${l.id}`, l);
        live[l.id] = l.createdAt;
    }
    if (LISTINGS) await kv.hset('sunscar-exchange:live', live);
    await kv.set('save:browser', { _saveVersion: 1, _saveAt: Date.now(), _regenAt: Date.now(), creatorItems: [], character: {
        name: 'browser', level: 60, ryo: 120_000, fateShards: 40_000, stats: {}, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [], weaponElements: {}, boneCharms: 0, auraStones: 0, honorSeals: 0, mythicSeals: 0,
    } });

    type Tally = { ops: number; rows: number; bytes: number; byOp: Record<string, number> };
    const size = (v: unknown) => (v === null || v === undefined ? 0 : Buffer.byteLength(JSON.stringify(v)));
    function instrument(): { tally: Tally; restore: () => void } {
        const tally: Tally = { ops: 0, rows: 0, bytes: 0, byOp: {} };
        const count = (name: string, rows: number, bytes: number) => {
            tally.ops += 1; tally.byOp[name] = (tally.byOp[name] ?? 0) + 1; tally.rows += rows; tally.bytes += bytes;
        };
        const originals = new Map<string, any>();
        const wrap = (name: string, rowsOf: (out: any) => number, reads = true) => {
            const original = (kv as any)[name].bind(kv);
            originals.set(name, (kv as any)[name]);
            (kv as any)[name] = async (...args: any[]) => {
                const out = await original(...args);
                count(name, reads ? rowsOf(out) : 0, reads ? size(out) : 0);
                return out;
            };
        };
        wrap('get', (out) => (out === null ? 0 : 1));
        wrap('mget', (out) => out.filter((v: unknown) => v !== null).length);
        wrap('hgetall', (out) => (out ? Object.keys(out).length : 0));
        wrap('hkeys', (out) => out.length);
        wrap('keys', (out) => out.length);
        for (const name of ['set', 'compareSet', 'hset', 'hdel', 'del', 'incr', 'delIfEqual']) wrap(name, () => 0, false);
        // One projected query, like Postgres: rows and bytes are the projection.
        const rawMget = originals.get('mget').bind(kv);
        (kv as any).mgetProjected = async (keys: string[], projection: Obj) => {
            const projected = (await rawMget(...keys)).map((v: unknown) => projectKvValue(v, projection));
            count('mgetProjected', projected.filter((v: unknown) => v !== null).length, size(projected));
            return projected;
        };
        return { tally, restore: () => { for (const [name, fn] of originals) (kv as any)[name] = fn; delete (kv as any).mgetProjected; } };
    }

    async function request(body: Obj): Promise<{ status: number; json: Obj; bytes: number }> {
        const out = { status: 200, json: {} as Obj };
        const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; }, json(data: Obj) { out.json = data; return this; }, end() { return this; } };
        await exchange({ method: 'POST', query: {}, body: JSON.parse(JSON.stringify({ playerName: 'browser', ...body })),
            headers: { 'x-player-name': 'browser', 'x-player-token': issuePlayerToken('browser')! }, socket: { remoteAddress: '10.0.0.7' } } as never, res as never);
        return { ...out, bytes: Buffer.byteLength(JSON.stringify(out.json)) };
    }

    async function measure(label: string, body: Obj, runs = 5) {
        const times: number[] = [];
        let last: { status: number; json: Obj; bytes: number } | null = null;
        let tally: Tally | null = null;
        for (let r = 0; r < runs; r += 1) {
            for (const key of await kv.keys('ratelimit:*')) await kv.del(key);
            const probe = instrument();
            const started = performance.now();
            last = await request(body);
            times.push(performance.now() - started);
            probe.restore();
            tally = probe.tally;
        }
        times.sort((a, b) => a - b);
        return {
            request: label, status: last!.status,
            payloadBytes: last!.bytes,
            listingsInReply: Array.isArray(last!.json.listings) ? last!.json.listings.length : (last!.json.market?.listings?.length ?? 0),
            totalMatching: last!.json.market?.total ?? (Array.isArray(last!.json.listings) ? last!.json.listings.length : null),
            storageOps: tally!.ops, storageOpsByKind: tally!.byOp, storageRows: tally!.rows, storageBytes: tally!.bytes,
            medianMs: Number(times[Math.floor(times.length / 2)].toFixed(1)),
        };
    }

    const results = [];
    results.push(await measure('legacy browse {action:"browse"}', { action: 'browse' }));
    const defaultQuery = { v: 2, page: 1, category: 'all', rarity: 'all', currency: 'all', sort: 'newest', search: '', affordable: false };
    for (const key of await kv.keys('ratelimit:*')) await kv.del(key);
    const probe = await request({ action: 'browse', market: defaultQuery });
    if (probe.json.market) {
        results.push(await measure('bounded browse (opening the Exchange)', { action: 'browse', market: defaultQuery }));
        results.push(await measure('market: page 2, newest', { action: 'market', market: { ...defaultQuery, page: 2 } }));
        results.push(await measure('market: pets, ryo, price low→high', { action: 'market', market: { ...defaultQuery, category: 'pets', sort: 'price-low', currency: 'ryo' } }));
        results.push(await measure('market: search "legendary", within budget', { action: 'market', market: { ...defaultQuery, search: 'legendary', affordable: true } }));
        results.push(await measure('market: past the last page, rarity sort', { action: 'market', market: { ...defaultQuery, sort: 'rarity', page: 9999 } }));
    }
    console.log(JSON.stringify({ listings: LISTINGS, petImageShare: PET_IMAGE_SHARE, results }, null, 2));
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

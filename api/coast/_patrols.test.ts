import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-patrols-test-secret';

import { RESERVED_CAST_MODELS } from '../../shared/coast-cast.js';
import { OPEN_COAST_SECTOR_IDS, coastExits, coastLayout } from '../../shared/coast-world.js';
import { coastTileWalkable } from '../../shared/coast-world-rules.js';
import { coastRegionOf } from '../../shared/world-maps.js';
import { buildWorldAiFightSpec, cleanWorldAiFightRequest } from '../missions/_world-ai-fight.js';
import {
    COAST_BEASTS, COAST_REGION_LEVELS, COAST_UNMOORED_PATROLS, coastPatrolFightStart, coastPatrolName, coastPatrolStanding, coastPatrolViews,
    coastPatrolLevel, coastPatrolsIn, coastSectorLevel, recordCoastPatrolWin,
} from './_patrols.js';

/*
 * The coast's own road cast: Unmoored patrols and one beast per region, posted
 * fresh each day in every open sector but the slip.
 */

const DAY = 24 * 60 * 60_000;
const T0 = 1_800_000_000_000;
const MODELS = join(process.cwd(), 'shinobij.client', 'src', 'data', 'sector-models');
const STRAND = 102;

let kv: typeof import('../_storage.js').kv;
before(async () => { ({ kv } = await import('../_storage.js')); });
beforeEach(async () => {
    for (const pattern of ['coast:*', 'save:*', 'ratelimit:*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

describe('the roster', () => {
    it('wears models the game already has, under new names', () => {
        const kinds = [...COAST_UNMOORED_PATROLS, ...COAST_BEASTS];
        assert.equal(new Set(kinds.map(kind => kind.id)).size, kinds.length);
        assert.equal(new Set(kinds.map(kind => kind.name)).size, kinds.length);
        for (const kind of kinds) {
            assert.ok(existsSync(join(MODELS, `${kind.model}.json`)), `${kind.id}: no fitted model named ${kind.model}`);
            assert.equal(RESERVED_CAST_MODELS.includes(kind.model), false, `${kind.id} wears a face players know by another name`);
            assert.doesNotMatch(kind.name, /[–—]|--/, `${kind.id}: no dash pauses`);
            assert.ok(kind.statBonus >= 0 && kind.statBonus <= 4, `${kind.id}: on the road cast's own scale`);
        }
        assert.equal(COAST_BEASTS.length, COAST_REGION_LEVELS.length, 'one beast for each region');
        assert.ok(COAST_BEASTS.every(kind => kind.beast) && COAST_UNMOORED_PATROLS.every(kind => !kind.beast));
    });

    it('posts two encounters in every open sector but the slip, and none anywhere else', () => {
        assert.deepEqual(coastPatrolsIn(101, T0), [], 'the slip is where everyone lands');
        for (const sector of [0, 5, 74, 99, 151]) assert.deepEqual(coastPatrolsIn(sector, T0), [], `sector ${sector}`);
        for (const sector of OPEN_COAST_SECTOR_IDS.filter(id => id !== 101)) {
            const patrols = coastPatrolsIn(sector, T0);
            assert.equal(patrols.length, 2, `sector ${sector}`);
            assert.equal(patrols[0].kind.beast, undefined, `sector ${sector}: the first is always the Unmoored`);
            if (patrols[1].kind.beast) assert.equal(patrols[1].kind, COAST_BEASTS[coastRegionOf(sector) - 1], `sector ${sector}: only its own region's beast`);
        }
    });

    it('stands each figure on open trail, clear of every doorway and trail end', () => {
        for (const sector of OPEN_COAST_SECTOR_IDS.filter(id => id !== 101)) {
            const layout = coastLayout(sector)!;
            const kept = new Set([...Object.values(layout.sites).map(site => site.approach), ...coastExits(sector).map(exit => exit.tile)]);
            const patrols = coastPatrolsIn(sector, T0);
            assert.notEqual(patrols[0].tile, patrols[1].tile, `sector ${sector}: two figures on one tile`);
            for (const patrol of patrols) {
                assert.equal(coastTileWalkable(layout.mask, patrol.tile), true, `sector ${sector}: stands on ground that cannot be walked`);
                assert.equal(kept.has(patrol.tile), false, `sector ${sector}: blocks a doorway or a trail`);
            }
        }
    });

    it('is the same all day and changes with the day', () => {
        assert.deepEqual(coastPatrolsIn(STRAND, T0), coastPatrolsIn(STRAND, T0 + 3_600_000));
        assert.notEqual(coastPatrolsIn(STRAND, T0)[0].id, coastPatrolsIn(STRAND, T0 + DAY)[0].id, 'the id carries its day');
        const week = Array.from({ length: 7 }, (_, day) => OPEN_COAST_SECTOR_IDS.map(sector => coastPatrolsIn(sector, T0 + day * DAY).map(patrol => `${patrol.kind.id}@${patrol.tile}`).join()).join('|'));
        assert.ok(new Set(week).size > 1, 'the coast does not look the same every day');
        const seen = new Set(Array.from({ length: 30 }, (_, day) => coastPatrolsIn(STRAND, T0 + day * DAY)[1].kind.id));
        assert.ok(seen.has('saltmarsh-hound') && seen.size > 1, 'the second slot is the beast on most days and a patrol on others');
    });

    it('rises through each region\'s band and never bends to the player', () => {
        assert.deepEqual([coastSectorLevel(101), coastSectorLevel(110), coastSectorLevel(111), coastSectorLevel(141), coastSectorLevel(150)], [75, 80, 80, 95, 100]);
        for (const sector of OPEN_COAST_SECTOR_IDS) {
            const [low, high] = COAST_REGION_LEVELS[coastRegionOf(sector) - 1];
            const level = coastSectorLevel(sector);
            assert.ok(level >= low && level <= high, `sector ${sector} is level ${level}`);
            if (sector % 10 !== 1) assert.ok(level >= coastSectorLevel(sector - 1), `sector ${sector} is not easier than the one before it`);
        }
    });

    it('stands above its sector: two levels up at a region’s first sector, ten above the region’s gate at its last', () => {
        // Owner, 2026-11-21: "make the patrols harder too". The regions are five levels wide, so a patrol at the
        // sector's own level was at most five above a player who had just arrived.
        assert.deepEqual([101, 110, 111, 120, 131, 140, 141, 150].map(coastPatrolLevel), [77, 85, 82, 90, 92, 100, 97, 100]);
        for (const sector of OPEN_COAST_SECTOR_IDS) {
            const [gate] = COAST_REGION_LEVELS[coastRegionOf(sector) - 1];
            const level = coastPatrolLevel(sector);
            assert.ok(level >= coastSectorLevel(sector) + 2 || level === 100, `sector ${sector}: a patrol is at least two above the ground it walks`);
            assert.ok(level <= Math.min(100, gate + 10), `sector ${sector}: and never more than ten above its region's gate`);
            assert.ok(level <= 100);
            if (sector % 10 !== 1) assert.ok(level >= coastPatrolLevel(sector - 1), `sector ${sector} is not easier than the one before it`);
            // What the board shows is what is fought (the fight is built from the same patrol).
            for (const patrol of coastPatrolsIn(sector, T0)) assert.equal(patrol.level, level);
        }
    });
});

describe('what a player’s finished quests make of the Unmoored', () => {
    const done = (...ids: string[]) => ({ v: 1, active: {}, done: Object.fromEntries(ids.map((id, at) => [id, { at: at + 1, marks: 1 }])) });
    const saved = (questLines: unknown, questStandings: string[] = []) => ({ questLines, character: { questStandings } });
    const scout = COAST_UNMOORED_PATROLS[0], hound = COAST_BEASTS[0];

    it('the garrison’s own until its commander falls, then masterless in that region only', () => {
        assert.equal(coastPatrolStanding(STRAND, null), 'unmoored');
        assert.equal(coastPatrolStanding(STRAND, saved(done('shuttered-boat', 'first-footing'))), 'unmoored');
        const bitterTide = saved(done('crossing-war-1'));
        assert.equal(coastPatrolStanding(STRAND, bitterTide), 'masterless');
        assert.equal(coastPatrolStanding(112, bitterTide), 'unmoored', 'the next region’s garrison still stands');
        assert.equal(coastPatrolStanding(149, saved(done('crossing-war-5'))), 'masterless');
        assert.equal(coastPatrolName(scout, 'masterless'), 'Masterless Scout');
        assert.equal(coastPatrolName(scout, 'unmoored'), 'Unmoored Scout');
    });

    it('after the finale the whole coast answers to what the player asked for', () => {
        const all = done('crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'crossing-war-4', 'crossing-war-5', 'the-unmoored');
        for (const sector of [STRAND, 115, 126, 138, 149]) {
            assert.equal(coastPatrolStanding(sector, saved(all, ['coast-opened'])), 'holdout', `sector ${sector}, coast opened`);
            assert.equal(coastPatrolStanding(sector, saved(all, ['coast-kept-closed'])), 'unmoored', `sector ${sector}, coast kept closed: they hold it by the player’s word`);
        }
        assert.equal(coastPatrolName(scout, 'holdout'), 'Holdout Scout');
    });

    it('a beast is a beast whatever a player has done, and every Unmoored name can be told apart in each standing', () => {
        for (const standing of ['unmoored', 'masterless', 'holdout'] as const) {
            assert.equal(coastPatrolName(hound, standing), hound.name);
            const names = COAST_UNMOORED_PATROLS.map(kind => coastPatrolName(kind, standing));
            assert.equal(new Set(names).size, names.length);
            if (standing !== 'unmoored') assert.ok(names.every(name => !name.includes('Unmoored')), names.join(', '));
        }
    });

    it('the board and the fight call the same patrol by the same name', async () => {
        const [first] = coastPatrolsIn(STRAND, Date.now());
        assert.equal(first.kind.beast, undefined, 'the first slot is always the Unmoored');
        const save = { ...saved(done('shuttered-boat', 'first-footing', 'crossing-war-1')), currentSector: STRAND, character: { name: 'walker', level: 78, questStandings: [] } };
        await kv.set('save:walker', save);
        const shown = (await coastPatrolViews('walker', STRAND, Date.now())).find(view => view.id === first.id)!;
        assert.equal(shown.name, coastPatrolName(first.kind, 'masterless'));
        const spec = await buildWorldAiFightSpec({ playerName: 'walker', request: cleanWorldAiFightRequest({ kind: 'coast-patrol', sourceId: first.id, sector: STRAND })!, save });
        assert.equal(spec.context.displayName, shown.name);
        assert.equal((spec.profile as { name?: string }).name, shown.name);
        // A player who has done nothing sees the same patrol, in the same place, under its own name.
        const fresh = (await coastPatrolViews('other', STRAND, Date.now())).find(view => view.id === first.id)!;
        assert.deepEqual([fresh.name, fresh.tile, fresh.level], [first.kind.name, shown.tile, shown.level]);
    });
});

describe('fighting one', () => {
    it('can be done once a day per player, and only today\'s', async () => {
        const [first, second] = coastPatrolsIn(STRAND, T0);
        assert.equal((await coastPatrolFightStart('walker', STRAND, first.id, T0)).kind, first.kind);
        await assert.rejects(coastPatrolFightStart('walker', STRAND, 'no-such-patrol', T0), /has moved on/);
        await assert.rejects(coastPatrolFightStart('walker', 103, first.id, T0), /has moved on/, 'a patrol belongs to its own sector');
        await assert.rejects(coastPatrolFightStart('walker', STRAND, first.id, T0 + DAY), /has moved on/, 'yesterday\'s patrol is gone');

        await recordCoastPatrolWin('walker', first.id);
        await recordCoastPatrolWin('walker', first.id);
        await assert.rejects(coastPatrolFightStart('walker', STRAND, first.id, T0), /already driven that one off today/);
        assert.equal((await coastPatrolFightStart('walker', STRAND, second.id, T0)).id, second.id, 'the other one is still there');
        assert.equal((await coastPatrolFightStart('other', STRAND, first.id, T0)).id, first.id, 'and it is there for everyone else');
        assert.deepEqual((await coastPatrolViews('walker', STRAND, T0)).map(view => view.beaten), [true, false]);
        assert.deepEqual((await coastPatrolViews('walker', STRAND, T0 + DAY)).map(view => view.beaten), [false, false], 'a new day, a new patrol');
        assert.equal((await kv.get<string[]>(`coast:patrol-beaten:walker:${Math.floor(T0 / DAY)}`))?.length, 1, 'a retried settlement marks nothing twice');
    });

    it('is an ordinary sealed world fight, at the sector\'s level', async () => {
        assert.equal(cleanWorldAiFightRequest({ kind: 'coast-patrol', sourceId: '5:0:1', sector: 5 }), null, 'never on the home map');
        const deep = coastPatrolsIn(150, T0)[0];
        const request = cleanWorldAiFightRequest({ kind: 'coast-patrol', sourceId: deep.id, sector: 150 })!;
        const save = { currentSector: 150, character: { name: 'Walker', level: 75, village: 'Stormveil Village', inventory: [], itemStacks: [] } };
        const spec = await buildWorldAiFightSpec({ playerName: 'walker', request, save, now: T0 });
        assert.deepEqual([spec.context.kind, spec.context.sourceId, spec.context.displayName, spec.context.sealVersion], ['coast-patrol', deep.id, deep.kind.name, undefined]);
        assert.equal(spec.profile.level, 100, 'a level 75 player in the last sector meets a level 100 foe');
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'walker', request, save: { ...save, currentSector: 149 }, now: T0 }), /world-sector-mismatch/);
        await recordCoastPatrolWin('walker', deep.id);
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'walker', request, save, now: T0 }), /already driven that one off today/);
    });
});

describe('the patrols route', () => {
    type Handler = (req: never, res: never) => Promise<unknown>;
    let handler: Handler, token: typeof import('../_auth.js').issuePlayerToken;
    let online: typeof import('../_realtime/online-store.js').onlineStore;
    before(async () => {
        ({ issuePlayerToken: token } = await import('../_auth.js'));
        ({ onlineStore: online } = await import('../_realtime/online-store.js'));
        handler = (await import('./patrols.js')).default as unknown as Handler;
    });
    async function call(who?: string) {
        const out = { status: 200, body: {} as Record<string, unknown> };
        const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
        await handler({ method: 'POST', body: {}, query: {}, headers: who ? { 'x-player-token': token(who) } : {}, socket: { remoteAddress: '127.4.9.9' } } as never, res as never);
        return out;
    }

    it('shows the roster of the sector the server says the player is in, and no other', async () => {
        assert.equal((await call()).status, 401);
        assert.equal((await call('ghostwalker')).status, 409, 'not in the world');
        online.upsert({ name: 'homewalker', sector: 5, tile: 78, character: { level: 80 } });
        assert.match(String((await call('homewalker')).body.error), /not on the coast/);
        online.upsert({ name: 'coastpatroller', sector: STRAND, tile: 56, character: { level: 80 } });
        const reply = await call('coastpatroller');
        assert.equal(reply.status, 200);
        const patrols = reply.body.patrols as Array<{ id: string; level: number; beaten: boolean }>;
        assert.deepEqual([reply.body.sector, patrols.length, patrols.every(patrol => patrol.level === coastPatrolLevel(STRAND) && !patrol.beaten)], [STRAND, 2, true]);
    });
});

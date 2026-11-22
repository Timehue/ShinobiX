import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { QUEST_ITEMS } from './quest-items.js';
import type { CoastLand, Landing } from '../shinobij.client/src/screens/world-map/coast-service.js';
import { atlasPlate, plotPaint, plotPlate } from '../shinobij.client/src/screens/world-map/coast-plot.js';
import { QUEST_LINES, QUEST_LINE_CATALOGUE } from '../api/quests/_catalog.js';
import { QUEST_PAINTINGS } from '../api/quests/_views.js';
import { coastStoryArt, coastRewardArt } from '../shinobij.client/src/lib/coast-journal-art.js';
import type { CoastFloor } from './coast-world-rules.js';
import { pathTo } from '../shinobij.client/src/screens/world-map/coast-grid.js';

const publicDir = fileURLToPath(new URL('../shinobij.client/public/', import.meta.url));
const art: Record<string, string> = JSON.parse(readFileSync(join(publicDir, 'coast-landing/art.json'), 'utf8'));

test('coast journal and backpack images resolve to the shipped files', () => {
    for (const item of QUEST_ITEMS) assert.ok(existsSync(join(publicDir, item.image)), item.id);
    for (const [key, url] of Object.entries(art)) {
        assert.ok(existsSync(join(publicDir, url)), key);
        if (key.startsWith('badge-') || key.startsWith('gear-')) assert.equal(coastRewardArt(key)?.image, url);
    }
    for (const region of ['saltstair', 'brackwater', 'briarwood', 'whitecrown', 'hushcrown']) {
        for (let tier = 1; tier <= 4; tier++) assert.ok(coastRewardArt(`badge-${region}-tier-${tier}`));
    }
    // The server names each quest's painting by quest id (QUEST_PAINTINGS), so a
    // title can change freely; the client only turns the name into a path.
    assert.equal(coastStoryArt(QUEST_PAINTINGS['crossing-war-1']), art['story-bitter-tide']);
    assert.equal(coastStoryArt(QUEST_PAINTINGS['the-unmoored']), art['story-quiet-crown']);
    for (const line of Object.values(QUEST_LINES)) assert.ok(existsSync(join(publicDir, coastStoryArt(QUEST_PAINTINGS[line.id]) ?? 'missing')), `${line.id} has no journal painting`);
    assert.deepEqual(Object.keys(QUEST_PAINTINGS).sort(), Object.keys(QUEST_LINES).sort(), 'a painting for every quest and for nothing else');
    assert.equal(new Set(Object.values(QUEST_PAINTINGS)).size, Object.keys(QUEST_PAINTINGS).length, 'no two quests share a painting');
    assert.equal(coastStoryArt(QUEST_PAINTINGS['boatwright-tools-2']), '/scenes/story/coast-pitchwrack-v1.webp');
    assert.equal(coastStoryArt(QUEST_PAINTINGS['crossing-war-2']), '/scenes/story/coast-mirror-hold-v1.webp');
    assert.equal(coastStoryArt(QUEST_PAINTINGS['crossing-war-3']), '/scenes/story/coast-beast-bond-v1.webp');
    assert.equal(coastStoryArt(QUEST_PAINTINGS['crossing-war-4']), '/scenes/story/coast-rime-lock-v1.webp');
    assert.equal(coastStoryArt(undefined), undefined);
    for (const name of Object.values(QUEST_PAINTINGS)) assert.match(name, /^[a-z-]+$/, 'a painting is named by a plain slug');
});

test('each Clan Landing plan has connected furnishings, reciprocal stairs and an outdoor exit', () => {
    const plans: { floors: CoastFloor[] }[] = JSON.parse(readFileSync(join(publicDir, 'coast-landing/plans.json'), 'utf8'));
    assert.deepEqual(plans.map(plan => plan.floors.length), [1, 1, 2]);
    for (const { floors } of plans) {
        assert.ok(floors[0].doors.length);
        floors.forEach((floor, index) => {
            assert.ok(floor.art && existsSync(join(publicDir, floor.art)));
            for (const destination of [...floor.doors, ...floor.stations.map(station => station.approach)]) {
                assert.ok(pathTo(floor.mask, floor.spawn, destination));
            }
            for (const stair of floor.stairs) {
                assert.ok(pathTo(floor.mask, floor.spawn, stair.tile));
                const next = floors[stair.to];
                const reverse = next.stairs.find(step => step.to === index);
                assert.ok(reverse && pathTo(next.mask, stair.arrival, reverse.tile));
            }
        });
    }
});


const shore: CoastLand = { sector: 102, name: 'Wrack Strand', holder: null, contest: null };
const claim = { clan: 'Reed Watch', since: 1, immuneUntil: 2 };
const contest = { id: 'watch', clan: 'Reed Watch', phase: 'posted', opensAt: 5, closesAt: 7, score: 0, target: 20, roster: 3 };

test('the atlas uses each painted plate and keeps the location and access states visible', () => {
    const disputed = { ...shore, holder: claim, contest };
    const states = [
        atlasPlate(true, true, false, disputed), atlasPlate(false, true, false, disputed),
        atlasPlate(false, false, false, disputed), atlasPlate(false, false, true, disputed),
        atlasPlate(false, false, true, { ...disputed, contest: { ...contest, phase: 'closed' } }),
        atlasPlate(false, false, true, shore),
    ];
    assert.deepEqual(states, ['here', 'sealed', 'shut', 'contested', 'held', 'open']);
    for (const state of states) assert.ok(existsSync(join(publicDir, 'coast-map/markers/atlas-' + state + '-v1.webp')));
});

test('a plot shows only its own standing or fallen Landing and extinguishes its dormant Watch Fire', () => {
    const works = ['store-shed', 'drying-racks', 'watch-fire'].map(id => ({
        id, name: id, does: '', quest: '', needsTier: '', cost: {}, built: true, canBuild: false, block: 'built' as const,
    }));
    const camp = { sector: 102, tier: 1, status: 'active', name: 'Founding Camp', stores: {}, next: null,
        upkeep: { perWeek: 6, dormantWeeks: 0, graceUntil: 1 }, thisWeek: {}, yours: { used: 0, cap: 60 }, works };
    const base: Landing = { clan: 'Reed Watch', canFound: false, rules: { materials: [], perContribution: 20 },
        fallen: { sector: 103, at: 1, reason: 'ground-lost' }, landing: camp };
    const active = plotPaint(102, base);
    assert.ok(active.scene?.endsWith('camp-v1.webp'));
    assert.deepEqual(active.works, works);
    const sleeping = plotPaint(102, { ...base, landing: { ...camp, status: 'dormant' } });
    assert.equal(sleeping.dormant, true);
    assert.deepEqual(sleeping.works.map(work => work.id), ['store-shed', 'drying-racks']);
    const ruin = plotPaint(103, base);
    assert.equal(ruin.main, plotPlate('fallen-landing'));
    assert.equal(ruin.scene, plotPlate('fallen-landing-entry'));
    assert.deepEqual(ruin.works, []);
    assert.equal(plotPaint(146, base).main, undefined);
    assert.equal(plotPaint(102, { ...base, landing: { ...camp, tier: 0, works: [] } }).main, plotPlate('staked-plot'));
});

test('Rounds and side tales render without a story illustration', () => {
    for (const series of ['coast-rounds', 'coast-tales']) {
        const lines = Object.values(QUEST_LINE_CATALOGUE.lines).filter(line => line.series === series);
        assert.equal(lines.length, series === 'coast-rounds' ? 20 : 10);
        for (const line of lines) assert.equal(coastStoryArt(QUEST_PAINTINGS[line.id]), undefined, line.id);
    }
});

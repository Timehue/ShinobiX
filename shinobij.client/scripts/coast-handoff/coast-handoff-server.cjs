// Private Playwright fixture. Only the fork's IPC channel can seed an account.
const assert = require('node:assert/strict');
const path = require('node:path');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.SHINOBIX_QA_MEMORY_KV, '1');
assert.equal(typeof process.send, 'function');
const dist = file => require(path.resolve(process.env.COAST_QA_SERVER_DIST || 'dist', file));
dist('server.js');
const { kv } = dist('api/_storage.js');
const { QUEST_LINE_CATALOGUE: catalogue } = dist('api/quests/_catalog.js');
const { STORY_INTERLUDE_DEFS } = dist('api/_story-interludes.js');
const { COAST_REGION_LEVELS, COAST_MIN_LEVEL, coastRegionOf } = dist('shared/world-maps.js');
const { coastQuestPresence } = dist('api/quests/_coast-presence.js');
process.on('message', async ({ name, sector, kind }) => {
    try {
        assert.match(name, /^coastqa[a-z0-9]+$/);
        const save = await kv.get('save:' + name);
        assert(save?.character);
        if(kind==='stock-test-landing' || kind==='rest-test-landing') {
            const status=await dist('api/coast/_landing.js').coastLandingView(name);
            assert.equal(status.clan,'Coast Test Clan');
            assert(status.landing);
            const key=dist('api/coast/_landing-store.js').coastLandingKey(dist('api/_utils.js').clanBareSlug(status.clan));
            const row=await kv.get(key); assert(row);
            if(kind==='rest-test-landing') await kv.set(key,{...row,status:'dormant'});
            else {
                assert(status.landing.next);
                const works=row.tier===2 ? ['store-shed','drying-racks','watch-fire'] : row.works;
                await kv.set(key,{...row,stores:{...status.landing.next.cost},works});
            }
            process.send({ok:true}); return;
        }
        const record = { v: 1, done: {}, active: {} };
        function finish(id) {
            if (record.done[id]) return;
            const line = catalogue.lines[id];
            for (const prerequisite of line.gate.quests ?? []) finish(prerequisite);
            const { opensRegion, unlocks } = line.rewards;
            record.done[id] = { at: 1, marks: line.marks, opensRegion, unlocks };
        }
        function stage(id, key) {
            const line = catalogue.lines[id];
            for (const prerequisite of line.gate.quests ?? []) finish(prerequisite);
            const index = line.stages.findIndex(s => s.key === key);
            assert(index >= 0, id + '/' + key);
            delete record.done[id];
            record.active[id] = { at: 1, stage: index };
        }
        const region = kind === 'atlas' ? COAST_REGION_LEVELS.length : Math.max(1, coastRegionOf(sector));
        for (const line of Object.values(catalogue.lines)) {
            if (line.rewards.opensRegion && line.rewards.opensRegion <= region) finish(line.id);
        }
        if (sector === 140) stage('uncounted-3', kind === 'captain' ? 'captain' : 'cairn');
        if (sector === 137) stage('crossing-war-4', 'sentry');
        if (kind === 'bell-hang' || kind === 'bell-bury') {
            finish('tale-second-bell');
            record.done['tale-second-bell'].choices = { clapper: kind.slice(5) };
        }
        if (kind === 'lost-lures' || kind === 'one-lure') {
            stage('untamed-coast-1', 'set');
            record.active['untamed-coast-1'].took = true;
            save.character.inventory = [];
            save.character.itemStacks = [{ itemId: 'quest-needle-fish', count: 4 }];
            if (kind === 'one-lure') save.character.itemStacks.push({ itemId: 'quest-scent-lure', count: 1 });
        }
        if (kind === 'letter') stage('tale-unsent-letter', 'letter');
        if (kind === 'boss') stage('first-footing', 'captain');
        if (kind === 'atlas') {
            // The open beginnings already cover three regions. Pick active steps
            // from real, distinct lines for the regions those beginnings miss.
            for (const [id,key] of [['tale-runners-cord','shrine'],['tale-second-bell','bell']]) stage(id,key);
        }
        const level = kind === 'below' ? COAST_MIN_LEVEL - 1 : Math.max(COAST_REGION_LEVELS[region-1][0],
            ...Object.keys(record.active).map(id => catalogue.lines[id].gate.level));
        const triggeredEvents = Object.values(STORY_INTERLUDE_DEFS)
            .filter(d => d.village === save.character.village && d.levelReq <= level).map(d => d.id);
        if(kind==='livery' || kind==='weather') {
            const clan=kind==='weather' ? 'Tidewatch' : 'Coast Test Clan';
            await kv.set(dist('api/_utils.js').clanRecordKey(clan),{name:clan,founderName:name,createdAt:1000,members:[{name,joinedAt:1000}]});
            save.character.clan=clan;
            const granted=await dist('api/coast/_land.js').grantCoastClaim({sector,clanName:clan});
            assert(granted.ok,JSON.stringify(granted));
        }
        if(kind==='roads') Object.assign(save.character,{hp:100,chakra:100,stamina:100,inventory:[],itemStacks:[]});
        await kv.set('save:' + name, { ...save, worldGeoV: 2, currentSector: sector, triggeredEvents,
            character: { ...save.character, level, onboardingStep: 'done' }, questLines: record });
        const keepers = coastQuestPresence({ catalogue },record,[]).figures.filter(f => f.room);
        process.send({ ok: true, level, keepers, region });
    } catch (error) { process.send({ ok: false, error: String(error.stack) }); }
});

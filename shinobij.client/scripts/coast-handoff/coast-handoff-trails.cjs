// Run from the repository root after building the server.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomUUID();
const built = file => require(path.resolve('dist',file));
const { kv } = built('api/_storage.js');
const { issuePlayerToken } = built('api/_auth.js');
const { onlineStore } = built('api/_realtime/online-store.js');
const travel = built('api/player/travel.js').default;
const { coastExits } = built('shared/coast-world.js');
const { COAST_SECTOR_IDS, COAST_REGION_LEVELS } = built('shared/world-maps.js');
const { QUEST_LINE_CATALOGUE } = built('api/quests/_catalog.js');

async function verify() {
    const done = {};
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        const { opensRegion, unlocks } = line.rewards;
        if (opensRegion || unlocks) done[line.id] = { at: 1, marks: line.marks, opensRegion, unlocks };
    }
    const visited = new Set();
    const inward = { north:12, south:-12, west:1, east:-1 };
    let count = 0;
    for (const from of COAST_SECTOR_IDS) {
        const exits = coastExits(from);
        assert(exits.length, 'No trail from sector ' + from);
        for (const edge of exits) {
            const to = edge.destinationSector;
            const reverse = coastExits(to).find(other => other.id === edge.destinationExitId);
            assert(reverse && reverse.destinationSector === from && reverse.destinationExitId === edge.id, edge.id);
            assert.equal(reverse.lane,edge.lane);
            assert.equal(edge.destinationTile,reverse.tile + inward[reverse.direction]);
            assert.equal(reverse.destinationTile,edge.tile + inward[edge.direction]);
            const name = 'coastqaedge' + (++count);
            await kv.set('save:' + name, { _saveVersion: 1, currentSector: from, worldGeoV: 2,
                questLines: { v: 1, active: {}, done },
                character: { name, village: 'Stormveil Village', level: COAST_REGION_LEVELS.at(-1)[1], inventory: [] } });
            onlineStore.upsert({ name, sector: from, tile: edge.tile, character: null });
            const response = { code: 200, setHeader() { return this; }, status(code) { this.code = code; return this; },
                json(body) { this.body=body;return this; }, end() { return this; } };
            await travel({ method: 'POST', body: { mode:'edge', destinationSector:to, originSector:from,
                originTile:edge.tile, exitId:edge.id }, headers: { 'content-type':'application/json',
                'x-player-token':issuePlayerToken(name) }, socket: { remoteAddress:'127.8.1.' + count } },response);
            assert.equal(response.code,200,edge.id + ' ' + JSON.stringify(response.body));
            assert.equal(response.body.travelMs,0);
            assert.equal(response.body.arrivalTile,edge.destinationTile);
            const arrived = onlineStore.get(name);
            assert.equal(arrived.sector,to);
            assert.equal(arrived.tile,edge.destinationTile);
            visited.add(from);visited.add(to);
        }
    }
    const roadMap = require(path.resolve('output/coast/saltstair-landing/coast-roads.json'));
    assert.equal(count,roadMap.roads.length*2);
    assert.equal(visited.size,COAST_SECTOR_IDS.length);
    console.log(count + ' signed crossings passed on ' + roadMap.roads.length + ' reciprocal trails across ' + visited.size + ' sectors.');
}
verify().catch(error=>{console.error(error);process.exitCode=1;});


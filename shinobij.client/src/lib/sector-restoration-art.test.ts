import test from 'node:test';
import assert from 'node:assert/strict';
import { RUIN_WEATHERING_MS, clearSectorRestorations, sectorRestorationPhases, sectorRestorationRevision, setSectorRestorations } from './sector-restoration-art';
import { setRestoredRuinFeed } from './sector-banner-state';

const day = 86_400_000;
test('neighbouring sectors paint from the world snapshot and the current sector uses its fresher counter view',()=>{
    try{
        const now=Date.now();
        setRestoredRuinFeed([{id:'gorgewatch',sector:38,intactUntil:now+3*day},{id:'esplanade-record-house',sector:50,intactUntil:now+3*day},{id:'not-a-ruin',sector:50,intactUntil:now+day*3}]);
        assert.deepEqual(sectorRestorationPhases(38),[{id:'gorgewatch',phase:'restored'}],'a sector you are not in still paints from the snapshot');
        assert.deepEqual(sectorRestorationPhases(50),[{id:'esplanade-record-house',phase:'restored'}],'unknown ids are ignored');
        const before=sectorRestorationRevision();
        setSectorRestorations(52,[{id:'festival-welcome',intactUntil:now+2*day}]);
        assert.deepEqual(sectorRestorationPhases(52),[{id:'festival-welcome',phase:'restored'}],'a just-finished restoration shows before the snapshot catches up');
        assert.ok(sectorRestorationRevision()>before);
        setSectorRestorations(38,[]);assert.deepEqual(sectorRestorationPhases(38),[],'standing in a sector, its own view wins');
        clearSectorRestorations(38);assert.deepEqual(sectorRestorationPhases(38),[{id:'gorgewatch',phase:'restored'}],'leaving hands it back to the snapshot');
        const stable=sectorRestorationRevision();assert.equal(sectorRestorationRevision(),stable,'no change, no repaint');
    }finally{setRestoredRuinFeed([]);clearSectorRestorations(52);clearSectorRestorations(38);}
});
test('in the current sector, a newer world feed beats an older counter view',()=>{
    try{
        const now=Date.now();
        setSectorRestorations(62,[{id:'grey-landing-relay',intactUntil:now+3*day}]);
        assert.deepEqual(sectorRestorationPhases(62),[{id:'grey-landing-relay',phase:'restored'}]);
        // Another crew's change (or a fight) reaches the feed before the counter reloads.
        setRestoredRuinFeed([{id:'grey-landing-memorial',sector:62,intactUntil:now+2*day}]);
        assert.deepEqual(sectorRestorationPhases(62),[{id:'grey-landing-memorial',phase:'restored'}],'the fresher feed wins');
        setSectorRestorations(62,[]);
        assert.deepEqual(sectorRestorationPhases(62),[],'a counter view newer than the feed wins again');
    }finally{setRestoredRuinFeed([]);clearSectorRestorations(62);}
});
test('the last day shows the weathered painting and a lapsed restoration disappears',()=>{
    try{
        const now=Date.now();
        setSectorRestorations(60,[{id:'obsidian-waystation',intactUntil:now+RUIN_WEATHERING_MS-60_000},{id:'obsidian-north-watch',intactUntil:now-1}]);
        assert.deepEqual(sectorRestorationPhases(60),[{id:'obsidian-waystation',phase:'weathered'}]);
        assert.equal(RUIN_WEATHERING_MS,day);
    }finally{clearSectorRestorations(60);}
});

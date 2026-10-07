import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_EXITS, sectorExits } from '../../../shared/sector-links.js';
import { gateGlimpseBand } from './sector-gate-glimpse.js';

test('every road mouth retains its own neighbor preview, including adjacent exits',()=>{
    for(const exit of SECTOR_EXITS){
        const band=gateGlimpseBand(exit,sectorExits(exit.sector));
        assert.ok(band.start<=band.lane+.5&&band.end>=band.lane+.5);
        assert.ok(band.start>=0&&band.end<=12&&band.end>band.start);
        for(const other of sectorExits(exit.sector).filter(e=>e.id!==exit.id&&e.direction===exit.direction)){
            const neighbor=gateGlimpseBand(other,sectorExits(exit.sector));
            assert.ok(band.end<=neighbor.start||neighbor.end<=band.start,`Overlapping previews ${exit.id}/${other.id}`);
        }
    }
});

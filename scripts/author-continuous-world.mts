import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { buildContinuousWorldSpace } from '../shared/continuous-world-space';
import { sectorWalkMask } from '../shared/sector-walk-mask';

// Authoring only. Runtime uses one admitted, versioned layout, never an A* rebuild.
const space = buildContinuousWorldSpace();
const masks = space.chunks.map(c => [c.sector, sectorWalkMask(c.sector)]);
const layoutVersion = `cw1-${createHash('sha256').update(JSON.stringify({ space, masks })).digest('hex').slice(0, 20)}`;
await writeFile(new URL('../shared/continuous-world-layout.json', import.meta.url), JSON.stringify({ layoutVersion, ...space }) + '\n');
console.log(`Authored ${layoutVersion}: ${space.chunks.length} chunks, ${space.roads.length} roads`);

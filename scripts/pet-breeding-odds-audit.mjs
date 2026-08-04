import { PET_CATALOG } from '../api/pet/_catalog.js';
import { rollChromatic, selectOffspringTemplate } from '../api/pet/_breeding.js';

const iterations = 1_000_000;
const parent1 = { ...PET_CATALOG['standard-0'], id: 'audit-parent-1', templateId: 'standard-0' };
const parent2 = { ...PET_CATALOG['standard-6'], id: 'audit-parent-2', templateId: 'standard-6' };
const counts = { parent1: 0, parent2: 0, sameElementTier: 0, randomNonStandard: 0, chromatic: 0 };

for (let index = 0; index < iterations; index += 1) {
    const selection = selectOffspringTemplate(parent1, parent2, index % 10_000, (min) => min);
    counts[selection.outcome] += 1;
    if (rollChromatic(index % 2_000)) counts.chromatic += 1;
}

const expected = { parent1: 450_000, parent2: 450_000, sameElementTier: 90_000, randomNonStandard: 10_000, chromatic: 500 };
for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) throw new Error(`Odds drift for ${key}: expected ${value}, got ${counts[key]}`);
}

console.log(`pet-breeding-odds: ${iterations.toLocaleString()} deterministic rolls`, counts);

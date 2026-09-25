import { resolve } from 'node:path';
import { rawPetPool } from '../../src/data/pet-pool.ts';
import { STARTER_PETS } from '../../src/data/starter-pets.ts';
import { STARTER_EVOLUTIONS } from '../../src/data/pet-evolutions.ts';
import { petCombatModel } from '../../src/lib/pet-3d-models.ts';

const clientRoot = resolve(import.meta.dirname, '../..');
const catalog = [...rawPetPool, ...STARTER_PETS.map(option => option.pet), ...STARTER_EVOLUTIONS];
if (catalog.length !== 161 || new Set(catalog.map(pet => pet.id)).size !== 161) throw new Error('Expected 161 unique production pet identities');

/** Follow the combat renderer, including starter replacements and showcases. */
export const runtimePetModels = catalog.map(pet => {
    const model = petCombatModel(pet);
    if (!model) throw new Error(`${pet.id}: runtime has no approved combat model`);
    const pathname = new URL(model.url, 'https://local.invalid').pathname;
    if (!/^\/pet-models\/(?:roster\/|showdown-v2\/)?[a-z0-9-]+\.glb$/.test(pathname)) throw new Error(`${pet.id}: invalid local model URL`);
    return { pet, model, path: resolve(clientRoot, `public${pathname}`), source: pathname.includes('/showdown-v2/') ? 'showcase' : 'identity' };
});

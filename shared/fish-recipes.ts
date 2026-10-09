import { resourceItemId, RESOURCE_GRADES, type ResourceGrade } from './resource-items';
export type FishRecipeId = 'fish-rations-common' | 'fish-rations-fine' | 'fish-rations-superior' | 'fish-rations-pristine';
export const FISH_RECIPES = RESOURCE_GRADES.map((name, grade) => ({
    id: `fish-rations-${name.toLowerCase()}` as FishRecipeId, name: `${name} Fish Rations`, ryo: 30,
    materials: [resourceItemId('gather-river-fish', grade as ResourceGrade)], materialCount: 5,
    herbs: 1, fuel: 1, rations: (grade + 1) * 5,
}));

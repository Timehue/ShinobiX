import type { Pet } from '../types/pet';
import { petVisualId } from '../data/pet-evolutions';
import { petCardImage } from './pet-battle-anim';
import { petStripVariant } from './pet-presentation-keys';
import { PET_SCENIC_PORTRAITS } from './pet-portrait-assets.generated';
import { firstSharedImage, petPaletteVariant } from './pet-visual-variant';

/** Scenic art is exclusively for portrait surfaces. Combat image/pose/sheet and
 * GLB resolvers retain their existing assets and priorities. */
export function petScenicPortraitImage(pet: Pet, sharedImages: Record<string, string> = {}): string {
    const canonicalId = pet.templateId?.trim() || petStripVariant(pet.id.split(':', 1)[0]);
    const ids = [petVisualId({ ...pet, templateId: canonicalId })];
    const variant = petPaletteVariant(pet);
    const authoredVariant = variant && firstSharedImage(sharedImages, ids.flatMap((id) => [
        `petcard:${id}:variant:${variant}`,
        `pet:${id}:variant:${variant}`,
        `petbody:${id}:variant:${variant}`,
    ]));
    if (authoredVariant) return authoredVariant;
    const authoredCard = firstSharedImage(sharedImages, ids.map((id) => `petcard:${id}`));
    if (authoredCard) return authoredCard;
    return ids.map((id) => PET_SCENIC_PORTRAITS[id]).find(Boolean) || petCardImage(pet, sharedImages);
}

export type PetCareAction = 'pet' | 'feed' | 'complete-training';
export type PetCareReactionKind = 'pet' | 'feed' | 'training';
export type PetCareCue = { serial: number; petId: string; kind: PetCareReactionKind };
export type PetAppearancePreview = 'current' | 'original';

export function petCareReactionKind(action: string, settledTraining?: string | null): PetCareReactionKind | null {
    if (settledTraining) return 'training';
    return action === 'pet' || action === 'feed' ? action : null;
}

/** Small reactions reuse reviewed rest and victory takes. No extra animation
 * assets, skeleton passes, physics or displacement on planted feet. */
export function petCareReaction(kind: PetCareReactionKind, age: number) {
    const duration = kind === 'feed' ? 1.6 : kind === 'training' ? 1.8 : 1.2;
    const active = Number.isFinite(age) && age >= 0 && age < duration;
    return { active, motion: active && kind !== 'training' ? 'rest' as const : 'idle' as const,
        victorious: active && kind === 'training' };
}

/** The existing catalog expresses aura colors as CSS RGBA. Three's material
 * color has no alpha channel; opacity is controlled by the aura material. */
export function petCollarPreviewColor(glow: string): string {
    const channels = glow.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)?.slice(1, 4);
    return channels ? `#${channels.map(c => Math.max(0, Math.min(255, Number(c))).toString(16).padStart(2, '0')).join('')}` : '#facc15';
}

import { PET_CHARACTER_MOTION_ASSET_REVISION } from './pet-proper-animation-assets';

export interface PetCharacterMotionBank {
    revision: string;
    clips: readonly { contacts: number }[];
}
const SUPPORT_MOTIONS = new Set(['idle', 'run', 'dash', 'guard', 'rest']);
export function petHasBakedRigMotion(bank: PetCharacterMotionBank | undefined): boolean {
    return bank?.revision === PET_CHARACTER_MOTION_ASSET_REVISION && bank.clips.length > 0;
}

/** Planted clips already solve the body against its feet. An additional host
 * crouch/bob/tilt would move those contacts off the floor a second time. */
export function petBakedSupportOwnsBody(
    frame: { motion: string; victorious?: boolean; entranceProgress?: number },
    profile: string,
    bank: PetCharacterMotionBank | undefined,
    aquatic: boolean,
): boolean {
    return petHasBakedRigMotion(bank)
        && bank!.clips.some(clip => clip.contacts > 0)
        && !aquatic && !frame.victorious
        && !(frame.entranceProgress !== undefined && frame.entranceProgress < 1)
        && SUPPORT_MOTIONS.has(frame.motion)
        && !(profile === 'avian' && frame.motion === 'dash');
}

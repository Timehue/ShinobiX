export type PetTechniqueStyle = 'neutral' | 'jab' | 'sweep' | 'heavy' | 'lunge' | 'channel';
export type PetTechniquePose = { pitch: number; yaw: number; roll: number };

/** Resolve once when the move changes. Reuse the rig's authored take: no extra
 * tracks, geometry, particles or per-frame skeleton traversal. */
export function petTechniqueStyle(name?: string, casting = false): PetTechniqueStyle {
    if (!name) return 'neutral';
    if (casting) return 'channel';
    if (/breaker|slam|crush|quake|impact|crash|maul|overrun/i.test(name)) return 'heavy';
    if (/sweep|tail|claw|slash|rend|wound|whip/i.test(name)) return 'sweep';
    if (/pounce|fang|bite|rush|tackle|lunge|charge/i.test(name)) return 'lunge';
    return 'jab';
}

/** A small, grounded torso accent. Host-owned progress keeps contact aligned
 * with the actual hit and pauses perfectly with the battle clock. Zero at the
 * phrase boundaries prevents a lingering move from leaking into idle/KO. */
export function petTechniquePose(style: PetTechniqueStyle, motion: string, progress: number): PetTechniquePose {
    const pose = { pitch: 0, yaw: 0, roll: 0 };
    if (style === 'neutral' || !['windup', 'strike', 'recover'].includes(motion)) return pose;
    const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    const anticipation = p * p * (3 - 2 * p);
    const release = (1 - p) ** 2;
    const beat = motion === 'windup' ? -anticipation : motion === 'strike' ? release : .22 * release;
    if (beat === 0) return pose;
    if (style === 'sweep') { pose.yaw = beat * .1; pose.roll = beat * -.035; }
    else if (style === 'heavy') pose.pitch = beat * .095;
    else if (style === 'lunge') { pose.pitch = beat * .055; pose.yaw = beat * .025; }
    else if (style === 'channel') { pose.pitch = beat * -.035; pose.roll = beat * .025; }
    else { pose.pitch = beat * .025; pose.yaw = beat * -.035; }
    return pose;
}

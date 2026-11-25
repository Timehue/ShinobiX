import residentStrides from '../data/cinderhold-standing-ids.json';

// These account names are reserved for the village residents. Scouting and
// sleeping presence can omit both the equipped model and the portrait.
export function residentStrideFile(name: string) {
    const id = name.trim().toLowerCase();
    if (Object.hasOwn(residentStrides, id)) return id + '-' + residentStrides[id as keyof typeof residentStrides] + '.webp';
}

export function peerStandingKind(name: string, kind: string) {
    if ((kind === 'starter-one' || kind === 'starter-two') && residentStrideFile(name)) {
        return 'cinderhold-' + name.trim().toLowerCase();
    }
    return kind;
}

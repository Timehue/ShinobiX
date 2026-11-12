import catalog from './cinderhold-world-models.json';

const models = new Map(catalog.map(({ id, avatar, assetId, version }) =>
    [id, { avatar, model: { assetId, version } }] as const));

/** Resolve only a server-authored roster entry, including its portrait binding. */
export function cinderholdWorldModel(id: string, avatar: string) {
    const entry = models.get(id);
    return entry?.avatar === avatar ? { ...entry.model } : undefined;
}

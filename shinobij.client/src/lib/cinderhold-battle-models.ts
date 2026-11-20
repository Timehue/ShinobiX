import catalog from '../../../shared/cinderhold-world-models.json' with { type: 'json' };

/** The asset id and revision have fixed lengths. The battle client needs only the roster id. */
export const cinderholdBattleModels: Readonly<Record<string, string>> = Object.fromEntries(
    catalog.map(({ id, assetId, version }) => [assetId + version, id]),
);

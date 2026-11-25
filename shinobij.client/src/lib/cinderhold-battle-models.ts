import catalog from '../../../shared/cinderhold-world-models.json' with { type: 'json' };

/** A saved battle can refer to an earlier map model for the same fighter. */
export const cinderholdBattleModels: Readonly<Record<string, string>> = Object.fromEntries(
    catalog.flatMap(entry => [entry, ...(entry.previousModels ?? [])].map(
        model => [model.assetId + model.version, entry.id],
    )),
);

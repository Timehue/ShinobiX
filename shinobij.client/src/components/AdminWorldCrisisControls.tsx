import { AdminWorldCrisisControlPanel, type AdminWorldCrisisConfig } from "./AdminWorldCrisisControlPanel";

const CONFIG: AdminWorldCrisisConfig = {
    endpoint: "/api/world-crisis",
    defaultTarget: 100,
    targetRange: [10, 500],
    title: "⚠ The Fourfold Breach",
    description: "Global level-37 awakening and Outskirts defense. Operator actions are audited. Combat contributions remain server-sealed.",
    loadingLabel: "Loading crisis state…",
    loadError: "Could not load crisis state.",
    actionError: "World crisis action failed.",
    armLabel: "Arm Level 37 Trigger",
    creditPlaceholder: "manual credit player (optional)",
    awakenedLabel: "Awakened by",
    panelColors: ["rgba(248,113,113,.5)", "linear-gradient(120deg,rgba(69,10,10,.25),rgba(15,23,42,.7))", "#fecaca"],
    confirm: {
        "awaken-now": "Awaken The Fourfold Breach globally now? This sends the World Herald announcement to every village.",
        resolve: "Resolve all four fronts immediately? This completes every village objective and announces the result.",
        "stand-down": "Stand down the armed trigger before it awakens?",
    },
};

export function AdminWorldCrisisControls({ adminPw }: { adminPw: string }) {
    return <AdminWorldCrisisControlPanel adminPw={adminPw} config={CONFIG} />;
}

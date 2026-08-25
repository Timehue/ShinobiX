import { AdminWorldCrisisControlPanel, type AdminWorldCrisisConfig } from "./AdminWorldCrisisControlPanel";

const CONFIG: AdminWorldCrisisConfig = {
    endpoint: "/api/world-crisis-80",
    defaultTarget: 180,
    targetRange: [20, 750],
    title: "◆ The Hollow Gate Reckoning",
    description: "Global level-80 awakening. Shinobi 1v3 and companion 3v3 wins share one sealed village ledger. Operator actions are audited.",
    loadingLabel: "Loading reckoning state…",
    loadError: "Could not load reckoning state.",
    actionError: "Level-80 reckoning action failed.",
    armLabel: "Arm Level 80 Trigger",
    creditPlaceholder: "first witness credit (optional)",
    awakenedLabel: "First witness",
    panelColors: ["rgba(167,139,250,.55)", "linear-gradient(120deg,rgba(46,16,101,.28),rgba(8,47,73,.72))", "#ddd6fe"],
    showOperationSplit: true,
    confirm: {
        "awaken-now": "Awaken The Hollow Gate Reckoning globally now? This calls every village to both defense fronts.",
        resolve: "Resolve all four witness-ledger fronts immediately? This completes both operation paths and sends the world result.",
        "stand-down": "Stand down the armed level-80 trigger before it awakens?",
    },
};

export function AdminWorldCrisis80Controls({ adminPw }: { adminPw: string }) {
    return <AdminWorldCrisisControlPanel adminPw={adminPw} config={CONFIG} />;
}

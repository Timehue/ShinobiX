# First Pact narrator and NPC portraits

The narrative pass correctly separated narrated actions from NPC speech, but used an `N` placeholder for the narrator in First Pact. The narrator artwork already existed at `shinobij.client/public/portraits/narrator.webp`; the new narration paths had not been connected to it.

`shinobij.client/src/screens/FirstPact.tsx` now uses that artwork for the Bell Quarter aftermath shown in the report, all other aftermath visits, appended companion narration, and observations inside rooms. Interior dialogue requires an image and its correct accessible description. NPC speech keeps the NPC's own portrait, and narrated actions switch to the narrator portrait.

The full First Pact cast was checked: 11 outdoor NPCs and six interior NPCs. Each resolves a distinct existing portrait for the intended identity. The labeled contact sheet was visually reviewed against the authored cast and source atlas descriptions. A roster-wide check in `first-pact-wiring.test.ts` now fails for missing, reused, or incorrectly assigned character portraits.

The broader bundled visual-novel inventory was also rebuilt: 341 event variants, 1,225 reachable pages, 330 referenced assets, and zero missing files. It includes 79 named NPC identities. Halden's rematch intentionally leaves his chair empty; its actor is explicitly hidden by the scene direction rather than displayed as an initial or an incorrect face. Existing tests for named actor identity, slot swaps, and shared artwork overrides passed. Private external creator scenes were not available for inspection.

Validation:

- 54 focused First Pact and shared artwork tests passed.
- Production build, distribution validation, generated story-content check, and size checks passed. Product JS/CSS is 8,623,259 bytes; no budget adjustment was made for this fix.
- Four production-client browser checks passed on desktop and phone. They cover decoded Isu and narrator images, the initial aftermath scene, the switch from Isu to narration during a return conversation, and progress after reload. The final screenshots were visually inspected at both sizes.

Evidence: [desktop aftermath](first-pact-portrait-evidence/narrator-desktop.png), [phone aftermath](first-pact-portrait-evidence/narrator-mobile.png), and [complete First Pact cast](first-pact-portrait-evidence/cast.png).

Local audit files and logs are under `.tmp/narrator-portrait/`. Changes have not been deployed.

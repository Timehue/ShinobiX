# Fight entry, presentation and return behavior — 2026-10-19

## Question and expected behavior

Do launch/recovery, combat presentation and post-fight screens agree with the
encounter the game actually starts and the outcome the server actually saves?
The expected flow admits one fight at a time, keeps unrelated story scenes out
of combat, displays the sealed opponent, waits for settlement before confirming
rewards, and returns to the appropriate game/recovery state.

## Observed behavior

- **Matches expected behavior:** delayed authoritative recovery defers an
  eligible interlude without consuming it. The scene becomes available after
  combat. Empty/failed recovery releases the story correctly, including retry.
- **Matches expected behavior:** ordinary enemy identity, level, portrait and
  difficulty survive reload and appear in the victory card and exported log.
  The final Kage displays its canonical portrait, Apex label and readable tell
  details on desktop and phone. Battle-log retention labels reflect the supplied
  round/event history.
- **Matches expected behavior:** C/B/A/S combat missions launch their authored
  opponent through the real Express handlers. The displayed abilities, status
  feedback and battlefield sprite agree with the sealed session.
- **Matches expected behavior:** group launch errors can be acknowledged or
  retried. A further click while the retry is delayed cannot start another fight.
  No battlefield or reward appears before the start response. Initial enemy HP
  matches the sealed actors. Headers do not show Battle Tower/Spire floor labels.
- **Matches expected behavior:** defeating an early group member cannot trigger
  settlement. After the last KO, a failed reward request exposes Retry. During a
  delayed retry, Continue is unavailable and no reward is confirmed early.
  Settlement succeeds once; Continue removes the battlefield and releases the
  host. These checks cover nine enemies, thirteen enemies, a quest group and a
  village patrol at desktop and phone widths, with zero Tower API requests.
- **Matches expected behavior:** real world knockouts show zero HP, no win
  reward and the Hospital destination. Paid recovery, recovery after a failed
  terminal-outcome request and the insufficient-money/free-recovery path retain
  the correct saved state through reload. Both desktop and phone passed.
- **Validation gap closed:** standalone group/twin fixtures now mount
  `GameAlertHost`, matching the real App. Previously they mounted only the
  confirmation host, so the new launch-error audit could not observe the queued
  in-game alert. No production component or gameplay rule needed changing.

## Evidence and verification

- Existing mounted-App browser checks: **17 passed, 3 intentionally skipped**
  (the recovery-story cases explicitly run on desktop), in
  `.tmp/final-fight-behavior-browser.log`.
- Real Express browser journeys: **14 passed**, in
  `.tmp/final-fight-behavior-live.log`.
- New `shinobij.client/scripts/qa-fight-transitions.mts`: **8 passed**, with
  saved case results and entry/saving screenshots in
  `shinobij.client/test-results/fight-transitions/`.
- **39 passing browser cases, zero failures.** The changed script and fixtures
  passed ESLint. Representative phone Kage details, a group saving-reward screen
  and a real defeat/Hospital handoff were visually inspected.

The mounted-App tests are `authoritative-resume-story.spec.ts`,
`progressive-pve-presentation.spec.ts` and `mission-outpost-journey.spec.ts`.
Live journeys use `authored-missions-express.spec.ts` and selected
`first-defeat-recovery-express.spec.ts` cases: paid, terminal-retry and poor.

The transition fixture uses actual builders, hosts, actor resolution and proof
validation, with controlled start/settlement delays and failures. Controlled
last hits isolate presentation and lifecycle behavior; they do not measure
balance. The real Express journeys do not fabricate combat, healing or wallet
settlement responses. The previous full-suite result remains **16,193 passed,
28 skipped, zero failures/cancellations**; no game code changed in this pass.

This is local engineering evidence, not a production-account playthrough or a
claim to have replayed every story branch. It does not change project KB state.

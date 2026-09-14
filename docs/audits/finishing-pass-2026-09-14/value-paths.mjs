// Audit inventory only. Inherited family evidence is not an endpoint certificate.
import fs from 'node:fs';
const here = new URL('./', import.meta.url);
const read = n => JSON.parse(fs.readFileSync(new URL(n, here), 'utf8'));
const write = (n,v) => fs.writeFileSync(new URL(n,here), JSON.stringify(v,null,2)+'\n');
const candidates = read('valuable-mutation-discovery.json');
const routes = read('mounted-routes.json');
const tests = read('test-evidence-index.json');
const U = 'UNRESOLVED — do not infer safety from a family helper or test filename';
const fields = ['activitySource','actorBinding','activityBinding','amountAuthority','clientTrustedFields','eligibilityProof','expiry','singleUseReplayProtection','atomicBoundary','durableReceipt','retrySemantics','partialFailureRecovery','adminSearchability','tests','featureKillSwitch'];
const groups = [];
function group(id, pattern, detail) {
  groups.push({ id, pattern, detail: Object.fromEntries(fields.map(f => [f,detail[f] ?? U])) });
}
group('mission-and-solo-pve', /api\/(missions|pve|solo-pve)\//, {
  activitySource:'Missions E/D and C/B/A/S, field/hunt trails, raids/expeditions, canonical AI, creator practice, wandering/world AI. Purses and secondary progress are separately gated.',
  actorBinding:'Authenticated player; sealed Solo participant owner slug. Missing/foreign terminal cannot pay or hospitalize the caller.',
  activityBinding:'Server-issued mission/run/token, accepted mission state, exact terminal context; usage evidence must match server terminal itemsUsed.',
  amountAuthority:'Canonical mission/AI/raid catalogs; no client amount/outcome. C1 repairs the existing Scholars +5% mirror. Combat claims remain ryo-only; field/hunt growth stays distinct.',
  clientTrustedFields:'Requested mission/action IDs and input commands; claimed values and outcome are not evidence. Legacy compatibility must be assessed per endpoint.',
  eligibilityProof:'Accepted field/hunt progress or server terminal Solo/raid context; bound opponent and caller.',
  expiry:'Solo active row retention 30 min, terminal 7 days; claim/token deadlines differ by catalog and remain sealed. TTL is not the gameplay turn clock.',
  singleUseReplayProtection:'Mission reservation/saved claim receipts; physical outcomes plus costs and receipt in mutatePlayerSave. Failed save before receipt may retry; no terminal means no payout.',
  atomicBoundary:'Per-player save mutation for purse/claim or vitals/items; separate clan/Legacy projections require their own receipt.',
  durableReceipt:'Player redemption/settlement ledgers, Solo terminal evidence, pve-outcome projection; consult exact path for retention.',
  retrySemantics:'Same mission/run identity replays or resumes sealed work. Later live balance/equipment must not recalculate a committed reward.',
  partialFailureRecovery:'Covered for mission sagas and Solo outcome writes by existing tests; secondary projections and proofs beyond retention are not universally certified.',
  adminSearchability:'No universal player+activity lookup. Source-specific records/manual operator correlation.',
  featureKillSwitch:'Runtime capabilities/mission/AI gates and read-only launch flags; do not enable an unsafe source.'
});
group('pvp-ranked-and-vitals', /api\/pvp\//, {
  activitySource:'Ordinary/ranked PvP, bounties, guard/Kage/war bindings; ranked pet queue is an admission path with its own engine.',
  actorBinding:'Authenticated session participant. Canonical snapshots and reward fingerprints bind actor/outcome and session generation.',
  activityBinding:'Battle ID + immutable terminal deadline, sealed reward kind/location, server result; Kage seat and war require exact parent identity.',
  amountAuthority:'Server tables/rating math/anti-farm rules. Do not interpret replayed browser UI or claimed winner as authority.',
  clientTrustedFields:'Inputs/desired opponent/queue choice only after validation; base reward flag/sector 99 are server verified.',
  eligibilityProof:'Terminal winner/loser and sanctioned PvP generation; no-save NPC cannot mint non-admin base rewards.',
  expiry:'Current versioned terminal recovery survives the old two-hour live-row window; bounded absolute deadline and 90-day history are distinct.',
  singleUseReplayProtection:'Per-save durable PvP ledger/fingerprint and server-credit-before-browser-ACK barrier. Independent receipt per fighter/rating/consumable kind.',
  atomicBoundary:'Save+credit+receipt atomic per fighter; two fighters are a recoverable sequence, not one database transaction.',
  durableReceipt:'Dedicated PvP ledger, terminal recovery snapshots/discovery pointers, completed browser receipt, battle history.',
  retrySemantics:'Recover canonical terminal after live row expiry; browser ACK cannot outrun server credits.',
  partialFailureRecovery:'Existing behavioral tests cover before/after save, journal ACK loss, secondary saga failure, ring churn and completion retry. Real store/process certification remains pending.',
  adminSearchability:'Full-admin Battle Receipts accepts battleId; player/time/source unified search absent.',
  featureKillSwitch:'PvP/ranked capability gates and release flags; current load/deployment semantics remain unchanged.'
});
group('tower-and-spire', /api\/towers\//, {
  activitySource:'Battle Towers, party floors, Endless Spire, Tower PvP and parent-hosted 2v2/Clan Boss/sector war.',
  actorBinding:'Server run participants/human actor ownership; parent-hosted games require parent eligibility.',
  activityBinding:'Run/floor/weekly tier and server terminal objective; nine objective types must not share a guessed win rule.',
  amountAuthority:'Server floor catalog, first-clear reward, capped assist and weekly-best rules.',
  clientTrustedFields:'Turn choices and requested floor; never client reward or result.',
  eligibilityProof:'Canonical run terminal and participation, first-clear or week-tier state.',
  singleUseReplayProtection:'Per-run spend markers plus first-clear/weekly claimed state inside the player save.',
  atomicBoundary:'Player consumables and receipt in one write even on loss; payout per save. Parent resources are separately settled.',
  durableReceipt:'Tower run state + player tower/spire/spend records.',
  retrySemantics:'Run-specific settle retries must reuse actor/run; weekly best does not imply every clear pays.',
  partialFailureRecovery:'Existing run/spend tests; multi-parent crash matrix is not fully certified.',
  adminSearchability:'Source-specific storage, no unified Tower player/run console.',
  featureKillSwitch:'Tower capabilities and parent mode flags.'
});
group('hollow-gate', /api\/hollow-gate\//, {
  activitySource:'Run admission, floors/steps/augments/events, shinobi/pet children, consume, key forging, locked door and final settle.',
  actorBinding:'Authenticated parent owner; child player/token/run/node/floor/kind/enemy must all agree.',
  activityBinding:'Server run token + node encounter key + sealed engine proof; pending encounter blocks walking past it.',
  amountAuthority:'Server run loot/reward table and child outcome, pet replay evidence; client tokens do not choose value.',
  clientTrustedFields:'Commands/selected valid augment/action transcript, independently validated. Client result is insufficient.',
  eligibilityProof:'Exact child terminal and versioned paid combat receipt; final ledger belongs to this parent run.',
  expiry:'Run and child absolute validity checked separately; final redeemed run history bounded100. Expired/abandoned disposition remains parent-owned.',
  singleUseReplayProtection:'Combat binding+paid receipt; final redeemedHollowGateRuns in save before consuming token; Legacy/era use their own receipt.',
  atomicBoundary:'Final payout and redeemed run co-written in player save; token consumption and sidecars happen separately with retry markers.',
  durableReceipt:'Version2 combat receipt, parent ledger, redeemed runs, separately deduped Legacy/era.',
  retrySemantics:'Same child/run is harmless replay; missing/consumed parent returns current state without invented rewards.',
  partialFailureRecovery:'Linkage and reconnect suites cover exact bindings and one-shot settle. Real restart/storage/lost-response drill still required.',
  adminSearchability:'Battle Receipts can resolve hgcombat-<32hex>; end-to-end player/run search remains incomplete.',
  featureKillSwitch:'Hollow Gate capabilities and pet-child owner decision retained.'
});
group('story-events-and-creator', /api\/(story|events)\//, {
  activitySource:'Canonical story bosses/Academy, road/interlude records and built-in Aura Sphere. Authored presentation is not a generic purse.',
  actorBinding:'Authenticated save owner and exact story/run/event.',
  activityBinding:'Next canonical milestone/opponent or valid road node/choice; built-in event ID only.',
  amountAuthority:'Hard-coded server milestone rewards; level9 Aura Sphere defined in _claim. Arbitrary authored event ID returns event-has-no-server-reward.',
  clientTrustedFields:'Choice from canonical allowed options; client reward amount/forged node cannot create entitlement.',
  eligibilityProof:'Required level, exact next story milestone/terminal, one-time redemption or valid narrative progression.',
  singleUseReplayProtection:'Milestone redemption and granted title/key/card co-written in save; event claim checks existing ownership + latch.',
  atomicBoundary:'mutatePlayerSave; capacity refusal occurs before one-time event latch.',
  durableReceipt:'Story/event redemption state and canonical Chronicle grant.',
  retrySemantics:'Same valid claim returns already completed; generic save cannot advance story or forge ledger.',
  partialFailureRecovery:'Story handler retry/wrong-account and canonical settle tests; edited/disabled authored content lifecycle still requires owner live verification.',
  adminSearchability:'Story/event save records; no general reward lookup.',
  featureKillSwitch:'Creator approval/publish and runtime capabilities unchanged; unsafe authored grants must remain disabled.'
});
group('bosses-and-endless', /api\/(clan-boss|weekly-boss|endless|dungeon)(\/|\.ts)/, {
  activitySource:'Weekly boss, Clan Boss Operations/party, Endless Tower waves/cash-out, Dungeon Warden/cards/pets.',
  actorBinding:'Authenticated owner or sealed party participant/clan; terminal engine identity belongs to parent.',
  activityBinding:'Spawn/reset generation, operation or run/wave token, exact eligible participant; not a free-form report.',
  amountAuthority:'Server boss/run reward catalogs and participation/damage rules.',
  clientTrustedFields:'Action transcript/choices after engine validation; amounts/outcomes ignored.',
  eligibilityProof:'Authoritative terminal session and parent linkage; weekly claimed state/generation.',
  singleUseReplayProtection:'Per-player weekly/run/operation ledgers; Endless redeemed action ring128; costs sealed by child engine.',
  atomicBoundary:'Player reward+receipt same save; boss shared damage/party totals separate. Inspect per-operation recovery ordering.',
  durableReceipt:'Saved redeemed wave/operation/weekly state and server run proof.',
  retrySemantics:'Same token/wave/weekly identity does not create another purse; abandon differs from cash-out.',
  partialFailureRecovery:'Covered by existing operation tests; #15 requires human staging certification including multi-player reconnect and weekly payout.',
  adminSearchability:'Clan Boss Operations panel and specific boss records; not one player/activity search.',
  featureKillSwitch:'Unsafe boss flags remain off until certified; record target flags before live work.'
});
group('pet-combat', /api\/(pet\/(battle-|warfront-|ranked-|gauntlet|showdown)|_pet-|pet-ladder|arena\/|first-pact\/)/, {
  activitySource:'Showdown/Coliseum, Ladder, Warfront/Rite, Gauntlet, First Pact, cinematic live/compatibility.',
  actorBinding:'Owned pet roster or exact live participants; legacy ranked compatibility is not equivalent to the authoritative engines.',
  activityBinding:'Server seed, sealed roster, run/request/session ID and engine-specific terminal/replay proof.',
  amountAuthority:'Canonical pet catalogs and completion rules; live cinematic Arena is memory-only with no payout.',
  clientTrustedFields:'Legal inputs/replay transcript, validated by the correct engine. Registry flags legacy ranked compatibility as an unresolved defect.',
  eligibilityProof:'Per-mode admission, owned pets, valid terminal or deterministic replay, participation limits.',
  singleUseReplayProtection:'Mode-specific run/request receipt; retired AI/Tactical admissions cannot issue fresh reward proofs.',
  atomicBoundary:'Player progression+receipt for paid paths; shared ladders/war parents separately recorded.',
  durableReceipt:'Engine-specific saved receipt/run; no claim that transient live Arena memory is a durable economic record.',
  retrySemantics:'Preserve issued-token compatibility separately from fresh admissions. Reconnect presentation alone cannot prove reward.',
  partialFailureRecovery:'Mode-specific tests; every legacy compatibility crash case is not established.',
  adminSearchability:'Per-mode storage, no universal pet activity search.',
  featureKillSwitch:'Current capability registry retains retired modes and owner decisions; do not reopen them.'
});
group('pet-progression-and-custody', /api\/pet\//, {
  activitySource:'Training/care, encounter/befriend/starter, breeding/hatch, evolution, sanctuary custody.',
  actorBinding:'Authenticated pet owner; server reads roster and parent eligibility.',
  activityBinding:'Pet IDs + sealed timer/breeding request/encounter identity and one-time starter latch.',
  amountAuthority:'Server duration/XP, costs, offspring/trait/palette roll and deterministic hatch from sealed outcome. C2: Den/Yard bonus missing.',
  clientTrustedFields:'Selected owned pets/action/duration from allowed catalog; cannot choose sealed offspring or XP.',
  eligibilityProof:'Ownership, funds, capacity, valid completed timer or encounter proof.',
  singleUseReplayProtection:'Saved timers/once state/request fingerprint; hatching uses sealed result, not a new roll.',
  atomicBoundary:'Player save for most training/breeding changes; cross-owner sanctuary separately locked.',
  durableReceipt:'Breeding/training state and versioned player save; not a universal searchable receipt.',
  retrySemantics:'Finished training clears explicit timer fields; legacy sealed training keeps original amount.',
  partialFailureRecovery:'Breeding ACK/replay tests exist; all cross-owner interruptions not certified here.',
  adminSearchability:'Player pet state and source-specific logs.',
  featureKillSwitch:'Pet capability/admission flags.'
});
group('chronicle', /api\/card-clash\//, {
  activitySource:'PvP free play, AI, Echoes, progression/starter grants and pack purchases.',
  actorBinding:'Authenticated match participant or collection owner.',
  activityBinding:'Server match ID/AI terminal, canonical story/Legacy record; no client-selected progression card entitlement.',
  amountAuthority:'Server pack/currency/reward/card catalogs; collection caps and once records.',
  clientTrustedFields:'Legal board move, deck choice from owned collection, allowed pack ID. Sync accepts no grant IDs.',
  eligibilityProof:'Chronicle unlock, canonical match/story/Legacy state, inventory/currency capacity.',
  singleUseReplayProtection:'Saved progression card identifiers and match completion; free-play Legacy outbox dedupes by match/pair.',
  atomicBoundary:'Collection grant+receipt in save; pair-history and Legacy delivery are separate retryable steps.',
  durableReceipt:'Collection/progression redemption and match Legacy outbox.',
  retrySemantics:'sync-progression performs no save write when already repaired; no unnecessary save-version conflict. Reciprocal farming remains progression-neutral.',
  partialFailureRecovery:'Free-play Legacy repair handles pending outbox; pack purchase retry/limits require path-specific record.',
  adminSearchability:'Source-specific match/save records.',
  featureKillSwitch:'Chronicle unlock/capabilities and parent war/dungeon flags.'
});
group('clan-mission', /api\/clan\/(mission\/|_mission-catalog)/, {
  activitySource:'Eight weekly missions; clan XP/treasury plus personal Clan Points.', actorBinding:'Authenticated clan member (admin exemption preserved).', activityBinding:'Clan slug + ISO week + mission key.', amountAuthority:'Canonical progress targets/rewards and member-count XP scaling.', clientTrustedFields:'Requested clan/mission, never progress/amount.', eligibilityProof:'Canonical clan contribution/territory state meets target.', expiry:'Committed latch10days; pending receipt has no expiry.', singleUseReplayProtection:'NX economic receipt + clan lock; C3 proves pending is later interpreted as replay even if no credit.', atomicBoundary:'Shared clan credit and economic receipt are separate writes; personal points separate again.', durableReceipt:'clan:mission-claimed:<clan>:<week>:<mission>, listing/audit projections.', retrySemantics:'C3: after injected pre-credit failure, retry200 reports claimed while treasury remains1000 and clanXP0.', partialFailureRecovery:'STILL PRESENT: uncertainty is blocked from a second payout, but no durable atomic credit proof exists for recovery.', adminSearchability:'Manual mission receipt/clan/audit correlation.', featureKillSwitch:'No newly added switch; owner must determine release containment.'
});
group('clan-exchange', /api\/clan\/(exchange\/|_exchange)/, {
  activitySource:'Personal Clan Points → catalog currency/items/caches/cosmetics or clan War Supply.', actorBinding:'Authenticated member; requested clan must match stored clan.', activityBinding:'Catalog item + weekly/monthly/oneTime purchase counters, not a request nonce.', amountAuthority:'Server Exchange table, hall level, limits and costs.', clientTrustedFields:'Item ID/clan choice after validation.', eligibilityProof:'Points, hall level, membership, capacity before commitment.', singleUseReplayProtection:'Saved spend+purchase counter+personal grant atomically; limited repeated purchases can be legitimate new buys.', atomicBoundary:'War Supply: clan lock then player lock, player spend first then clan write.', durableReceipt:'Player purchase counters, 90day audit; LOSS log is best effort.', retrySemantics:'C4: treasury write succeeds then throws; handler refunds points and purchase limit. Probe: WarSupply10→1510, ClanPoints stays4000.', partialFailureRecovery:'STILL PRESENT: blind refund treats an ambiguous acknowledgement as failed credit; retry can repeat an unpaid grant.', adminSearchability:'Manual audit:clan-exchange and LOSS records; no unified query.', featureKillSwitch:'No new gate introduced; owner containment decision required.'
});
group('clan-and-village-treasury-transfers', /api\/(clan|village)\/treasury\/transfer|api\/_cross-key-settlement/, {
  activitySource:'Leadership currency/items to an eligible member.', actorBinding:'Existing leadership/recipient membership validated under both locks before first debit. C5 FIXED: clan source debit receipts are now pinned to server state by the clan-save validator.', activityBinding:'requestId or deterministic payload fallback + source/recipient/resource/amount fingerprint.', amountAuthority:'Requested transfer amount bounded by server balance, caps, tax and existing outbound rules.', clientTrustedFields:'Recipient and amount are requests, independently validated. Client must not author source debit proof.', eligibilityProof:'Locked source+recipient, membership, capacity, permitted currency, existing IP/trust rules.', expiry:'Durable journal90days; source receipts100 and player receipt window bounded.', singleUseReplayProtection:'Cross-key durable transaction + source debit receipt + recipient save receipt.', atomicBoundary:'Lexically ordered source/player locks; each side write carries its receipt; not a cross-row DB transaction.', durableReceipt:'settlement:transaction plus both applied-side records.', retrySemantics:'Retry resumes after debit without revalidating eligibility that was already authorized. Identical legacy payload without requestId is treated as retry for90days, even a genuinely new identical gift.', partialFailureRecovery:'Existing handler tests cover recipient write/journal failures; C5 field guard is fixed; full recovery beyond the existing retention window still needs certification.', adminSearchability:'Economy Settlements list state/limit; no exact player/activity/transaction filter.', featureKillSwitch:'Existing transfer controls remain; no auth/rate/IP changes in this pass.'
});
group('direct-trade', /api\/player\/(trade|_trade|_transfer)/, {
  activitySource:'Direct player currency transfer.', actorBinding:'Authenticated sender + validated recipient.', activityBinding:'Required nonce and target/currency/amount fingerprint.', amountAuthority:'Server balance, caps, fees/budgets; amount is a bounded request.', clientTrustedFields:'Requested recipient/currency/amount, validated; nonce cannot rebind payload.', eligibilityProof:'Both locked balances/eligibility and existing trust/IP controls.', singleUseReplayProtection:'Nonce reservation rechecked under both player locks.', atomicBoundary:'Two player locks, per-side writes; nonce precedes debit.', durableReceipt:'Transfer nonce result and economy transaction journal.', retrySemantics:'Concurrent same nonce once; payload conflict refuses; known pre-debit failure can clear reservation safely.', partialFailureRecovery:'Ambiguous post-debit states remain reconciliation, not assumed refunded. No automatic global repair claim.', adminSearchability:'Economy logs/journal manual linkage.', featureKillSwitch:'ALLOW_NONCELESS_TRANSFERS must stay off for replay guarantees.'
});
group('clan-other-and-territory', /api\/clan\//, {
  activitySource:'Donations, territory supply/scrolls, upgrades, seal pool, mentor rewards, custody escorts, war control.', actorBinding:'Existing membership/leadership/mentor/owner validation per endpoint.', activityBinding:'Donation journal, sector/war/mentor milestone or catalog upgrade; not all paths accept request nonce.', amountAuthority:'Server donation caps/upgrades/territory/war/mentor catalogs.', clientTrustedFields:'Requested bounded spend/target/action; canonical entitlement required.', atomicBoundary:'Shared clan/sector/member locks; donations and sector collection span multiple writes.', durableReceipt:'Mixture of economy transaction journal, economic receipt, war/mentor/milestone records.', retrySemantics:'Donation random txId means repeated request can be a new donation. Upgrade repeat may buy next level; not universally exactly-once.', partialFailureRecovery:'Donation needs-reconcile; collection resets sectors before later clan credit. Process-boundary recovery not universally proven.', adminSearchability:'Source-specific audit, recent economy transaction list; no unified player/activity search.', featureKillSwitch:'War and operation flags; territory release freeze/owner rules retained.'
});
group('village-war-and-sector-control', /api\/(village|village-guard|war|world-crisis|sector\/)/, {
  activitySource:'Treasury donations, upgrades, orders/agendas, map control, guard/mercenary/Anbu, sector PvP/cards/pets, quests/gifts/crises, war crates.', actorBinding:'Authenticated role/member/participant and canonical position/sector.', activityBinding:'Exact war/sector/encounter/quest generation; issued proof cannot be borrowed from another engine.', amountAuthority:'Server sector/war/quest/catalog amounts and treasury balances.', clientTrustedFields:'Selected valid action/sector/choice; client declaration of victory/ownership is insufficient.', eligibilityProof:'Per-source server record, timing, location, participant and terminal proof.', atomicBoundary:'Per-sector/shared state and per-player mutations; cross-key award/control consequences need individual receipts.', durableReceipt:'War/crate/redemption records and shared sector state; varies by source.', retrySemantics:'Mode-specific settlement; no broad cross-engine replay assurance.', partialFailureRecovery:'Controlled staffed war and human store/reconnect certification required (#9); unresolved per-path crash boundaries remain visible.', adminSearchability:'Source-specific storage/admin war views.', featureKillSwitch:'Existing war/crisis/creator flags unchanged; staged activation only.'
});
group('training-jutsu-profession', /api\/(training|jutsu|profession|hunter|exams)(\/|\.ts)|api\/_training|api\/_xp-engine/, {
  activitySource:'Stat training, jutsu timers/seal/ryo acceleration, profession choice/mastery and rank/exam grants.', actorBinding:'Authenticated save owner and canonical owned jutsu/profession.', activityBinding:'Sealed session/request or exact rank entitlement.', amountAuthority:'Server duration/cost/growth/rank tables; shinobi XP retired and level derived from earned stats.', clientTrustedFields:'Allowed action/target/duration selections, not credited stats or completion timestamp.', eligibilityProof:'Server timer and saved investment/level/preconditions.', singleUseReplayProtection:'Saved training state/request and same-save grant; capstone/rank entitlement prevents repeated grants.', atomicBoundary:'Player save mutation; serialized start/complete CAS tests.', durableReceipt:'Training/jutsu saved completion/redemption state.', retrySemantics:'Reuses sealed state; no current equipment recalculation on completed training.', partialFailureRecovery:'Existing authority and start/complete CAS tests; rollback old timers must be certified.', adminSearchability:'Player state plus source logs.', featureKillSwitch:'Existing activity capabilities; no progression changes.'
});
group('shops-crafting-inventory-premium', /api\/(shop|inventory|weapon|craft|aura|awakening|bloodlines|tebex|festival|bank|profile)(\/|\.ts)|api\/player\/(heal|cafeteria|daily-login|stat-respec)/, {
  activitySource:'Catalog buy/sell, forge/core/aura/awakening, crates, consumables, bank, premium webhook, festival stores and profile spending.', actorBinding:'Authenticated inventory/balance owner; Tebex signature/package/account binding is a separate privileged grant.', activityBinding:'Catalog/request/purchase/receipt/day/window identity where present; not all spends are idempotent.', amountAuthority:'Server catalog prices, eligible inventory and bank/claim/payment tables.', clientTrustedFields:'Selected ID/count/amount bounded by current state; webhook payload must be independently verified.', eligibilityProof:'Ownership/balance/capacity/unlock and source-specific proof.', atomicBoundary:'Usually player save mutation; premium external transaction and bank interest/day receipts are separate sources.', durableReceipt:'Catalog request receipts/redemption fields or payment IDs; audit each retention before claiming universal recovery.', retrySemantics:'A repeated buy/sell may be a second legitimate transaction; absence of nonce is flagged, not silently deduplicated.', partialFailureRecovery:'Local source tests reused; live premium webhook replay and lost acknowledgements require safe-target certification.', adminSearchability:'Economy/payment/audit source-specific; no universal query.', featureKillSwitch:'Catalog availability, premium/payment release configuration and existing flags.'
});
group('legacy-achievements-and-dojo', /api\/(legacy|achievements|dojo-circuit|hall-of-legends)(\/|\.ts)|api\/_legacy/, {
  activitySource:'Legacy stats/evaluation, Sage/trial/title/card/achievement rewards, Dojo optional event seals.', actorBinding:'Authenticated player; host-supplied progress and anti-farm target binding.', activityBinding:'Milestone/receipt/match/event and exact discipline/time window.', amountAuthority:'Server milestone/grant catalogs; Dojo is recognition, not a currency faucet.', clientTrustedFields:'Choice/claim request; lifetime counters from client are not completion proof.', eligibilityProof:'Stored canonical progress or host-verified terminal; paused Dojo clears attempts.', singleUseReplayProtection:'Milestone redemptions and per-source receipt IDs; host outboxes recover applicable delivery.', atomicBoundary:'Per-player Legacy/save and shared event locks; separate caches/projections.', durableReceipt:'Legacy receipt and saved entitled grant records; Dojo event/attempt.', retrySemantics:'Same record/milestone does not create a second reward; historical repair derives from server state.', partialFailureRecovery:'Per-source tests; sidecar outage/restart must be tested for each producer.', adminSearchability:'Legacy admin tools plus source receipts; no common activity query.', featureKillSwitch:'legacyEnabled and Dojo enabled flag; do not add mandatory progression.'
});
group('save-sanitization-and-world', /api\/(save\/|world\/|player\/|_)/, {
  activitySource:'Generic saves, stat/profile/travel/claim helpers and shared economic primitives. Syntactic candidates include projections and pure calculation.', actorBinding:'Per-route authenticated actor and save-version ownership; shared helpers require caller validation.', activityBinding:'Caller-supplied request becomes authority only through its owning route.', amountAuthority:'Generic player save preserves server-owned value/progression and version; C5 now also pins existing clan treasury debit receipts to stored server state.', clientTrustedFields:'Allowed customization/action fields only, not protected currencies/progression.', atomicBoundary:'mutatePlayerSave and current store CAS/locks; helper presence alone does not prove caller safety.', durableReceipt:'Shared helpers provide optional receipts; row listing must be read with actual callsite.', partialFailureRecovery:'UNRESOLVED at unreviewed callsites; fail-closed receipt helpers block duplicate grants but can strand value.', adminSearchability:'Source namespaces or existing diagnostics; no uniform lookup.', featureKillSwitch:'Existing server/storage capabilities unchanged.'
});
group('admin-ops-cron', /api\/(admin|cron|kv|game-state|ranked-season)/, {
  activitySource:'Privileged grants/resets/reconcile, scheduled season rewards/expiry/maintenance/backups, admin content publishing.', actorBinding:'Existing full/content/cron-specific authentication; not modified.', activityBinding:'Admin action/season/job lease/target player and retained audit identity.', amountAuthority:'Privileged authorized operator/server scheduled logic; a server route is not itself proof of correct role.', clientTrustedFields:'Privileged edits have intentionally broader authority than ordinary player claims.', atomicBoundary:'Per-job lease plus per-save/write receipts varies by job.', durableReceipt:'Audit logs/snapshots/season claims/jobs; backup is not a settlement receipt.', partialFailureRecovery:'HUMAN CERTIFICATION REQUIRED: two admin roles, one job owner, duplicate scheduler prevention, restart, backup+restore and rollback.', adminSearchability:'Existing admin surfaces; unified receipt search incomplete.', featureKillSwitch:'DISABLE_SCHEDULED_JOBS and existing cron/release flags; no changes.'
});
// More-specific operation families are intentionally matched first.
const priority = ['clan-mission','clan-exchange','clan-and-village-treasury-transfers','direct-trade','admin-ops-cron'];
groups.sort((a,b)=>(priority.indexOf(a.id)<0?99:priority.indexOf(a.id))-(priority.indexOf(b.id)<0?99:priority.indexOf(b.id)));
for (const g of groups) {
  g.testFiles = tests.filter(t=>g.pattern.test(t.file)).map(t=>t.file);
  g.detail.tests = { source: 'test-evidence-index.json', files:g.testFiles, limitation:'Existing tests are reused; file membership is not proof every adversarial case is covered. See adversarial-matrix.json.' };
}
const sourceFiles = [...new Set([...candidates.map(c=>c.file),...routes.map(r=>r.file).filter(Boolean)])].sort();
const rows = sourceFiles.map(file=>{
  const g=groups.find(g=>g.pattern.test(file));
  return {file,endpoints:routes.filter(r=>r.file===file).map(r=>`/api${r.route}`), family:g?.id??'unclassified', discovery:candidates.find(c=>c.file===file)?.candidateEvidence??[], reviewStatus:g?'FAMILY EVIDENCE — consult the exact source; unproven fields remain unresolved':'UNRESOLVED — route may be non-mutating; no grant assumed', ...(g?.detail??Object.fromEntries(fields.map(f=>[f,U])))};
});
write('value-path-registry.json',{auditedCommit:'ecd8d6ccaba017a6791ec0ec94f822c10658984d',scope:'All mounted routes and syntactically discovered API value mutations. Every row has the required fields. Family evidence is explicitly distinguished from an individual endpoint certificate; computed/dynamic writes, socket-only handlers, schedules and legacy compatibility require callsite review. This is a risk inventory, not a claim every path is crash-safe.',families:groups.map(({id,detail})=>({id,...detail})),rows});
const cases = ['normal success','exact retry','simultaneous duplicate','wrong player','wrong activity/run/battle','stale proof','expired proof','forged amount','forged outcome','response lost after commit','server/process interruption','partial settlement','reconnect','repeat claim after success'];
const evidence = {
 'mission-and-solo-pve':{'normal success':['mission-combat-claim-saga.test.ts','pays once'], 'exact retry':['mission-combat-claim-saga.test.ts','a lost HTTP response'], 'wrong activity/run/battle':['mission-combat-claim-saga.test.ts','old run token can only replay'], 'stale proof':['mission-combat-claim-saga.test.ts','non-null mismatched'], 'expired proof':['mission-combat-claim-saga.test.ts','bounds only expired history'], 'response lost after commit':['mission-combat-claim-saga.test.ts','recovers commit-then-throw'], 'server/process interruption':['mission-combat-claim-saga.test.ts','pre-save crash'], 'partial settlement':['mission-combat-claim-saga.test.ts','helps Legacy counters forward'], reconnect:['queue-combat-claim.test.ts','lost queue response'], 'repeat claim after success':['mission-combat-claim-saga.test.ts','without replaying any payout']},
 'pvp-ranked-and-vitals':{'normal success':['_reward-settlement.test.ts','credits exactly once'], 'exact retry':['_reward-settlement.test.ts','credits exactly once'], 'wrong activity/run/battle':['_reward-completion.test.ts','one session generation'], 'stale proof':['_reward-recovery.test.ts','absolute terminal deadline'], 'response lost after commit':['_reward-completion.test.ts','lost claim response'], 'server/process interruption':['_reward-settlement.test.ts','crash AFTER'], 'partial settlement':['_reward-completion-handler.test.ts','transient Vanguard'], reconnect:['_reward-recovery.test.ts','live row is deleted'], 'repeat claim after success':['_reward-settlement.test.ts','credits exactly once']},
 'hollow-gate':{'normal success':['_combat-session.test.ts','settle once'], 'exact retry':['_combat-session.test.ts','settle once'], 'wrong player':['_combat-session.test.ts','exact terminal Solo'], 'wrong activity/run/battle':['_combat-session.test.ts','exact terminal Solo'], 'forged outcome':['_combat-session.test.ts','exact terminal Solo'], 'repeat claim after success':['_combat-session.test.ts','settle once']},
 'story-events-and-creator':{'normal success':['settle-handler.test.ts','grants one authoritative'], 'exact retry':['settle-handler.test.ts','replays exactly once'], 'wrong player':['settle-handler.test.ts','another account'], 'wrong activity/run/battle':['_settle.test.ts','skipped, mismatched'], 'forged amount':['_claim.test.ts','user-authored reward'], 'repeat claim after success':['_settle.test.ts','one-shot on replay']},
 'direct-trade':{'normal success':['trade.test.ts','two concurrent'], 'exact retry':['trade.test.ts','replay of the committed'], 'simultaneous duplicate':['trade.test.ts','two concurrent'], 'wrong activity/run/battle':['trade.test.ts','different payload'], 'response lost after commit':['trade.test.ts','replay of the committed'], 'server/process interruption':['trade.test.ts','pre-debit write failure'], 'repeat claim after success':['trade.test.ts','replay of the committed']},
 'clan-and-village-treasury-transfers':{'normal success':['clan/treasury/transfer.test.ts','exactly once on replay'], 'exact retry':['clan/treasury/transfer.test.ts','exactly once on replay'], 'simultaneous duplicate':['_cross-key-settlement.test.ts','serializes concurrent'], 'response lost after commit':['clan/treasury/transfer.test.ts','completion journal write fails'], 'partial settlement':['clan/treasury/transfer.test.ts','recipient persistence fails'], 'repeat claim after success':['clan/treasury/transfer.test.ts','exactly once on replay']}
};
const failures = {'clan-mission':{'server/process interruption':'C3: injected failure before clan credit, expired pending receipt replays as success without credit','partial settlement':'C3: personal points granted on retry while shared treasury/XP remain unpaid'}, 'clan-exchange':{'response lost after commit':'C4: treasury credit persisted, points and limit refunded','partial settlement':'C4: WarSupply1500 granted at zero net points cost'},'clan-and-village-treasury-transfers':{'forged outcome':'C5 FIXED: the new clan receipt tests reject forged/cleared source proof; before/after evidence retained'}};
write('adversarial-matrix.json',{interpretation:'Every reviewed high-value family has all14 cases. EXISTING BEHAVIORAL TEST means a specific reused assertion; it is not production storage certification. NOT ESTABLISHED remains a release/audit gap. No path-wide green is inferred from normal success.',rows:groups.map(g=>({family:g.id,cases:Object.fromEntries(cases.map(c=>{
  if(failures[g.id]?.[c])return[c,{status:failures[g.id][c].startsWith('C5 FIXED')?'FIXED WITH REGRESSION TEST':'PROVEN DEFECT',evidence:failures[g.id][c],artifact:failures[g.id][c].startsWith('C5 FIXED')?'clan-receipt-guard-after-corrected-fixture.log':'clan-probe-results.json'}];
  const e=evidence[g.id]?.[c];
  const found=e?tests.filter(t=>t.file.endsWith(e[0])).flatMap(t=>t.tests.filter(n=>n.includes(e[1])).map(title=>({file:t.file,title}))):[];
  return[c,found.length?{status:'EXISTING BEHAVIORAL TEST',evidence:found}:{status:'NOT ESTABLISHED',evidence:'Inspect family tests/callers and complete the safe-target drill before certifying this case.'}];
}))}))});
console.log(`${rows.length} source/route rows, ${groups.length} value families, ${cases.length} adversarial cases per family`);

# Controlled Village/Sector War Event

Village and Sector War are live-impact systems. Run only a short staffed event until concurrent settlement and rollback evidence exists.

## Event record

Record UTC start/end, eligible account or level/rank rules, primary operator, backup operator, incident channel, deployment commit, `ENABLE_VILLAGE_WAR`/`DISABLE_VILLAGE_WAR` state, reward caps, and the communication template.

Before start, capture sector ownership, village/clan standings, treasury/economy totals, active contests, mercenaries, supply, taxes, and relevant receipt counts. Verify one Railway replica, fresh backup, deep health, Sentry/Better Stack, admin correction access, and the economy freeze/war disable controls.

## Certification cases

- Only a completed authoritative `pvp:<battleId>` affects a sector contest.
- One battle cannot resolve two contests; wrong player, village, sector, or expired contest rejects.
- Concurrent settlement changes territory and rewards once.
- Taxes, resources, supply, mercenaries, crates, and ownership do not duplicate on retry.
- Admin correction is audited and produces before/after evidence.
- Reward receipts are searchable by battle, contest, player, clan, and village.

## Incident and rollback

For a reward/economy exploit set `FREEZE_ECONOMY_REWARDS=1` to reject new unsafe-method player requests and apply the affected feature/job/realtime controls; for a war-only issue set `DISABLE_VILLAGE_WAR=1` and redeploy. The request freeze alone does not stop GET-side-effect or non-HTTP settlement. Preserve logs, receipts, request IDs, sector/economy snapshots, and disputed battle IDs. Do not delete receipts. Correct invalid outcomes through audited admin tooling. Use application rollback only if the prior build remains schema/save compatible. Restore data only with owner authorization and the backup/restore runbook.

## Low-population rule

The event ends without permanent punitive compounding when participation is below the announced threshold. Restore pre-event ownership or apply a predeclared neutralization rule; do not let one low-population test permanently dominate taxes, supply, or access.

Publish a post-event report with participation, completed/rejected contests, duplicate attempts, rewards, economy deltas, disputes, corrections, incidents, and a go/no-go recommendation for the next event.

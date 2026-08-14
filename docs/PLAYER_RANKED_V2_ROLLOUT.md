# Player Ranked V2 rollout

Player Ranked V2 is default-off. Do not set `ENABLE_PLAYER_RANKED_V2=1` in a
mixed worker pool: d76a move workers use unconditional session writes and do not
understand V2 season-close fences. The V2 session shape is legacy reward-inert,
but that alone cannot make an old move writer linearizable.

## Stage 1 — deploy and drain

1. Leave both player-ranked variables unset. Deploy the upgraded API/client to
   every region, cron worker, and background process.
2. Stop routing to the prior release and wait at least the platform's maximum
   request duration plus the 3-second move lease. Confirm no d76a deployment,
   canary, warm function, or rollback target is still receiving traffic.
3. Verify legacy `ranked:true, rankedKind:'player'` sessions can still finish and
   claim through the legacy path. Confirm the V2 queue GET reports
   `enabled:false`, join/poll return 503 without queue, rate-limit, token, or new
   admission/session writes, and pet-ranked public flags remain unchanged. If
   durable V2 terminals already exist, the disabled endpoint may only help
   their exact journal/effect/compaction saga forward before returning 503.
4. Run the focused ranked fault matrix and server TypeScript build recorded in
   the release checklist. Do not promote if any terminal admission, pending
   journal, or season transition is unreadable.

Keep `ENABLE_VANGUARD_REWARD_V2` unset throughout this stage. Generic/legacy
PvP therefore retains the d76a receipt shape and cannot publish a new protected
save marker that an old save worker does not understand.

## Stage 2 — enable admissions

After the drain, set `ENABLE_VANGUARD_REWARD_V2=1` to move generic Vanguard
payouts onto the exact intent + save-atomic marker protocol. Then set
`ENABLE_PLAYER_RANKED_V2=1` in the same or a later deployment. Exact V2 terminal
settlement always requires the marker protocol; the player-ranked flag must
never be enabled before the Stage 1 drain. Verify queue GET
and every successful POST include `enabled:true`, new sessions carry
`playerRankedAuthorityVersion:2`, keep legacy `ranked` and `baseRewards` false,
and seal every equipped item id to zero. Consumables and thrown weapons remain
disabled for this rollout on both server and client.

## Emergency disable and rollback

`DISABLE_PLAYER_RANKED_V2=1` always wins over the enable flag. It immediately
blocks new join/poll admissions and direct V2 starts; it does not reinterpret or
delete existing authority. Keep upgraded workers running so move retries,
claims, queue recovery, and season rollover can finish exact V2 journals and
compact terminal sessions. Do not roll worker code back to d76a while any V2
session/admission/journal exists. A code rollback is safe only after the gate is
free of V2 admissions and all upgraded terminal recovery has drained.

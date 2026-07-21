# Beta Metrics Checklist

Date: July 7, 2026

## Verdict

The codebase has useful gameplay counters, battle receipts, mission counters, audit logs, and economy telemetry, but it does not yet have a complete product analytics funnel. First beta should use the existing server-side receipts and counters, then add aggregate-only funnel events after privacy review.

## Must Watch Daily

| Metric | Why it matters | Current support | Action |
| --- | --- | --- | --- |
| Registrations | Top of funnel health | Login/save data exists, aggregate dashboard not confirmed | Add manual count from save store or admin export. |
| Character created | Fresh-account conversion | Save record has character fields | Track count by day. |
| Academy started/completed | First-session health | `onboardingStep`, Academy Trial, Academy Checklist | Track completion and stuck steps. |
| First mission claimed | Core loop proof | Server mission claim path and counters | Treat failures as P1. |
| First KO/hospital discharge | Soft-lock risk | Hospitalized fields and server heal endpoint | Watch no-ryo/no-health reports. |
| Level distribution | Progression pacing | Character level/xp in saves | Daily histogram by level band. |
| Ryo distribution | Economy inflation | Character wallet/bank fields, economy logs for some faucets | Daily percentile check. |
| PvP sessions created/settled | Competitive health | PvP session, claim-rewards, receipts | Watch unresolved battle ids. |
| Mission claim failures | Reward integrity | Server claim endpoints | Review errors and duplicate attempts. |
| Mobile complaints | Player access | Manual feedback only | Tag feedback by viewport/device. |

## Existing Signals To Use

| System | Existing signal |
| --- | --- |
| PvP | Server sessions, claim-rewards, battle receipts, action receipts, ranked reward path, anti-farm checks. |
| Missions | Daily mission counters, hunt counters, server-authoritative mission catalog, newbie daily missions. |
| Economy | Bank-interest telemetry, mission reward catalog, war economy helpers, reward audit logs. |
| Progression | XP engine tests, rank gates, stat growth daily cap, training tier tests. |
| Daily/weekly loops | Newbie dailies, profession dailies, village agenda, weekly board, weekly boss schedule. |
| Risk gates | Release flags for weekly boss client damage, client-trusted combat rewards, player AI image generation. |
| Admin review | Audit domains for content, reward, sector, combat, and legacy events. |

## Metrics To Add Before Wider Beta

Add aggregate-only events. Do not log chat contents, custom prompts, passwords, tokens, or private messages.

| Event | Properties | Notes |
| --- | --- | --- |
| `beta.funnel.registered` | date only | Count, not PII. |
| `beta.funnel.character_created` | village, specialty, bloodline category | Good for village/bloodline popularity. |
| `beta.funnel.academy_step` | step, completed true/false | Needed to find first-session exits. |
| `beta.reward.claimed` | source, xp, ryo, rare currencies, level band | Aggregate reward integrity. |
| `beta.combat.ended` | mode, level band, rounds, outcome | Do not store full combat log here; receipts already own detail. |
| `beta.screen.exit` | screen, level band | Optional; useful only if implemented cleanly. |

## Alert Thresholds

- P0: any repeatable duplicate reward, unauthorized admin action, or save overwrite.
- P1: more than 10% of fresh accounts fail before first mission claim due a defect.
- P1: PvP/tower sessions regularly fail to resolve or leave players battle-locked.
- P2: median level-1-to-level-10 time is far below design because a single faucet dominates.
- P2: wallet/bank ryo percentiles jump sharply without a known source.
- P2: one village has a large population or win-rate advantage caused by hidden mechanics rather than preference.

## Reporting Format

Publish a short daily beta note:

```text
Date:
New accounts:
Characters created:
Academy completions:
First mission claims:
P0/P1 reports:
Top P2 themes:
Reward/economy anomalies:
Recommended patch action:
```


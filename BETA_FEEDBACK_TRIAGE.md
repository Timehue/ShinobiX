# Beta Feedback Triage

Date: July 7, 2026

## Purpose

This is the operating model for first beta feedback. The goal is to separate launch-blocking defects from normal balance noise, keep player reports actionable, and avoid broad rebalances before the first cohort produces usable data.

## Intake Channels

Use one tracker for player-visible issues and one private tracker for exploit/security reports.

Recommended fields:

| Field | Required | Notes |
| --- | --- | --- |
| Player name/account | Yes | Use display name only in public triage. Keep private identifiers out of public notes. |
| Build/date | Yes | Include deployment date and commit if known. |
| Platform | Yes | Desktop, mobile, browser, and viewport if layout-related. |
| System | Yes | Onboarding, mission, PvP, tower, bank, hospital, village, creator, admin. |
| Expected result | Yes | What the player thought would happen. |
| Actual result | Yes | Include error text, screenshot, or battle id when available. |
| Repro steps | Best effort | Keep as numbered steps. |
| Impact | Yes | Blocked, lost reward, confusing, cosmetic, exploit. |

## Severity Rules

| Priority | Meaning | Examples | Target response |
| --- | --- | --- | --- |
| P0 | Stop or rollback | Save loss, currency duplication, security bypass, broken login, live economy exploit | Same day. Patch or disable. |
| P1 | Beta blocker | Fresh account cannot finish Academy, PvP cannot settle, mission reward not delivered, mobile blocks core controls | Same day or next day. |
| P2 | High friction | Confusing reward copy, hard-to-read combat state, dead-end screen, unclear cooldown, balance outlier with evidence | Patch window or weekly patch. |
| P3 | Polish/content | Typos, flavor requests, mild layout polish, wishlist content | Batch for later. |

## Triage Tags

- `save-integrity`
- `reward-integrity`
- `fresh-account`
- `combat-feel`
- `pvp-balance`
- `pve-balance`
- `economy`
- `mobile`
- `retention`
- `created-content`
- `admin`
- `exploit-private`

## First Response Template

```text
Thanks, we logged this as [priority/tag]. Can you add:
1. What screen you were on.
2. What you clicked last.
3. Your player name and approximate time.
4. A screenshot or battle id if this was combat/reward related.
```

## Escalation Rules

- Any report of duplicated ryo, Fate Shards, Honor Seals, crates, or created content bypass goes private immediately.
- Any report of a stuck active PvP/tower/Hollow Gate state gets a staff repro and receipt/log check before balance discussion.
- Any report affecting fresh accounts before first mission claim is at least P1 until disproved.
- Any report affecting mobile core gameplay is at least P2 and becomes P1 if controls are blocked.
- Do not change XP, ryo, AP, cooldown, stat, or drop values from a single anecdote unless it is clearly an exploit or soft-lock.

## Beta Decision Cadence

Daily during first beta week:

1. Review P0/P1 reports.
2. Review fresh-account funnel failures.
3. Review reward-integrity reports and battle receipts.
4. Pick only small, testable fixes for the next patch.

Weekly after first beta week:

1. Compare retention and progression metrics.
2. Review top repeated feedback themes.
3. Make one economy/progression adjustment at a time, with tests or simulations.


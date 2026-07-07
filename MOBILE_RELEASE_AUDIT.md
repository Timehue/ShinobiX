# Mobile Release Audit

Date: July 7, 2026

Scope: source inspection, responsive UI review targets, and release notes. Browser automation against a running app is still required for screenshots and final pass/fail.

## Viewport Targets

| Viewport | Status | Notes |
| --- | --- | --- |
| 390x844 mobile | Needs browser smoke | Mobile bottom nav and profile sheet exist; combat grids remain highest risk. |
| 430x932 mobile | Needs browser smoke | Same as 390; verify sticky notices do not cover primary actions. |
| 768x1024 tablet | Needs browser smoke | Likely usable; check modal heights and village map labels. |
| 1280x720 laptop | Needs browser smoke | Main layout should fit; check dense admin/war panels. |
| 1920x1080 desktop | Needs browser smoke | Primary target for late-game and admin systems. |

## Player-Facing Screen Notes

| Screen | Mobile State | Risk |
| --- | --- | --- |
| Landing | Likely ready | Sticky CTA must not cover auth buttons; existing code already accounts for this. |
| Character creation | Likely ready | Multi-step flow reduces crowding. |
| Village/main layout | Likely ready | Village map buttons may need visual check at 390 width. |
| Training/Missions/Inventory/Bank/Hospital/Shop | Likely ready | One-time hints improve orientation. |
| World Map/Sectors | Monitor | Dense map, zoom, and action overlays need hands-on mobile testing. |
| PvP/Battle Tower combat | Monitor | Battle board, log, AP/cooldowns, and target controls need viewport checks. |
| Clan Boss/Weekly Boss/Village War/Sector War | Gate or monitor | Dense and economy-sensitive; do not promote as mobile-first. |
| Admin/creator tools | Desktop-only recommended | Large forms, upload controls, and diagnostics should stay desktop-first. |

## Fixes Implemented

- Added dismissible public-beta notices with responsive width and small-screen-safe close controls.
- Expanded screen hints so mobile players opening a menu for the first time get a concise explanation.
- Marked Hollow Gate and dense late-game flows as desktop-first in the release metadata and launch recommendation.

## Remaining Problem Screens

| Screen | Remaining Risk | Required Check |
| --- | --- | --- |
| PvP battle | AP/status/action readability at 390x844 | Mobile fight screenshot and tap test. |
| Battle Towers | Board framing and resume state | Start a floor, refresh, continue. |
| World Map | Marker overlap and action overlay height | Explore, select sector, return. |
| Village War Map | Dense controls, possible horizontal pressure | Treat as desktop-first until checked. |
| Bloodline Maker | Long forms and image controls | Desktop-first beta. |
| Admin panel | Dense diagnostics | Desktop-only operational tool. |


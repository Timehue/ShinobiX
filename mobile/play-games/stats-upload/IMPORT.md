# Play Games Game Stats import draft

`shinobi-game-stats.zip` contains the five repetitive-stat definitions, one
progression stat, and six 512 × 512 transparent PNG icons. It is prepared from
the current server-confirmed event calls and remains a draft until Play Console
IDs and the in-console schema have been checked.

Rebuild the import archive after changing a CSV or source icon with
`powershell -ExecutionPolicy Bypass -File mobile\tools\build-play-games-game-stats.ps1`.

## Import order

1. In Play Console, import `PlayerGameEvent.csv` under Play Games Services →
   Game Stats → Add an event → Import via CSV.
2. Check the created property types and copy each Console-generated event ID
   into its matching `pgs_event_*` string in
   `mobile/android/app/src/main/res/values/play_games.xml`. The built-in
   `progressUpdate` event does not get a generated event ID.
3. Import `shinobi-game-stats.zip` under Game Stats → Add a stat → Import via
   ZIP. Review the names, descriptions, icons, filters, and competitive limits
   before publishing.
4. Test with a Play Games Services tester account on the internal track. Verify
   that fresh server-settled outcomes appear and replayed claims do not inflate
   counts. Check Logcat for schema-validation errors.
5. Publish Game Stats only after the event schema and values are correct.
   Google currently says published stats cannot be deleted and event names,
   stat IDs, aggregation, and associated-event details cannot be changed.

The competitive stat is **PvP Victories**, filtered to `result = win`, with a
provisional 0–1,000,000 display range. Confirm the range against the intended
long-term population before publishing. The progression stat uses the current
player level as `currentProgress`; level is updated from game progress rather
than granted by this integration.

This package does not configure the Play Console project, generated event IDs,
testers, or publication. Its presence alone does not satisfy the Level Up
Game Stats requirement.

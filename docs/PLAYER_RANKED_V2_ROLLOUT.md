# Player Ranked Administration

Player-ranked matchmaking is controlled by the Ranked Seasons section of the
Admin Panel. It has no deployment environment toggle.

- **Start Ranked Season** starts Season 1 when none exists, or resumes a
  previously stopped season.
- **Stop Ranked Season** pauses new queue entries while preserving the season
  clock, standings, and any existing fights.
- **Force Season Rollover Now** settles the current season, archives the
  standings, awards the podium, soft-resets ratings, and immediately starts the
  next season.

The queue opens only while its current season is active and accepting entries.
Stopping a season never discards active match authority; those matches can
complete and settle safely.

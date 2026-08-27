# MasterDash — Time Tracker

A tile-based time log for one person. Tap a tile to start an activity, tap
another to switch, and the day writes itself down.

Extracted from the repository it grew up in, where it shared a shell with a
landscape estimator. The two had almost nothing to say to each other — separate
stores, separate screens, one nav bar between them — so they are now separate
apps. The estimator lives on in the `MasterDash` repo; everything here is the
time-tracking half, with its history intact.

## What is here

    app/page.tsx        the board — tap to start, tap again to stop
    app/calendar        the month, filled in
    app/log             every entry, editable
    app/tiles           which activities exist and what they are called
    app/settings        the rest, plus export

    lib/store.ts        localStorage, the single source of truth
    lib/relevance.ts    which tiles rise to the top of the board, and when
    lib/time.ts         the day-boundary arithmetic

## Running it

    npm install
    npm run dev

No environment variables and no database: everything is in localStorage, which
is what makes it work on a phone with no signal.


# CampusFix — Catalyst two-laptop rehearsal

Build a campus maintenance helpdesk using two Claude Code leads and two named subagents per laptop.
This repository starts with instructions only: the agents implement the application during the rehearsal.
This is an end-to-end integration demonstration, not a measured Catalyst-vs-baseline benchmark.

## The finished application

A local web app to create maintenance tickets, search/filter them, assign a technician, change status,
add comments and see summary counts. Seed 24 realistic fictional campus issues. Persist changes in SQLite.
No login, paid services, external API, cloud deployment, email, uploads or AI features in the demo app.

## Before starting

1. Tiam and Namit must both have push access to this repository and working Git authentication.
2. Both Macs use the same Catalyst main build and the same agreed Claude model/settings.
3. Tiam clones this repo and opens Claude Code here. Ask it to set up Catalyst as Tiam and invite Namit.
4. Before Namit clones, Tiam asks Claude to commit/push only the setup files:
   .mcp.json, .claude/settings.json, CLAUDE.md and .gitignore. Never force-add runtime files or invite secrets.
5. Namit now clones main with those setup files, opens Claude Code here and joins as Namit using the private
   invitation. Do not initialize a separate Catalyst project on Namit's clone before joining.
6. Compare confirmation codes, restart both Claude sessions so hooks load, confirm connected status, and
   verify clean tracked worktrees. If the invitation expired, Tiam requests a new one.
7. Open `catalyst dashboard` in a second terminal on each Mac. Finish invitation/trust prompts before recording.

Read [BRIEF.md](BRIEF.md) for scope and acceptance criteria, and [CLAUDE.md](CLAUDE.md) for coordination/Git rules.
Paste the entire prompt in [START-TIAM.md](START-TIAM.md) on Tiam's laptop and
[START-NAMIT.md](START-NAMIT.md) on Namit's laptop. Then let the agents work.
The two prompts are designed to overlap: Namit waits for Tiam's initial scaffold through Catalyst.

## What to record

- Both named participants and four distinct worker identities in the Catalyst dashboards.
- The shared queue, ownership, real question/reply, decisions and milestone checkpoints.
- Actual branch pushes and integration, final tests, and the running CampusFix UI.
- Any manual nudges, failures or pauses honestly; do not describe a prompted/failed run as fully unattended.

Keep recordings, detailed checkpoint exports and invite tokens outside this public repository.
Do not show dashboard URL tokens or pairing secrets in recordings.

## Success

All initial eight tasks and any corrective tasks are done; backend and frontend code from both participants
is integrated on main; the same final Git commit passes the actual tests on both Macs; both locally running
apps pass the interactive checklist in BRIEF.md. App data is local to each Mac: Catalyst syncs coordination
records, not the CampusFix database.

Rehearse before recording the presentation take. A successful rehearsal is evidence for this setup,
not a guarantee that all workloads or abrupt failures will recover.

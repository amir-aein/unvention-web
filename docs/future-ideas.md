# Product Roadmap

This document tracks shipped milestones and next development priorities for Unvention.

## Recently Shipped (February 2026)

1. **Supabase event persistence + auth foundation** (February 16, 2026)
Adds Supabase schema + RLS baseline, legacy import tooling, live room event/profile sync from server, and frontend email OTP auth wiring with profile-token linking hooks.

2. **Multiplayer hub + multi-room switching hardening** (February 15, 2026)
Includes room hub flow refactor, safer room switching, and integration coverage for multi-room transitions.

3. **Stable multiplayer profile identity + history APIs** (February 14, 2026)
Adds stable profile tokens, reconnect-aware identity, profile/room history endpoints, and persisted profile snapshots.

4. **Variable setup pipeline + workshop UI upgrades** (February 14, 2026)
Moves setup into a modular pipeline and updates workshop handling/UI across solo and multiplayer paths.

5. **Turn/action dice UX polish** (February 14, 2026)
Improves dice interaction clarity and visual feedback during active phases.

## Current Priorities

1. **Auth Completion + Account UX** (`Now - Best Next Option`)
Why now: auth + persistence foundations are now live, so finishing this closes identity consistency across devices and unlocks user-facing account trust quickly.
Scope:
- Add auth loading/error states and resend cooldown polish in the home panel.
- Add authenticated profile settings edit path (`display_name`) with validation.
- Add sign-in gating rules for account-scoped features and clear signed-out fallback behavior.
- Add auth integration test coverage for OTP flow and session restore.

2. **Room and Profile History UI**
Short description: Add timeline/history surfaces in the multiplayer hub backed by existing history endpoints and Supabase-backed event persistence.

3. **Multiplayer Integrity Hardening**
Short description: Increase trust in multiplayer outcomes with deeper server-side validation and anti-abuse checks.

4. **Bot Seat Fill**
Short description: Fill missing seats with AI players so rooms can start without waiting for full parties.

## Backlog Ideas

- New Inventions and Tools
- Roguelite Solo Mode
- Guided Tutorial Mode
- Asynchronous Multiplayer
- Spectator Mode
- Ranked Ladders and Seasons
- Post-Game Insights
- In-Game Social Layer
- Balance and Quality Dashboard

## Not Prioritized Right Now

- Replay Viewer
- Daily Challenge

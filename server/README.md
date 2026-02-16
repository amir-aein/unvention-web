# Web + Multiplayer Server (Single Host)

## Run

1. Install dependencies:
   `npm install`
2. Start server:
   `npm start`
3. Optional custom port:
   `PORT=8090 npm start`
4. Smoke test (in another terminal):
   `npm run server:smoke`

Open app locally:
`http://localhost:8080/`

Server endpoints:
- `GET /health` health check
- `GET /api/rooms` room directory payload for multiplayer lobby
- `GET /api/auth/config` public Supabase auth config (`url`, `publishableKey`) for browser client bootstrap
- `GET /api/rooms/:roomCode/history?limit=150&before=<sequence>` room event history
- `GET /api/profile?profileToken=<token>` profile summary + active/recent rooms
- `GET /api/profile/history?profileToken=<token>&limit=150&before=<sequence>` profile event history
- `GET /` and static files from project root (serves `index.html`)

## Protocol

All messages are JSON with a `type` field.

### Client -> Server

- `create_room`
  - payload: `{ "type": "create_room", "name": "Host Name", "profileToken": "optional_stable_profile_token" }`
- `join_room`
  - payload: `{ "type": "join_room", "roomCode": "ABC123", "name": "Guest Name", "profileToken": "optional_stable_profile_token" }`
  - reconnect payload: `{ "type": "join_room", "roomCode": "ABC123", "reconnectToken": "...", "profileToken": "optional_stable_profile_token" }`
- `start_game`
  - payload: `{ "type": "start_game" }`
  - host only
- `player_state_update`
  - payload: `{ "type": "player_state_update", "state": { ... } }`
  - used for per-player local board persistence/recovery (server does basic shape handling only)
- `end_turn`
  - payload: `{ "type": "end_turn", "turnSummary": { "completedJournals": 1, "totalScore": 10, "payload": { "day": "Friday", "turnNumber": 1 }, "actions": [ ...deltaEvents ] } }`
- `kick_player`
  - payload: `{ "type": "kick_player", "playerId": "P3" }`
  - host only
- `terminate_room`
  - payload: `{ "type": "terminate_room" }`
  - host only; closes room for all players
- `leave_room`
  - payload: `{ "type": "leave_room" }`
- `request_sync`
  - payload: `{ "type": "request_sync" }`
- `heartbeat`
  - payload: `{ "type": "heartbeat" }`

### Server -> Client

- `connected` with `connectionId`
- `room_joined` with `roomCode`, `playerId`, `reconnectToken`, `profileId`, `profileToken`
- `room_state` with full room snapshot and your player identity (`playerId`, `profileId`, `profileToken`)
- `player_state_update` broadcast when any player publishes state
- `turn_advanced` when all players have ended turn
- `game_completed` on Sunday completion
- `removed_from_room` when kicked/removed
- `room_terminated` when host cancels room
- `error` with `code`, `message`

## Gameplay Rules Enforced

- Max 5 players in a room.
- Private room code model.
- 15-minute reconnect window.
- One shared dice roll each turn for the whole room.
- Turn barrier: next turn only starts when all players send `end_turn`.
- Basic turn validity checks: `end_turn` is rejected when `day/turnNumber` do not match current room turn.
- Duplicate end-turn rejection for same player/turn.
- Host controls: start game and kick players.

## Logging

Server action logs are written to:
`server/output/actions.ndjson`

Each line is one JSON event with timestamp, room code, type, and payload.

Room and profile history read models are written to:
- `server/output/room-events.ndjson` (append-only room event stream)
- `server/output/profiles.json` (latest profile snapshot keyed by stable token)

### Optional Supabase Sync

When these env vars are present, server logs are also synced to Supabase:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`)

Synchronized tables:
- `public.room_events`
- `public.legacy_profiles`

Local files in `server/output/*` remain source-of-truth fallback and are still written.

### Optional Supabase Auth Bootstrap

To enable browser auth bootstrap via `GET /api/auth/config`, also set:
- `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`)

## One-Computer Testing

1. Start server: `npm run server`
2. Open game in multiple browser contexts:
   - normal window
   - incognito window
   - second browser (optional)
3. Create room in one context, join from others with room code.
4. Start game as host, then validate:
   - all clients receive same roll
   - independent actions can proceed
   - next turn does not start until everyone ends turn
   - disconnect/reconnect works within 15 minutes

## Authority Model

- Server is authoritative for room lifecycle and turn lifecycle (`start_game`, shared roll, `end_turn`, turn advance).
- Client owns per-turn action execution locally.
- Client submits per-turn delta action list at `end_turn` for audit/debug.

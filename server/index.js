const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8080);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MAX_PLAYERS = 5;
const RECONNECT_WINDOW_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 1000;
const ACTION_LOG_PATH = path.join(__dirname, "output", "actions.ndjson");
const ROOM_EVENT_LOG_PATH = path.join(__dirname, "output", "room-events.ndjson");
const PROFILE_SNAPSHOT_PATH = path.join(__dirname, "output", "profiles.json");
const DAYS = ["Friday", "Saturday", "Sunday"];
const DAY_THRESHOLDS = {
  Friday: 1,
  Saturday: 2,
  Sunday: 3,
};
const MAX_SHARED_LOG_ENTRIES = 1500;
const MAX_ROOM_HISTORY_ENTRIES = 5000;
const MAX_PROFILE_HISTORY_ENTRIES = 4000;
const MAX_PROFILE_ROOM_ENTRIES = 30;
const DEFAULT_HISTORY_LIMIT = 150;
const MAX_HISTORY_LIMIT = 1000;

const rooms = new Map();
const connectionsById = new Map();
const profilesById = new Map();
const profileIdByToken = new Map();
const roomHistoryByCode = new Map();
const profileHistoryById = new Map();
const roomArchiveByCode = new Map();
let roomEventSequence = 0;
let persistProfilesTimer = null;

ensureLogPath();
loadProfilesSnapshot();
loadRoomEventHistory();

const httpServer = http.createServer((req, res) => {
  const method = String(req.method || "").toUpperCase();
  const url = safeParseUrl(req.url);
  const pathname = url?.pathname || "/";
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "unvention-multiplayer",
      rooms: rooms.size,
      profiles: profilesById.size,
      serverTime: Date.now(),
    });
    return;
  }

  if (method === "GET" && pathname === "/api/rooms") {
    sendJson(res, 200, buildRoomDirectoryPayload());
    return;
  }

  if (method === "GET" && pathname === "/api/profile") {
    const profileToken = String(url?.searchParams?.get("profileToken") || "");
    if (!profileToken) {
      sendJson(res, 400, { ok: false, error: "missing_profile_token" });
      return;
    }
    const payload = buildProfilePayload(profileToken);
    if (!payload) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (method === "GET" && pathname === "/api/profile/history") {
    const profileToken = String(url?.searchParams?.get("profileToken") || "");
    if (!profileToken) {
      sendJson(res, 400, { ok: false, error: "missing_profile_token" });
      return;
    }
    const beforeSequence = parsePositiveInt(url?.searchParams?.get("before"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = parsePositiveInt(url?.searchParams?.get("limit"), DEFAULT_HISTORY_LIMIT, 1, MAX_HISTORY_LIMIT);
    const payload = buildProfileHistoryPayload(profileToken, beforeSequence, limit);
    if (!payload) {
      sendJson(res, 404, { ok: false, error: "profile_not_found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  const roomHistoryMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/history$/);
  if (method === "GET" && roomHistoryMatch) {
    const roomCode = String(roomHistoryMatch[1] || "").toUpperCase();
    const beforeSequence = parsePositiveInt(url?.searchParams?.get("before"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = parsePositiveInt(url?.searchParams?.get("limit"), DEFAULT_HISTORY_LIMIT, 1, MAX_HISTORY_LIMIT);
    const payload = buildRoomHistoryPayload(roomCode, beforeSequence, limit);
    if (!payload) {
      sendJson(res, 404, { ok: false, error: "room_not_found" });
      return;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  serveStaticAsset(pathname, res, method === "HEAD");
});
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const connectionId = randomId(12);
  ws.meta = {
    connectionId,
    roomCode: null,
    playerId: null,
    profileId: null,
  };
  connectionsById.set(connectionId, ws);
  send(ws, "connected", { connectionId, serverTime: Date.now() });

  ws.on("message", (raw) => {
    try {
      const parsed = JSON.parse(String(raw || ""));
      handleClientMessage(ws, parsed);
    } catch (_error) {
      send(ws, "error", { code: "invalid_message", message: "Malformed JSON payload." });
    }
  });

  ws.on("close", () => {
    connectionsById.delete(connectionId);
    handleDisconnect(ws);
  });
});

setInterval(sweepExpiredPlayers, SWEEP_INTERVAL_MS);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log("Multiplayer server listening on port", PORT);
});

function handleClientMessage(ws, message) {
  const type = String(message?.type || "");
  if (!type) {
    send(ws, "error", { code: "missing_type", message: "Message must include a type." });
    return;
  }

  if (type === "create_room") {
    onCreateRoom(ws, message);
    return;
  }
  if (type === "join_room") {
    onJoinRoom(ws, message);
    return;
  }
  if (type === "leave_room") {
    onLeaveRoom(ws);
    return;
  }
  if (type === "start_game") {
    onStartGame(ws);
    return;
  }
  if (type === "kick_player") {
    onKickPlayer(ws, message);
    return;
  }
  if (type === "terminate_room") {
    onTerminateRoom(ws);
    return;
  }
  if (type === "player_state_update") {
    onPlayerStateUpdate(ws, message);
    return;
  }
  if (type === "player_log_event") {
    onPlayerLogEvent(ws, message);
    return;
  }
  if (type === "end_turn") {
    onEndTurn(ws, message);
    return;
  }
  if (type === "cancel_end_turn") {
    onCancelEndTurn(ws, message);
    return;
  }
  if (type === "request_sync") {
    sendRoomStateToConnection(ws);
    return;
  }
  if (type === "rename_player") {
    onRenamePlayer(ws, message);
    return;
  }
  if (type === "heartbeat") {
    send(ws, "heartbeat_ack", { serverTime: Date.now() });
    return;
  }

  send(ws, "error", { code: "unsupported_type", message: "Unsupported message type." });
}

function onCreateRoom(ws, message) {
  if (ws.meta.roomCode) {
    send(ws, "error", { code: "already_in_room", message: "Leave current room before creating another." });
    return;
  }
  const roomCode = generateRoomCode();
  const playerName = sanitizeName(message?.name, "Host");
  const profile = resolveOrCreateProfile(message?.profileToken, playerName);
  const player = createPlayer({
    roomCode,
    seat: 1,
    name: playerName,
    isHost: true,
    connectionId: ws.meta.connectionId,
    profileId: profile.profileId,
  });
  const room = {
    code: roomCode,
    status: "lobby",
    maxPlayers: MAX_PLAYERS,
    hostPlayerId: player.playerId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turn: {
      number: 1,
      day: "Friday",
      roll: null,
      rolledAt: null,
    },
    sharedLog: [],
    playerProfiles: {
      [player.playerId]: profile.profileId,
    },
    players: [player],
  };
  rooms.set(roomCode, room);
  trackProfileRoomVisit(profile.profileId, roomCode, {
    playerId: player.playerId,
    playerName: player.name,
    roomStatus: room.status,
  });
  ws.meta.roomCode = roomCode;
  ws.meta.playerId = player.playerId;
  ws.meta.profileId = profile.profileId;
  appendActionLog(roomCode, "create_room", {
    playerId: player.playerId,
    profileId: profile.profileId,
    name: player.name,
  });
  send(ws, "room_joined", {
    roomCode,
    playerId: player.playerId,
    reconnectToken: player.reconnectToken,
    profileId: profile.profileId,
    profileToken: profile.profileToken,
  });
  broadcastRoomState(room);
}

function onJoinRoom(ws, message) {
  if (ws.meta.roomCode) {
    send(ws, "error", { code: "already_in_room", message: "Leave current room before joining another." });
    return;
  }
  const roomCode = String(message?.roomCode || "").toUpperCase();
  const room = rooms.get(roomCode);
  if (!room) {
    send(ws, "error", { code: "room_not_found", message: "Room does not exist." });
    return;
  }

  const reconnectToken = String(message?.reconnectToken || "");
  if (reconnectToken) {
    const player = room.players.find((item) => item.reconnectToken === reconnectToken);
    if (player && Date.now() <= Number(player.canReconnectUntil || 0)) {
      const previousConnectionId = String(player.connectionId || "");
      if (previousConnectionId && previousConnectionId !== ws.meta.connectionId) {
        const previousSocket = connectionsById.get(previousConnectionId);
        if (previousSocket) {
          previousSocket.meta.roomCode = null;
          previousSocket.meta.playerId = null;
          previousSocket.meta.profileId = null;
          try {
            previousSocket.close(4001, "Reconnected from another tab");
          } catch (_error) {}
        }
      }
      player.connected = true;
      player.connectionId = ws.meta.connectionId;
      player.lastSeenAt = Date.now();
      player.canReconnectUntil = Date.now() + RECONNECT_WINDOW_MS;
      if (!room.playerProfiles || typeof room.playerProfiles !== "object") {
        room.playerProfiles = {};
      }
      if (player.profileId) {
        room.playerProfiles[player.playerId] = player.profileId;
      }
      ws.meta.roomCode = room.code;
      ws.meta.playerId = player.playerId;
      ws.meta.profileId = player.profileId || null;
      if (player.profileId) {
        trackProfileRoomVisit(player.profileId, room.code, {
          playerId: player.playerId,
          playerName: player.name,
          roomStatus: room.status,
        });
      }
      appendActionLog(room.code, "reconnect_player", {
        playerId: player.playerId,
        profileId: player.profileId || null,
      });
      send(ws, "room_joined", {
        roomCode: room.code,
        playerId: player.playerId,
        reconnectToken: player.reconnectToken,
        profileId: player.profileId || null,
        profileToken: resolveProfileToken(player.profileId),
      });
      broadcastRoomState(room);
      return;
    }
  }

  if (room.status !== "lobby") {
    send(ws, "error", { code: "room_in_progress", message: "Game already started." });
    return;
  }
  if (room.players.length >= room.maxPlayers) {
    send(ws, "error", { code: "room_full", message: "Room is full." });
    return;
  }

  const seat = getFirstOpenSeat(room);
  const playerName = sanitizeName(message?.name, "Guest");
  const profile = resolveOrCreateProfile(message?.profileToken, playerName);
  const player = createPlayer({
    roomCode: room.code,
    seat,
    name: playerName,
    isHost: false,
    connectionId: ws.meta.connectionId,
    profileId: profile.profileId,
  });
  room.players.push(player);
  if (!room.playerProfiles || typeof room.playerProfiles !== "object") {
    room.playerProfiles = {};
  }
  room.playerProfiles[player.playerId] = profile.profileId;
  trackProfileRoomVisit(profile.profileId, room.code, {
    playerId: player.playerId,
    playerName: player.name,
    roomStatus: room.status,
  });
  room.updatedAt = Date.now();
  ws.meta.roomCode = room.code;
  ws.meta.playerId = player.playerId;
  ws.meta.profileId = profile.profileId;
  appendActionLog(room.code, "join_room", {
    playerId: player.playerId,
    profileId: profile.profileId,
    name: player.name,
  });
  send(ws, "room_joined", {
    roomCode: room.code,
    playerId: player.playerId,
    reconnectToken: player.reconnectToken,
    profileId: profile.profileId,
    profileToken: profile.profileToken,
  });
  broadcastRoomState(room);
}

function onLeaveRoom(ws) {
  const room = getRoomForConnection(ws);
  if (!room) {
    return;
  }
  const playerId = ws.meta.playerId;
  removePlayer(room, playerId, "leave_room");
  ws.meta.roomCode = null;
  ws.meta.playerId = null;
  ws.meta.profileId = null;
}

function onRenamePlayer(ws, message) {
  const room = getRoomForConnection(ws);
  if (!room) {
    send(ws, "error", { code: "not_in_room", message: "Join a room first." });
    return;
  }
  const player = room.players.find((item) => item.playerId === ws.meta.playerId);
  if (!player) {
    send(ws, "error", { code: "player_not_found", message: "Player is not in room." });
    return;
  }
  const nextName = sanitizeName(message?.name, player.name || "Guest");
  if (nextName === player.name) {
    broadcastRoomState(room);
    return;
  }
  player.name = nextName;
  player.lastSeenAt = Date.now();
  room.updatedAt = Date.now();
  trackProfileRoomVisit(player.profileId, room.code, {
    playerId: player.playerId,
    playerName: player.name,
    roomStatus: room.status,
  });
  appendActionLog(room.code, "rename_player", {
    playerId: player.playerId,
    profileId: player.profileId || null,
    name: player.name,
  });
  broadcastRoomState(room);
}

function onStartGame(ws) {
  const room = getRoomForConnection(ws);
  if (!room) {
    send(ws, "error", { code: "not_in_room", message: "Join a room first." });
    return;
  }
  if (room.status !== "lobby") {
    send(ws, "error", { code: "already_started", message: "Game already started." });
    return;
  }
  if (!isHost(room, ws.meta.playerId)) {
    send(ws, "error", { code: "forbidden", message: "Only host can start the game." });
    return;
  }

  room.status = "in_game";
  room.turn = {
    number: 1,
    day: "Friday",
    roll: rollFiveDice(),
    rolledAt: Date.now(),
  };
  room.sharedLog = [];
  room.players.forEach((player) => {
    player.endedTurn = false;
    player.turnSummary = null;
    player.liveState = null;
    trackProfileRoomVisit(player.profileId, room.code, {
      playerId: player.playerId,
      playerName: player.name,
      roomStatus: room.status,
    });
  });
  room.updatedAt = Date.now();
  appendActionLog(room.code, "start_game", {
    byPlayerId: ws.meta.playerId,
    byProfileId: ws.meta.profileId || null,
    turn: room.turn,
  });
  broadcastRoomState(room);
}

function onKickPlayer(ws, message) {
  const room = getRoomForConnection(ws);
  if (!room) {
    send(ws, "error", { code: "not_in_room", message: "Join a room first." });
    return;
  }
  if (!isHost(room, ws.meta.playerId)) {
    send(ws, "error", { code: "forbidden", message: "Only host can kick players." });
    return;
  }

  const playerId = String(message?.playerId || "");
  if (!playerId) {
    send(ws, "error", { code: "missing_player_id", message: "playerId is required." });
    return;
  }
  if (playerId === room.hostPlayerId) {
    send(ws, "error", { code: "cannot_kick_host", message: "Host cannot kick themselves." });
    return;
  }

  removePlayer(room, playerId, "kick_player", ws.meta.playerId);
}

function onPlayerStateUpdate(ws, message) {
  const room = getRoomForConnection(ws);
  if (!room || room.status !== "in_game") {
    return;
  }
  const player = room.players.find((item) => item.playerId === ws.meta.playerId);
  if (!player) {
    return;
  }
  const incomingActions = sanitizeSharedActions(message?.actions);
  player.liveState = message?.state || null;
  appendSharedLogFromLiveActions(room, player, incomingActions);
  player.lastSeenAt = Date.now();
  room.updatedAt = Date.now();
  appendActionLog(room.code, "player_state_update", {
    playerId: player.playerId,
    profileId: player.profileId || null,
    turnNumber: room.turn.number,
    day: room.turn.day,
    keys: player.liveState && typeof player.liveState === "object" ? Object.keys(player.liveState) : [],
  });
  broadcast(room, "player_state_update", {
    playerId: player.playerId,
    state: player.liveState,
    actions: incomingActions,
    serverTime: Date.now(),
  });
  broadcastRoomState(room);
}

function onPlayerLogEvent(ws, message) {
  const room = getRoomForConnection(ws);
  if (!room || room.status !== "in_game") {
    return;
  }
  const player = room.players.find((item) => item.playerId === ws.meta.playerId);
  if (!player) {
    return;
  }
  const incoming = sanitizeSingleSharedAction(message?.entry);
  if (!incoming) {
    return;
  }
  appendSharedLogFromLiveActions(room, player, [incoming]);
  player.lastSeenAt = Date.now();
  room.updatedAt = Date.now();
  broadcastRoomState(room);
}

function onTerminateRoom(ws) {
  const room = getRoomForConnection(ws);
  if (!room) {
    send(ws, "error", { code: "not_in_room", message: "Join a room first." });
    return;
  }
  if (!isHost(room, ws.meta.playerId)) {
    send(ws, "error", { code: "forbidden", message: "Only host can terminate room." });
    return;
  }
  terminateRoom(room, "host_terminated", ws.meta.playerId);
}

function onEndTurn(ws, message) {
  const room = getRoomForConnection(ws);
  if (!room) {
    send(ws, "error", { code: "not_in_room", message: "Join a room first." });
    return;
  }
  if (room.status !== "in_game") {
    send(ws, "error", { code: "game_not_started", message: "Host must start game first." });
    return;
  }
  const player = room.players.find((item) => item.playerId === ws.meta.playerId);
  if (!player) {
    return;
  }
  if (player.endedTurn) {
    send(ws, "error", { code: "already_ended_turn", message: "You already ended this turn." });
    return;
  }
  const claimedTurn = Number(message?.turnSummary?.payload?.turnNumber || room.turn.number);
  const claimedDay = String(message?.turnSummary?.payload?.day || room.turn.day);
  if (claimedTurn !== Number(room.turn.number) || claimedDay !== String(room.turn.day)) {
    send(ws, "error", {
      code: "turn_mismatch",
      message: "Submitted turn does not match room turn.",
      expectedTurn: room.turn.number,
      expectedDay: room.turn.day,
    });
    return;
  }
  player.endedTurn = true;
  player.turnSummary = sanitizeTurnSummary(message?.turnSummary);
  appendSharedLogFromTurnSummary(room, player, player.turnSummary);
  player.lastSeenAt = Date.now();
  room.updatedAt = Date.now();
  appendActionLog(room.code, "end_turn", {
    playerId: player.playerId,
    profileId: player.profileId || null,
    turnNumber: room.turn.number,
    day: room.turn.day,
    actionCount: Array.isArray(player.turnSummary?.actions) ? player.turnSummary.actions.length : 0,
  });

  if (room.players.length > 0 && room.players.every((item) => item.endedTurn)) {
    advanceTurn(room);
    return;
  }

  broadcastRoomState(room);
}

function onCancelEndTurn(ws, message) {
  const room = getRoomForConnection(ws);
  if (!room) {
    send(ws, "error", { code: "not_in_room", message: "Join a room first." });
    return;
  }
  if (room.status !== "in_game") {
    send(ws, "error", { code: "game_not_started", message: "Host must start game first." });
    return;
  }
  const player = room.players.find((item) => item.playerId === ws.meta.playerId);
  if (!player) {
    return;
  }
  const claimedTurn = Number(message?.payload?.turnNumber || room.turn.number);
  const claimedDay = String(message?.payload?.day || room.turn.day);
  if (claimedTurn !== Number(room.turn.number) || claimedDay !== String(room.turn.day)) {
    send(ws, "error", {
      code: "turn_mismatch",
      message: "Cancel request does not match room turn.",
      expectedTurn: room.turn.number,
      expectedDay: room.turn.day,
    });
    return;
  }
  if (!player.endedTurn) {
    broadcastRoomState(room);
    return;
  }
  player.endedTurn = false;
  removeSharedLogForPlayerTurn(room, player.playerId, room.turn.number, room.turn.day);
  player.turnSummary = null;
  player.lastSeenAt = Date.now();
  room.updatedAt = Date.now();
  appendActionLog(room.code, "cancel_end_turn", {
    playerId: player.playerId,
    profileId: player.profileId || null,
    turnNumber: room.turn.number,
    day: room.turn.day,
  });
  broadcastRoomState(room);
}

function advanceTurn(room) {
  const transition = resolveDayTransition(room.turn.day, room.players);
  const previousTurn = room.turn.number;

  if (transition.gameCompleted) {
    room.status = "completed";
    room.turn.day = transition.finalDay;
    room.players.forEach((player) => {
      trackProfileRoomVisit(player.profileId, room.code, {
        playerId: player.playerId,
        playerName: player.name,
        roomStatus: room.status,
      });
    });
    room.updatedAt = Date.now();
    appendActionLog(room.code, "game_completed", {
      endedDay: transition.endedDay,
      previousTurn,
      finalDay: transition.finalDay,
    });
    broadcast(room, "game_completed", {
      roomCode: room.code,
      endedDay: transition.endedDay,
      finalDay: transition.finalDay,
      turnNumber: previousTurn,
    });
    broadcastRoomState(room);
    return;
  }

  room.turn.number = previousTurn + 1;
  room.turn.day = transition.nextDay || room.turn.day;
  room.turn.roll = rollFiveDice();
  room.turn.rolledAt = Date.now();
  room.players.forEach((player) => {
    player.endedTurn = false;
    player.turnSummary = null;
    player.liveState = null;
  });
  room.updatedAt = Date.now();
  appendActionLog(room.code, "turn_advanced", {
    previousTurn,
    turnNumber: room.turn.number,
    day: room.turn.day,
    endedDay: transition.endedDay,
    skippedDay: transition.skippedDay,
  });
  broadcast(room, "turn_advanced", {
    roomCode: room.code,
    previousTurn,
    turnNumber: room.turn.number,
    day: room.turn.day,
    roll: room.turn.roll,
    endedDay: transition.endedDay,
    skippedDay: transition.skippedDay,
  });
  broadcastRoomState(room);
}

function resolveDayTransition(currentDay, players) {
  const dayIndex = DAYS.includes(currentDay) ? DAYS.indexOf(currentDay) : 0;
  const completions = players.map((player) => Number(player.turnSummary?.completedJournals || 0));

  const findTriggeredDayIndex = (startIndex) => {
    for (let index = startIndex; index < DAYS.length; index += 1) {
      const threshold = DAY_THRESHOLDS[DAYS[index]];
      if (completions.some((value) => value >= threshold)) {
        return index;
      }
    }
    return -1;
  };

  const endedDayIndex = findTriggeredDayIndex(dayIndex);
  if (endedDayIndex < 0) {
    return {
      endedDay: null,
      skippedDay: null,
      nextDay: currentDay,
      gameCompleted: false,
      finalDay: currentDay,
    };
  }

  const endedDay = DAYS[endedDayIndex];
  if (endedDay === "Sunday") {
    return {
      endedDay,
      skippedDay: null,
      nextDay: null,
      gameCompleted: true,
      finalDay: "Sunday",
    };
  }

  let nextDayIndex = endedDayIndex + 1;
  let skippedDay = null;
  const nextThreshold = DAY_THRESHOLDS[DAYS[nextDayIndex]];
  if (completions.some((value) => value >= nextThreshold)) {
    skippedDay = DAYS[nextDayIndex];
    nextDayIndex += 1;
  }

  if (nextDayIndex >= DAYS.length) {
    return {
      endedDay,
      skippedDay,
      nextDay: null,
      gameCompleted: true,
      finalDay: "Sunday",
    };
  }

  return {
    endedDay,
    skippedDay,
    nextDay: DAYS[nextDayIndex],
    gameCompleted: false,
    finalDay: DAYS[nextDayIndex],
  };
}

function handleDisconnect(ws) {
  const room = getRoomForConnection(ws);
  if (!room) {
    return;
  }
  const player = room.players.find((item) => item.playerId === ws.meta.playerId);
  if (!player) {
    return;
  }
  player.connected = false;
  player.connectionId = null;
  player.lastSeenAt = Date.now();
  player.canReconnectUntil = Date.now() + RECONNECT_WINDOW_MS;
  room.updatedAt = Date.now();
  trackProfileRoomVisit(player.profileId, room.code, {
    playerId: player.playerId,
    playerName: player.name,
    roomStatus: room.status,
    connected: false,
  });
  appendActionLog(room.code, "disconnect_player", {
    playerId: player.playerId,
    profileId: player.profileId || null,
  });
  broadcastRoomState(room);
}

function sweepExpiredPlayers() {
  const now = Date.now();
  rooms.forEach((room) => {
    const before = room.players.length;
    const removedExpired = [];
    room.players = room.players.filter((player) => {
      if (player.connected) {
        return true;
      }
      const keep = now <= Number(player.canReconnectUntil || 0);
      if (!keep) {
        removedExpired.push(player);
      }
      return keep;
    });
    removedExpired.forEach((player) => {
      trackProfileRoomVisit(player.profileId, room.code, {
        playerId: player.playerId,
        playerName: player.name,
        roomStatus: room.status,
        connected: false,
        removedByAction: "expired_reconnect_window",
      });
    });
    if (room.players.length !== before) {
      appendActionLog(room.code, "remove_expired_players", {
        beforeCount: before,
        afterCount: room.players.length,
        playerIds: removedExpired.map((player) => player.playerId),
      });
    }
    if (room.players.length === 0) {
      archiveRoom(room, "empty_room");
      rooms.delete(room.code);
      appendActionLog(room.code, "delete_room", { reason: "empty_room" });
      return;
    }
    if (!room.players.some((player) => player.playerId === room.hostPlayerId)) {
      room.hostPlayerId = room.players[0].playerId;
    }
    if (room.status === "in_game" && room.players.length > 0 && room.players.every((player) => player.endedTurn)) {
      advanceTurn(room);
      return;
    }
    room.updatedAt = now;
    broadcastRoomState(room);
  });
}

function removePlayer(room, playerId, actionType, byPlayerId) {
  const playerIndex = room.players.findIndex((item) => item.playerId === playerId);
  if (playerIndex < 0) {
    return;
  }
  const player = room.players[playerIndex];
  room.players.splice(playerIndex, 1);
  room.updatedAt = Date.now();
  trackProfileRoomVisit(player.profileId, room.code, {
    playerId: player.playerId,
    playerName: player.name,
    roomStatus: room.status,
    connected: false,
    removedByAction: actionType,
  });
  appendActionLog(room.code, actionType, {
    playerId,
    profileId: player.profileId || null,
    byPlayerId: byPlayerId || null,
  });

  if (player.connectionId) {
    const socket = connectionsById.get(player.connectionId);
    if (socket) {
      send(socket, "removed_from_room", {
        roomCode: room.code,
        reason: actionType,
      });
      socket.meta.roomCode = null;
      socket.meta.playerId = null;
      socket.meta.profileId = null;
      if (actionType === "kick_player") {
        socket.close(4002, "Removed by host");
      }
    }
  }

  if (room.players.length === 0) {
    terminateRoom(room, "empty_room", byPlayerId || playerId);
    return;
  }
  if (!room.players.some((item) => item.playerId === room.hostPlayerId)) {
    room.hostPlayerId = room.players[0].playerId;
  }

  if (room.status === "in_game" && room.players.every((item) => item.endedTurn)) {
    advanceTurn(room);
    return;
  }
  broadcastRoomState(room);
}

function terminateRoom(room, reason, byPlayerId) {
  archiveRoom(room, reason);
  appendActionLog(room.code, "terminate_room", {
    reason,
    byPlayerId: byPlayerId || null,
    byProfileId: resolveProfileIdForRoomPlayer(room, byPlayerId) || null,
  });
  room.players.forEach((player) => {
    trackProfileRoomVisit(player.profileId, room.code, {
      playerId: player.playerId,
      playerName: player.name,
      roomStatus: "terminated",
      connected: false,
      removedByAction: reason,
    });
    const socket = player.connectionId ? connectionsById.get(player.connectionId) : null;
    if (!socket) {
      return;
    }
    send(socket, "room_terminated", {
      roomCode: room.code,
      reason,
      byPlayerId: byPlayerId || null,
    });
    socket.meta.roomCode = null;
    socket.meta.playerId = null;
    socket.meta.profileId = null;
  });
  rooms.delete(room.code);
}

function broadcastRoomState(room) {
  room.updatedAt = Date.now();
  room.players.forEach((player) => {
    if (!player.connected || !player.connectionId) {
      return;
    }
    const socket = connectionsById.get(player.connectionId);
    if (!socket) {
      return;
    }
    send(socket, "room_state", {
      room: serializeRoom(room),
      you: {
        playerId: player.playerId,
        profileId: player.profileId || null,
        profileToken: resolveProfileToken(player.profileId),
        reconnectToken: player.reconnectToken,
        liveState: player.liveState || null,
      },
      serverTime: Date.now(),
    });
  });
}

function sendRoomStateToConnection(ws) {
  const room = getRoomForConnection(ws);
  if (!room) {
    send(ws, "error", { code: "not_in_room", message: "Join a room first." });
    return;
  }
  const player = room.players.find((item) => item.playerId === ws.meta.playerId);
  send(ws, "room_state", {
    room: serializeRoom(room),
    you: player
      ? {
        playerId: player.playerId,
        profileId: player.profileId || null,
        profileToken: resolveProfileToken(player.profileId),
        reconnectToken: player.reconnectToken,
        liveState: player.liveState || null,
      }
      : null,
    serverTime: Date.now(),
  });
}

function serializeRoom(room) {
  return {
    code: room.code,
    status: room.status,
    maxPlayers: room.maxPlayers,
    hostPlayerId: room.hostPlayerId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    turn: {
      number: room.turn.number,
      day: room.turn.day,
      roll: room.turn.roll,
      rolledAt: room.turn.rolledAt,
    },
    sharedLog: Array.isArray(room.sharedLog)
      ? room.sharedLog.slice(-MAX_SHARED_LOG_ENTRIES).map((entry) => ({
        id: String(entry?.id || ""),
        level: String(entry?.level || "info"),
        message: String(entry?.message || ""),
        timestamp: entry?.timestamp || null,
        context: entry?.context && typeof entry.context === "object" ? entry.context : {},
      }))
      : [],
    players: room.players.map((player) => ({
      playerId: player.playerId,
      profileId: player.profileId || null,
      name: player.name,
      seat: player.seat,
      connected: player.connected,
      endedTurn: player.endedTurn,
      lastSeenAt: player.lastSeenAt,
      canReconnectUntil: player.canReconnectUntil,
      isHost: player.playerId === room.hostPlayerId,
      liveState: player.liveState || null,
    })),
  };
}

function appendSharedLogFromTurnSummary(room, player, summary) {
  if (!room || !player || !summary) {
    return;
  }
  const actions = Array.isArray(summary.actions) ? summary.actions : [];
  if (actions.length === 0) {
    return;
  }
  const day = String(room.turn?.day || "");
  const turnNumber = Number(room.turn?.number || 0);
  if (!Array.isArray(room.sharedLog)) {
    room.sharedLog = [];
  }
  const existingKeys = new Set(
    room.sharedLog
      .map((entry) => String(entry?.context?.actionKey || ""))
      .filter(Boolean),
  );
  actions.forEach((action, index) => {
    const actionContext = action?.context && typeof action.context === "object" ? action.context : {};
    const clientActionId = String(action?.clientActionId || "").trim();
    const actionKey = [
      String(player.playerId || ""),
      String(turnNumber),
      String(day),
      clientActionId || String(index),
      String(action?.timestamp || ""),
    ].join("|");
    if (existingKeys.has(actionKey)) {
      return;
    }
    existingKeys.add(actionKey);
    room.sharedLog.push({
      id: randomId(14),
      level: String(action?.level || "info").slice(0, 16),
      message: String(action?.message || "").slice(0, 400),
      timestamp: action?.timestamp || new Date().toISOString(),
      context: {
        ...actionContext,
        playerId: String(actionContext.playerId || player.playerId),
        playerName: String(player.name || ""),
        roomCode: String(room.code || ""),
        turnNumber,
        day,
        shared: true,
        actionKey,
        sharedOrder: index,
      },
    });
  });
  if (room.sharedLog.length > MAX_SHARED_LOG_ENTRIES) {
    room.sharedLog = room.sharedLog.slice(-MAX_SHARED_LOG_ENTRIES);
  }
}

function appendSharedLogFromLiveActions(room, player, actions) {
  if (!room || !player) {
    return;
  }
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) {
    return;
  }
  const day = String(room.turn?.day || "");
  const turnNumber = Number(room.turn?.number || 0);
  if (!Array.isArray(room.sharedLog)) {
    room.sharedLog = [];
  }
  const existingKeys = new Set(
    room.sharedLog
      .map((entry) => String(entry?.context?.actionKey || ""))
      .filter(Boolean),
  );
  list.forEach((action, index) => {
    const actionContext = action?.context && typeof action.context === "object" ? action.context : {};
    const clientActionId = String(action?.clientActionId || "").trim();
    const actionKey = [
      String(player.playerId || ""),
      String(turnNumber),
      String(day),
      clientActionId || String(index),
      String(action?.timestamp || ""),
    ].join("|");
    if (existingKeys.has(actionKey)) {
      return;
    }
    existingKeys.add(actionKey);
    room.sharedLog.push({
      id: randomId(14),
      level: String(action?.level || "info").slice(0, 16),
      message: String(action?.message || "").slice(0, 400),
      timestamp: action?.timestamp || new Date().toISOString(),
      context: {
        ...actionContext,
        playerId: String(actionContext.playerId || player.playerId),
        playerName: String(player.name || ""),
        roomCode: String(room.code || ""),
        turnNumber,
        day,
        shared: true,
        actionKey,
      },
    });
  });
  if (room.sharedLog.length > MAX_SHARED_LOG_ENTRIES) {
    room.sharedLog = room.sharedLog.slice(-MAX_SHARED_LOG_ENTRIES);
  }
}

function removeSharedLogForPlayerTurn(room, playerId, turnNumber, day) {
  if (!room || !Array.isArray(room.sharedLog)) {
    return;
  }
  const targetPlayerId = String(playerId || "");
  const targetTurn = Number(turnNumber || 0);
  const targetDay = String(day || "");
  room.sharedLog = room.sharedLog.filter((entry) => {
    const context = entry?.context && typeof entry.context === "object" ? entry.context : {};
    return !(
      String(context.playerId || "") === targetPlayerId &&
      Number(context.turnNumber || 0) === targetTurn &&
      String(context.day || "") === targetDay
    );
  });
}

function getRoomForConnection(ws) {
  if (!ws?.meta?.roomCode) {
    return null;
  }
  return rooms.get(ws.meta.roomCode) || null;
}

function isHost(room, playerId) {
  return room.hostPlayerId === playerId;
}

function getFirstOpenSeat(room) {
  const taken = new Set(room.players.map((player) => Number(player.seat)));
  for (let seat = 1; seat <= room.maxPlayers; seat += 1) {
    if (!taken.has(seat)) {
      return seat;
    }
  }
  return room.players.length + 1;
}

function createPlayer({ roomCode, seat, name, isHost, connectionId, profileId }) {
  return {
    playerId: "P" + String(seat),
    profileId: String(profileId || ""),
    name,
    seat,
    connected: true,
    connectionId,
    reconnectToken: randomId(24),
    lastSeenAt: Date.now(),
    canReconnectUntil: Date.now() + RECONNECT_WINDOW_MS,
    endedTurn: false,
    turnSummary: null,
    liveState: null,
    roomCode,
    isHost: Boolean(isHost),
  };
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let attempt = 0;
  while (attempt < 32) {
    let next = "";
    for (let index = 0; index < 6; index += 1) {
      const byte = crypto.randomBytes(1)[0];
      next += alphabet[byte % alphabet.length];
    }
    if (!rooms.has(next)) {
      return next;
    }
    attempt += 1;
  }
  return randomId(6).toUpperCase();
}

function sanitizeName(input, fallback) {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 24);
}

function sanitizeTurnSummary(summaryInput) {
  const summary = summaryInput && typeof summaryInput === "object" ? summaryInput : {};
  const actions = Array.isArray(summary.actions) ? summary.actions : [];
  return {
    completedJournals: Math.max(0, Number(summary.completedJournals || 0)),
    totalScore: Math.max(0, Number(summary.totalScore || 0)),
    payload: summary.payload && typeof summary.payload === "object" ? summary.payload : {},
    actions: actions
      .slice(0, 2000)
      .map((action) => ({
        level: String(action?.level || "info").slice(0, 16),
        message: String(action?.message || "").slice(0, 400),
        timestamp: action?.timestamp || null,
        context: action?.context && typeof action.context === "object" ? action.context : {},
        clientActionId: String(action?.clientActionId || "").slice(0, 64),
      })),
  };
}

function sanitizeSharedActions(actionsInput) {
  if (!Array.isArray(actionsInput)) {
    return [];
  }
  return actionsInput
    .slice(0, 500)
    .map((action) => ({
      level: String(action?.level || "info").slice(0, 16),
      message: String(action?.message || "").slice(0, 400),
      timestamp: action?.timestamp || null,
      context: action?.context && typeof action.context === "object" ? action.context : {},
      clientActionId: String(action?.clientActionId || "").slice(0, 64),
    }));
}

function sanitizeSingleSharedAction(actionInput) {
  if (!actionInput || typeof actionInput !== "object") {
    return null;
  }
  return {
    level: String(actionInput?.level || "info").slice(0, 16),
    message: String(actionInput?.message || "").slice(0, 400),
    timestamp: actionInput?.timestamp || null,
    context: actionInput?.context && typeof actionInput.context === "object" ? actionInput.context : {},
    clientActionId: String(actionInput?.clientActionId || "").slice(0, 64),
  };
}

function rollFiveDice() {
  return Array.from({ length: 5 }, () => crypto.randomInt(1, 7));
}

function randomId(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function send(ws, type, payload) {
  if (!ws || ws.readyState !== 1) {
    return;
  }
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload) {
  room.players.forEach((player) => {
    if (!player.connected || !player.connectionId) {
      return;
    }
    const socket = connectionsById.get(player.connectionId);
    send(socket, type, payload);
  });
}

function ensureLogPath() {
  const dir = path.dirname(ACTION_LOG_PATH);
  fs.mkdirSync(dir, { recursive: true });
}

function loadProfilesSnapshot() {
  if (!fs.existsSync(PROFILE_SNAPSHOT_PATH)) {
    return;
  }
  try {
    const raw = fs.readFileSync(PROFILE_SNAPSHOT_PATH, "utf8");
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    rows.forEach((row) => {
      const profileId = String(row?.profileId || "").trim();
      const profileToken = sanitizeProfileToken(row?.profileToken);
      if (!profileId || !profileToken) {
        return;
      }
      const profile = {
        profileId,
        profileToken,
        displayName: String(row?.displayName || "").trim().slice(0, 24),
        createdAt: Number(row?.createdAt || Date.now()),
        updatedAt: Number(row?.updatedAt || Date.now()),
        lastSeenAt: Number(row?.lastSeenAt || Date.now()),
        rooms: Array.isArray(row?.rooms)
          ? row.rooms
              .map((entry) => normalizeProfileRoomEntry(entry))
              .filter(Boolean)
              .slice(0, MAX_PROFILE_ROOM_ENTRIES)
          : [],
      };
      profilesById.set(profile.profileId, profile);
      profileIdByToken.set(profile.profileToken, profile.profileId);
    });
  } catch (_error) {}
}

function loadRoomEventHistory() {
  if (!fs.existsSync(ROOM_EVENT_LOG_PATH)) {
    return;
  }
  try {
    const raw = fs.readFileSync(ROOM_EVENT_LOG_PATH, "utf8");
    if (!raw) {
      return;
    }
    raw.split("\n").forEach((line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) {
        return;
      }
      try {
        const event = JSON.parse(trimmed);
        indexRoomHistoryEvent(event);
      } catch (_error) {}
    });
  } catch (_error) {}
}

function persistProfilesSoon() {
  if (persistProfilesTimer) {
    return;
  }
  persistProfilesTimer = setTimeout(() => {
    persistProfilesTimer = null;
    persistProfilesNow();
  }, 120);
}

function persistProfilesNow() {
  const payload = {
    version: 1,
    generatedAt: Date.now(),
    profiles: Array.from(profilesById.values()).map((profile) => ({
      profileId: profile.profileId,
      profileToken: profile.profileToken,
      displayName: profile.displayName,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastSeenAt: profile.lastSeenAt,
      rooms: Array.isArray(profile.rooms)
        ? profile.rooms
            .map((entry) => normalizeProfileRoomEntry(entry))
            .filter(Boolean)
        : [],
    })),
  };
  fs.writeFile(PROFILE_SNAPSHOT_PATH, JSON.stringify(payload, null, 2), () => {});
}

function createProfile(displayNameInput) {
  let profileId = "";
  let attempts = 0;
  while (!profileId && attempts < 64) {
    const candidate = "U" + randomId(10).toUpperCase();
    if (!profilesById.has(candidate)) {
      profileId = candidate;
      break;
    }
    attempts += 1;
  }
  if (!profileId) {
    profileId = "U" + randomId(12).toUpperCase();
  }
  const profileToken = randomId(32);
  const now = Date.now();
  const profile = {
    profileId,
    profileToken,
    displayName: sanitizeName(displayNameInput, "Player"),
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    rooms: [],
  };
  profilesById.set(profileId, profile);
  profileIdByToken.set(profileToken, profileId);
  persistProfilesSoon();
  return profile;
}

function sanitizeProfileToken(tokenInput) {
  const normalized = String(tokenInput || "").trim().toLowerCase();
  if (!/^[a-f0-9]{16,128}$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function resolveOrCreateProfile(profileTokenInput, displayNameInput) {
  const profileToken = sanitizeProfileToken(profileTokenInput);
  if (profileToken) {
    const profileId = profileIdByToken.get(profileToken);
    if (profileId && profilesById.has(profileId)) {
      const profile = profilesById.get(profileId);
      touchProfile(profile, { displayName: displayNameInput });
      return profile;
    }
  }
  return createProfile(displayNameInput);
}

function resolveProfileToken(profileIdInput) {
  const profileId = String(profileIdInput || "").trim();
  if (!profileId) {
    return "";
  }
  const profile = profilesById.get(profileId);
  return profile?.profileToken || "";
}

function touchProfile(profile, updates) {
  if (!profile) {
    return null;
  }
  const patch = updates && typeof updates === "object" ? updates : {};
  if (patch.displayName && String(patch.displayName).trim()) {
    profile.displayName = sanitizeName(patch.displayName, profile.displayName || "Player");
  }
  profile.lastSeenAt = Date.now();
  profile.updatedAt = Date.now();
  persistProfilesSoon();
  return profile;
}

function normalizeProfileRoomEntry(entryInput) {
  if (!entryInput || typeof entryInput !== "object") {
    return null;
  }
  const roomCode = String(entryInput.roomCode || "").trim().toUpperCase();
  if (!roomCode) {
    return null;
  }
  return {
    roomCode,
    playerId: String(entryInput.playerId || "").trim(),
    playerName: sanitizeName(entryInput.playerName || "Player", "Player"),
    roomStatus: String(entryInput.roomStatus || "unknown").slice(0, 32),
    connected: Boolean(entryInput.connected),
    joinedAt: Number(entryInput.joinedAt || Date.now()),
    lastSeenAt: Number(entryInput.lastSeenAt || Date.now()),
    removedByAction: String(entryInput.removedByAction || "").slice(0, 48),
  };
}

function trackProfileRoomVisit(profileIdInput, roomCodeInput, detailsInput) {
  const profileId = String(profileIdInput || "").trim();
  const roomCode = String(roomCodeInput || "").trim().toUpperCase();
  if (!profileId || !roomCode) {
    return;
  }
  const profile = profilesById.get(profileId);
  if (!profile) {
    return;
  }
  const details = detailsInput && typeof detailsInput === "object" ? detailsInput : {};
  touchProfile(profile, {
    displayName: details.playerName || profile.displayName,
  });
  if (!Array.isArray(profile.rooms)) {
    profile.rooms = [];
  }
  const now = Date.now();
  const existing = profile.rooms.find((entry) => String(entry?.roomCode || "") === roomCode);
  if (existing) {
    if (details.playerId) {
      existing.playerId = String(details.playerId);
    }
    if (details.playerName) {
      existing.playerName = sanitizeName(details.playerName, existing.playerName || profile.displayName || "Player");
    }
    if (details.roomStatus) {
      existing.roomStatus = String(details.roomStatus).slice(0, 32);
    }
    if (Object.prototype.hasOwnProperty.call(details, "connected")) {
      existing.connected = Boolean(details.connected);
    }
    if (details.removedByAction) {
      existing.removedByAction = String(details.removedByAction).slice(0, 48);
    }
    existing.lastSeenAt = now;
  } else {
    profile.rooms.push({
      roomCode,
      playerId: String(details.playerId || ""),
      playerName: sanitizeName(details.playerName || profile.displayName || "Player", "Player"),
      roomStatus: String(details.roomStatus || "active").slice(0, 32),
      connected: Object.prototype.hasOwnProperty.call(details, "connected") ? Boolean(details.connected) : true,
      joinedAt: now,
      lastSeenAt: now,
      removedByAction: String(details.removedByAction || "").slice(0, 48),
    });
  }
  profile.rooms = profile.rooms
    .map((entry) => normalizeProfileRoomEntry(entry))
    .filter(Boolean)
    .sort((a, b) => Number(b.lastSeenAt) - Number(a.lastSeenAt))
    .slice(0, MAX_PROFILE_ROOM_ENTRIES);
  persistProfilesSoon();
}

function archiveRoom(room, reason) {
  if (!room || !room.code) {
    return;
  }
  roomArchiveByCode.set(room.code, {
    code: room.code,
    status: room.status,
    finalReason: String(reason || ""),
    hostPlayerId: room.hostPlayerId,
    playerCount: Array.isArray(room.players) ? room.players.length : 0,
    createdAt: Number(room.createdAt || Date.now()),
    updatedAt: Date.now(),
    endedAt: Date.now(),
  });
}

function appendActionLog(roomCode, type, payload) {
  const payloadClone = safeClone(payload || {});
  const entry = {
    timestamp: new Date().toISOString(),
    roomCode,
    type,
    payload: payloadClone,
  };
  fs.appendFile(ACTION_LOG_PATH, JSON.stringify(entry) + "\n", () => {});
  const room = rooms.get(String(roomCode || "").toUpperCase()) || null;
  const event = createRoomHistoryEvent(room, roomCode, type, payloadClone);
  if (event) {
    indexRoomHistoryEvent(event);
    fs.appendFile(ROOM_EVENT_LOG_PATH, JSON.stringify(event) + "\n", () => {});
  }
}

function createRoomHistoryEvent(room, roomCodeInput, typeInput, payloadInput) {
  const roomCode = String(roomCodeInput || "").trim().toUpperCase();
  if (!roomCode) {
    return null;
  }
  const type = String(typeInput || "").trim();
  const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
  const actorPlayerId = inferActorPlayerId(payload);
  const actorProfileId = resolveActorProfileId(room, payload, actorPlayerId);
  const profileRefs = collectProfileRefs(room, payload, actorProfileId);
  return {
    eventId: randomId(18),
    sequence: ++roomEventSequence,
    timestamp: new Date().toISOString(),
    timestampMs: Date.now(),
    roomCode,
    type,
    actor: {
      playerId: actorPlayerId || null,
      profileId: actorProfileId || null,
    },
    profileRefs,
    payload,
  };
}

function inferActorPlayerId(payload) {
  const byPlayerId = String(payload?.byPlayerId || "").trim();
  if (byPlayerId) {
    return byPlayerId;
  }
  const playerId = String(payload?.playerId || "").trim();
  if (playerId) {
    return playerId;
  }
  return "";
}

function resolveActorProfileId(room, payload, actorPlayerId) {
  const byProfileId = String(payload?.byProfileId || "").trim();
  if (byProfileId) {
    return byProfileId;
  }
  const profileId = String(payload?.profileId || "").trim();
  if (profileId) {
    return profileId;
  }
  return resolveProfileIdForRoomPlayer(room, actorPlayerId);
}

function collectProfileRefs(room, payload, actorProfileId) {
  const refs = new Set();
  if (actorProfileId) {
    refs.add(actorProfileId);
  }
  const explicitProfileFields = [
    payload?.profileId,
    payload?.byProfileId,
  ];
  explicitProfileFields.forEach((value) => {
    const profileId = String(value || "").trim();
    if (profileId) {
      refs.add(profileId);
    }
  });
  const playerIdFields = [
    payload?.playerId,
    payload?.byPlayerId,
  ];
  if (Array.isArray(payload?.playerIds)) {
    payload.playerIds.forEach((playerId) => playerIdFields.push(playerId));
  }
  playerIdFields.forEach((value) => {
    const playerId = String(value || "").trim();
    if (!playerId) {
      return;
    }
    const profileId = resolveProfileIdForRoomPlayer(room, playerId);
    if (profileId) {
      refs.add(profileId);
    }
  });
  return Array.from(refs).filter((profileId) => profilesById.has(profileId));
}

function resolveProfileIdForRoomPlayer(room, playerIdInput) {
  const playerId = String(playerIdInput || "").trim();
  if (!room || !playerId) {
    return "";
  }
  const map = room.playerProfiles && typeof room.playerProfiles === "object" ? room.playerProfiles : {};
  if (map[playerId]) {
    return String(map[playerId]);
  }
  const player = Array.isArray(room.players) ? room.players.find((item) => item.playerId === playerId) : null;
  return String(player?.profileId || "");
}

function indexRoomHistoryEvent(eventInput) {
  const event = normalizeRoomHistoryEvent(eventInput);
  if (!event) {
    return;
  }
  roomEventSequence = Math.max(roomEventSequence, Number(event.sequence || 0));
  const roomCode = String(event.roomCode || "").toUpperCase();
  if (!roomHistoryByCode.has(roomCode)) {
    roomHistoryByCode.set(roomCode, []);
  }
  const roomEntries = roomHistoryByCode.get(roomCode);
  roomEntries.push(event);
  if (roomEntries.length > MAX_ROOM_HISTORY_ENTRIES) {
    roomEntries.splice(0, roomEntries.length - MAX_ROOM_HISTORY_ENTRIES);
  }
  const refs = Array.isArray(event.profileRefs) ? event.profileRefs : [];
  refs.forEach((profileIdInput) => {
    const profileId = String(profileIdInput || "").trim();
    if (!profileId) {
      return;
    }
    if (!profileHistoryById.has(profileId)) {
      profileHistoryById.set(profileId, []);
    }
    const profileEntries = profileHistoryById.get(profileId);
    profileEntries.push(event);
    if (profileEntries.length > MAX_PROFILE_HISTORY_ENTRIES) {
      profileEntries.splice(0, profileEntries.length - MAX_PROFILE_HISTORY_ENTRIES);
    }
  });
}

function normalizeRoomHistoryEvent(eventInput) {
  if (!eventInput || typeof eventInput !== "object") {
    return null;
  }
  const roomCode = String(eventInput.roomCode || "").trim().toUpperCase();
  if (!roomCode) {
    return null;
  }
  const rawSequence = Number(eventInput.sequence);
  const sequence = Number.isFinite(rawSequence) && rawSequence > 0
    ? Math.floor(rawSequence)
    : roomEventSequence + 1;
  return {
    eventId: String(eventInput.eventId || randomId(18)),
    sequence,
    timestamp: String(eventInput.timestamp || new Date().toISOString()),
    timestampMs: Number(eventInput.timestampMs || Date.now()),
    roomCode,
    type: String(eventInput.type || "event"),
    actor: eventInput.actor && typeof eventInput.actor === "object"
      ? {
        playerId: eventInput.actor.playerId ? String(eventInput.actor.playerId) : null,
        profileId: eventInput.actor.profileId ? String(eventInput.actor.profileId) : null,
      }
      : { playerId: null, profileId: null },
    profileRefs: Array.isArray(eventInput.profileRefs)
      ? eventInput.profileRefs
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [],
    payload: safeClone(eventInput.payload && typeof eventInput.payload === "object" ? eventInput.payload : {}),
  };
}

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return {};
  }
}

function sliceHistoryEntries(entriesInput, beforeSequence, limit) {
  const entries = Array.isArray(entriesInput) ? entriesInput : [];
  const before = Number(beforeSequence || 0);
  const filtered = before > 0
    ? entries.filter((entry) => Number(entry?.sequence || 0) < before)
    : entries.slice();
  const selected = filtered.slice(-limit);
  const nextBefore = selected.length >= limit && selected.length > 0
    ? Number(selected[0].sequence || 0)
    : null;
  return {
    events: selected,
    nextBefore,
    totalAvailable: filtered.length,
  };
}

function buildRoomHistoryPayload(roomCodeInput, beforeSequence, limit) {
  const roomCode = String(roomCodeInput || "").trim().toUpperCase();
  if (!roomCode) {
    return null;
  }
  const room = rooms.get(roomCode) || null;
  const archived = roomArchiveByCode.get(roomCode) || null;
  const history = roomHistoryByCode.get(roomCode) || [];
  if (!room && !archived && history.length === 0) {
    return null;
  }
  const slice = sliceHistoryEntries(history, beforeSequence, limit);
  return {
    ok: true,
    roomCode,
    room: room ? summarizeRoom(room) : archived,
    events: slice.events,
    nextBefore: slice.nextBefore,
    totalAvailable: slice.totalAvailable,
    serverTime: Date.now(),
  };
}

function summarizeRoom(room) {
  return {
    code: room.code,
    status: room.status,
    hostPlayerId: room.hostPlayerId,
    playerCount: Array.isArray(room.players) ? room.players.length : 0,
    maxPlayers: Number(room.maxPlayers || MAX_PLAYERS),
    createdAt: Number(room.createdAt || Date.now()),
    updatedAt: Number(room.updatedAt || Date.now()),
  };
}

function buildProfilePayload(profileTokenInput) {
  const profileToken = sanitizeProfileToken(profileTokenInput);
  if (!profileToken) {
    return null;
  }
  const profileId = profileIdByToken.get(profileToken);
  if (!profileId) {
    return null;
  }
  const profile = profilesById.get(profileId);
  if (!profile) {
    return null;
  }
  const activeRooms = listActiveRoomsForProfile(profile.profileId);
  return {
    ok: true,
    profile: {
      profileId: profile.profileId,
      displayName: profile.displayName || "Player",
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastSeenAt: profile.lastSeenAt,
    },
    activeRooms,
    recentRooms: Array.isArray(profile.rooms) ? profile.rooms.slice(0, MAX_PROFILE_ROOM_ENTRIES) : [],
    serverTime: Date.now(),
  };
}

function buildProfileHistoryPayload(profileTokenInput, beforeSequence, limit) {
  const profileToken = sanitizeProfileToken(profileTokenInput);
  if (!profileToken) {
    return null;
  }
  const profileId = profileIdByToken.get(profileToken);
  if (!profileId) {
    return null;
  }
  const profile = profilesById.get(profileId);
  if (!profile) {
    return null;
  }
  const history = profileHistoryById.get(profileId) || [];
  const slice = sliceHistoryEntries(history, beforeSequence, limit);
  return {
    ok: true,
    profile: {
      profileId: profile.profileId,
      displayName: profile.displayName || "Player",
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastSeenAt: profile.lastSeenAt,
    },
    events: slice.events,
    nextBefore: slice.nextBefore,
    totalAvailable: slice.totalAvailable,
    serverTime: Date.now(),
  };
}

function listActiveRoomsForProfile(profileIdInput) {
  const profileId = String(profileIdInput || "").trim();
  if (!profileId) {
    return [];
  }
  return Array.from(rooms.values())
    .map((room) => {
      const players = Array.isArray(room.players) ? room.players : [];
      const me = players.find((player) => String(player?.profileId || "") === profileId);
      if (!me) {
        return null;
      }
      return {
        roomCode: room.code,
        roomStatus: room.status,
        playerId: me.playerId,
        playerName: me.name,
        connected: Boolean(me.connected),
        joinedAt: Number(room.createdAt || Date.now()),
        updatedAt: Number(room.updatedAt || Date.now()),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
}

function parsePositiveInt(valueInput, fallback, minimum, maximum) {
  const parsed = Number(valueInput);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const integer = Math.floor(parsed);
  return Math.max(minimum, Math.min(maximum, integer));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(payload || {}));
}

function buildRoomDirectoryPayload() {
  const roomList = Array.from(rooms.values())
    .map((room) => ({
      code: room.code,
      status: room.status,
      playerCount: Array.isArray(room.players) ? room.players.length : 0,
      maxPlayers: Number(room.maxPlayers || MAX_PLAYERS),
      hostPlayerId: String(room.hostPlayerId || ""),
      hostName: String(
        (Array.isArray(room.players) ? room.players : []).find((player) => player.playerId === room.hostPlayerId)?.name || "Host",
      ),
      createdAt: Number(room.createdAt || Date.now()),
      updatedAt: Number(room.updatedAt || Date.now()),
      joinable:
        room.status === "lobby" &&
        Array.isArray(room.players) &&
        room.players.length < Number(room.maxPlayers || MAX_PLAYERS),
    }))
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  return {
    ok: true,
    service: "unvention-multiplayer",
    rooms: rooms.size,
    roomList,
    serverTime: Date.now(),
  };
}

function safeParseUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || "/"), "http://localhost");
  } catch (_error) {
    return null;
  }
}

function serveStaticAsset(pathnameInput, res, headOnly) {
  const pathname = String(pathnameInput || "/");
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const relativePath = normalized.replace(/^\/+/, "");
  const assetPath = path.resolve(PROJECT_ROOT, relativePath);
  if (!assetPath.startsWith(PROJECT_ROOT + path.sep) && assetPath !== PROJECT_ROOT) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    if (!headOnly) {
      res.end("Forbidden");
    } else {
      res.end();
    }
    return;
  }

  fs.stat(assetPath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      if (!headOnly) {
        res.end("Not Found");
      } else {
        res.end();
      }
      return;
    }
    const ext = path.extname(assetPath).toLowerCase();
    res.writeHead(200, {
      "content-type": getContentType(ext),
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=600",
    });
    if (headOnly) {
      res.end();
      return;
    }
    fs.createReadStream(assetPath).pipe(res);
  });
}

function getContentType(ext) {
  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }
  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }
  if (ext === ".js") {
    return "application/javascript; charset=utf-8";
  }
  if (ext === ".json") {
    return "application/json; charset=utf-8";
  }
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".pdf") {
    return "application/pdf";
  }
  return "application/octet-stream";
}

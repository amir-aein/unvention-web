const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8080);
const MAX_PLAYERS = 5;
const RECONNECT_WINDOW_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 1000;
const ACTION_LOG_PATH = path.join(__dirname, "output", "actions.ndjson");
const DAYS = ["Friday", "Saturday", "Sunday"];
const DAY_THRESHOLDS = {
  Friday: 1,
  Saturday: 2,
  Sunday: 3,
};

const rooms = new Map();
const connectionsById = new Map();

ensureLogPath();

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "unvention-multiplayer", rooms: rooms.size }));
});
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const connectionId = randomId(12);
  ws.meta = {
    connectionId,
    roomCode: null,
    playerId: null,
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
  if (type === "end_turn") {
    onEndTurn(ws, message);
    return;
  }
  if (type === "request_sync") {
    sendRoomStateToConnection(ws);
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
  const player = createPlayer({
    roomCode,
    seat: 1,
    name: playerName,
    isHost: true,
    connectionId: ws.meta.connectionId,
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
    players: [player],
  };
  rooms.set(roomCode, room);
  ws.meta.roomCode = roomCode;
  ws.meta.playerId = player.playerId;
  appendActionLog(roomCode, "create_room", { playerId: player.playerId, name: player.name });
  send(ws, "room_joined", {
    roomCode,
    playerId: player.playerId,
    reconnectToken: player.reconnectToken,
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
    if (player && !player.connected && Date.now() <= Number(player.canReconnectUntil || 0)) {
      player.connected = true;
      player.connectionId = ws.meta.connectionId;
      player.lastSeenAt = Date.now();
      player.canReconnectUntil = Date.now() + RECONNECT_WINDOW_MS;
      ws.meta.roomCode = room.code;
      ws.meta.playerId = player.playerId;
      appendActionLog(room.code, "reconnect_player", { playerId: player.playerId });
      send(ws, "room_joined", {
        roomCode: room.code,
        playerId: player.playerId,
        reconnectToken: player.reconnectToken,
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
  const player = createPlayer({
    roomCode: room.code,
    seat,
    name: sanitizeName(message?.name, "Guest"),
    isHost: false,
    connectionId: ws.meta.connectionId,
  });
  room.players.push(player);
  room.updatedAt = Date.now();
  ws.meta.roomCode = room.code;
  ws.meta.playerId = player.playerId;
  appendActionLog(room.code, "join_room", { playerId: player.playerId, name: player.name });
  send(ws, "room_joined", {
    roomCode: room.code,
    playerId: player.playerId,
    reconnectToken: player.reconnectToken,
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
  room.players.forEach((player) => {
    player.endedTurn = false;
    player.turnSummary = null;
    player.liveState = null;
  });
  room.updatedAt = Date.now();
  appendActionLog(room.code, "start_game", { byPlayerId: ws.meta.playerId, turn: room.turn });
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
  player.liveState = message?.state || null;
  player.lastSeenAt = Date.now();
  room.updatedAt = Date.now();
  appendActionLog(room.code, "player_state_update", {
    playerId: player.playerId,
    turnNumber: room.turn.number,
    day: room.turn.day,
    keys: player.liveState && typeof player.liveState === "object" ? Object.keys(player.liveState) : [],
  });
  broadcast(room, "player_state_update", {
    playerId: player.playerId,
    state: player.liveState,
    serverTime: Date.now(),
  });
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
  player.lastSeenAt = Date.now();
  room.updatedAt = Date.now();
  appendActionLog(room.code, "end_turn", {
    playerId: player.playerId,
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

function advanceTurn(room) {
  const transition = resolveDayTransition(room.turn.day, room.players);
  const previousTurn = room.turn.number;

  if (transition.gameCompleted) {
    room.status = "completed";
    room.turn.day = transition.finalDay;
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
  appendActionLog(room.code, "disconnect_player", { playerId: player.playerId });
  broadcastRoomState(room);
}

function sweepExpiredPlayers() {
  const now = Date.now();
  rooms.forEach((room) => {
    const before = room.players.length;
    room.players = room.players.filter((player) => {
      if (player.connected) {
        return true;
      }
      return now <= Number(player.canReconnectUntil || 0);
    });
    if (room.players.length !== before) {
      appendActionLog(room.code, "remove_expired_players", {
        beforeCount: before,
        afterCount: room.players.length,
      });
    }
    if (room.players.length === 0) {
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
  appendActionLog(room.code, actionType, { playerId, byPlayerId: byPlayerId || null });

  if (player.connectionId) {
    const socket = connectionsById.get(player.connectionId);
    if (socket) {
      send(socket, "removed_from_room", {
        roomCode: room.code,
        reason: actionType,
      });
      socket.meta.roomCode = null;
      socket.meta.playerId = null;
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
  appendActionLog(room.code, "terminate_room", { reason, byPlayerId: byPlayerId || null });
  room.players.forEach((player) => {
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
      ? { playerId: player.playerId, reconnectToken: player.reconnectToken, liveState: player.liveState || null }
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
    players: room.players.map((player) => ({
      playerId: player.playerId,
      name: player.name,
      seat: player.seat,
      connected: player.connected,
      endedTurn: player.endedTurn,
      lastSeenAt: player.lastSeenAt,
      canReconnectUntil: player.canReconnectUntil,
      isHost: player.playerId === room.hostPlayerId,
    })),
  };
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

function createPlayer({ roomCode, seat, name, isHost, connectionId }) {
  return {
    playerId: "P" + String(seat),
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
      })),
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

function appendActionLog(roomCode, type, payload) {
  const entry = {
    timestamp: new Date().toISOString(),
    roomCode,
    type,
    payload: payload || {},
  };
  fs.appendFile(ACTION_LOG_PATH, JSON.stringify(entry) + "\n", () => {});
}

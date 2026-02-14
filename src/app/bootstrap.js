(function bootstrap(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});
  const container = root.createContainer();
  const MAX_PERSISTED_LOG_ENTRIES = 300;
  const MAX_UNDO_SNAPSHOTS = 20;
  const MAX_PERSISTED_UNDO_SNAPSHOTS = 6;
  const MAX_SNAPSHOT_LOG_ENTRIES = 80;
  const ROLL_SPINNER_MS = 1000;
  const ROLL_RESULT_HOLD_MS = 160;
  const loggerService = container.loggerService;
  const gameStateService = container.gameStateService;
  const roundEngineService = container.roundEngineService;
  const MultiplayerClientCtor = typeof root.MultiplayerClient === "function"
    ? root.MultiplayerClient
    : class FallbackMultiplayerClient {
      connect() { return Promise.resolve(); }
      disconnect() {}
      send() { return false; }
      onMessage() { return () => {}; }
      onOpen() { return () => {}; }
      onClose() { return () => {}; }
      onError() { return () => {}; }
    };
  const multiplayerClient = new MultiplayerClientCtor();
  const MULTIPLAYER_STORAGE_KEY = "unvention.multiplayer.v1";
  const MULTIPLAYER_SESSION_KEY = "unvention.multiplayer.session.v1";
  const loadedState = gameStateService.load();
  const undoStack = Array.isArray(loadedState.undoHistory)
    ? loadedState.undoHistory
        .slice(-MAX_PERSISTED_UNDO_SNAPSHOTS)
        .map((snapshot) => ({
          state: snapshot?.state || {},
          logs: Array.isArray(snapshot?.logs)
            ? snapshot.logs.slice(-MAX_SNAPSHOT_LOG_ENTRIES)
            : [],
        }))
    : [];

  if (loadedState.logs.length > 0) {
    loggerService.replaceEntries(loadedState.logs);
  }

  loggerService.subscribe(function persistLogs() {
    const logs = loggerService
      .toSerializableEntries()
      .slice(-MAX_PERSISTED_LOG_ENTRIES);
    gameStateService.update({
      logs,
    });
  });

  root.createLogSidebar(loggerService);
  let activePlayerId = "P1";
  let multiplayerState = loadMultiplayerState();
  let waitingForRoomTurnAdvance = false;
  let appliedServerTurnKey = "";
  let localTurnActionCursor = 0;
  let awaitingRoomStateRecovery = false;
  let lastSyncedStateSignature = "";
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let inventionHover = null;
  let inventionVarietyHover = null;
  let lastAutoScrollTarget = "";
  let rollPhaseRevealTimeout = null;
  let rollPhaseAdvanceTimeout = null;
  let rollPhaseKey = "";
  let rollRevealVisibleKey = "";
  let pendingToolUnlocks = [];
  let workspaceScrollBound = false;
  let renderRecoveryInProgress = false;

  function isGameStarted(state) {
    return Boolean(state && state.gameStarted);
  }

  function loadMultiplayerState() {
    const localStorageRef = typeof globalScope.localStorage !== "undefined" ? globalScope.localStorage : null;
    const sessionStorageRef = typeof globalScope.sessionStorage !== "undefined" ? globalScope.sessionStorage : null;
    const defaults = getDefaultMultiplayerState();
    let localPart = {};
    let sessionPart = {};
    if (localStorageRef) {
      try {
        const raw = localStorageRef.getItem(MULTIPLAYER_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            localPart = {
              url: String(parsed.url || defaults.url),
              name: String(parsed.name || ""),
            };
          }
        }
      } catch (_error) {}
    }
    if (sessionStorageRef) {
      try {
        const raw = sessionStorageRef.getItem(MULTIPLAYER_SESSION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            sessionPart = {
              roomCode: String(parsed.roomCode || ""),
              playerId: String(parsed.playerId || ""),
              reconnectToken: String(parsed.reconnectToken || ""),
            };
          }
        }
      } catch (_error) {}
    }
    return {
      ...defaults,
      ...localPart,
      ...sessionPart,
    };
  }

  function getDefaultMultiplayerState() {
    return {
      url: "ws://localhost:8080",
      name: "",
      roomCode: "",
      playerId: "",
      reconnectToken: "",
      connected: false,
      connecting: false,
      room: null,
      lastError: "",
      connectionId: "",
    };
  }

  function persistMultiplayerState() {
    const localStorageRef = typeof globalScope.localStorage !== "undefined" ? globalScope.localStorage : null;
    const sessionStorageRef = typeof globalScope.sessionStorage !== "undefined" ? globalScope.sessionStorage : null;
    if (localStorageRef) {
      const localPayload = {
        url: multiplayerState.url,
        name: multiplayerState.name,
      };
      localStorageRef.setItem(MULTIPLAYER_STORAGE_KEY, JSON.stringify(localPayload));
    }
    if (sessionStorageRef) {
      const sessionPayload = {
        roomCode: multiplayerState.roomCode,
        playerId: multiplayerState.playerId,
        reconnectToken: multiplayerState.reconnectToken,
      };
      sessionStorageRef.setItem(MULTIPLAYER_SESSION_KEY, JSON.stringify(sessionPayload));
    }
  }

  function clearMultiplayerSessionIdentity() {
    multiplayerState.roomCode = "";
    multiplayerState.playerId = "";
    multiplayerState.reconnectToken = "";
    multiplayerState.room = null;
    waitingForRoomTurnAdvance = false;
    appliedServerTurnKey = "";
    localTurnActionCursor = loggerService.toSerializableEntries().length;
    awaitingRoomStateRecovery = false;
    lastSyncedStateSignature = "";
    activePlayerId = "P1";
    if (reconnectTimer) {
      globalScope.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const sessionStorageRef = typeof globalScope.sessionStorage !== "undefined" ? globalScope.sessionStorage : null;
    if (sessionStorageRef) {
      sessionStorageRef.removeItem(MULTIPLAYER_SESSION_KEY);
    }
    reconnectAttempts = 0;
  }

  function teardownMultiplayerSession(resetReason) {
    clearMultiplayerSessionIdentity();
    multiplayerState.connecting = false;
    multiplayerState.connected = false;
    multiplayerState.connectionId = "";
    multiplayerState.lastError = "";
    clearRollPhaseTimers();
    undoStack.length = 0;
    gameStateService.reset();
    persistUndoHistory();
    loggerService.replaceEntries([]);
    if (resetReason) {
      loggerService.logEvent("warn", String(resetReason), { source: "network" });
    }
    multiplayerClient.disconnect();
    persistMultiplayerState();
    renderMultiplayerUi();
    renderState();
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return;
    }
    globalScope.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleAutoReconnect() {
    clearReconnectTimer();
    if (!multiplayerState.roomCode || !multiplayerState.reconnectToken) {
      return;
    }
    if (reconnectAttempts >= 8) {
      return;
    }
    reconnectAttempts += 1;
    reconnectTimer = globalScope.setTimeout(async () => {
      await ensureMultiplayerConnection();
      if (!multiplayerState.connected) {
        scheduleAutoReconnect();
        return;
      }
      multiplayerClient.send("join_room", {
        roomCode: multiplayerState.roomCode,
        reconnectToken: multiplayerState.reconnectToken,
      });
    }, Math.min(1500 * reconnectAttempts, 5000));
  }

  function summarizeMultiplayerStatus() {
    if (multiplayerState.connecting) {
      return "Connecting...";
    }
    if (multiplayerState.connected) {
      const connectionId = multiplayerState.connectionId ? " (" + multiplayerState.connectionId + ")" : "";
      if (multiplayerState.lastError) {
        return "Connected" + connectionId + " - " + multiplayerState.lastError;
      }
      return "Connected" + connectionId;
    }
    if (multiplayerState.lastError) {
      return "Offline - " + multiplayerState.lastError;
    }
    return "Offline";
  }

  function renderMultiplayerUi() {
    const urlInput = document.getElementById("mp-url");
    const nameInput = document.getElementById("mp-name");
    const roomCodeInput = document.getElementById("mp-room-code");
    if (urlInput && document.activeElement !== urlInput) {
      urlInput.value = multiplayerState.url || "";
    }
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = multiplayerState.name || "";
    }
    if (roomCodeInput && document.activeElement !== roomCodeInput) {
      roomCodeInput.value = multiplayerState.roomCode || "";
    }

    const connectionNode = document.getElementById("mp-connection-status");
    if (connectionNode) {
      connectionNode.textContent = summarizeMultiplayerStatus();
    }
    const roomStatusNode = document.getElementById("mp-room-status");
    const room = multiplayerState.room;
    if (roomStatusNode) {
      if (!room) {
        roomStatusNode.textContent = "No room joined.";
      } else {
        const waitSuffix = room.status === "lobby"
          ? " | Waiting for host to start"
          : waitingForRoomTurnAdvance
            ? " | Waiting for all players to end turn"
            : "";
        roomStatusNode.textContent =
          "Room " + String(room.code) + " | " + String(room.status || "lobby") + " | Host " + String(room.hostPlayerId || "-") + waitSuffix;
      }
    }
    const rollNode = document.getElementById("mp-turn-roll");
    if (rollNode) {
      if (!room) {
        rollNode.textContent = "Turn: - | Roll: -";
      } else {
        const rollValues = Array.isArray(room.turn?.roll) ? room.turn.roll.join(", ") : "-";
        rollNode.textContent = "Turn: " + String(room.turn?.number || "-") + " (" + String(room.turn?.day || "-") + ") | Roll: " + rollValues;
      }
    }
    const playerList = document.getElementById("mp-player-list");
    if (playerList) {
      const players = Array.isArray(room?.players) ? room.players : [];
      playerList.innerHTML = players
        .map((player) => {
          const meTag = player.playerId === multiplayerState.playerId ? " (you)" : "";
          const hostTag = player.playerId === room?.hostPlayerId ? " [host]" : "";
          const onlineTag = player.connected ? "online" : "offline";
          const turnTag = player.endedTurn ? "ended" : "playing";
          return "<li>" + String(player.playerId) + meTag + hostTag + " - " + String(player.name || "Guest") + " - " + onlineTag + " - " + turnTag + "</li>";
        })
        .join("");
    }

    const canRoomAction = Boolean(room && multiplayerState.connected);
    const startButton = document.getElementById("mp-start-game");
    const syncButton = document.getElementById("mp-sync");
    const leaveButton = document.getElementById("mp-leave-room");
    if (startButton) {
      startButton.disabled = !canRoomAction || room.status !== "lobby" || !isLocalPlayerHost();
    }
    if (syncButton) {
      syncButton.disabled = !canRoomAction;
    }
    if (leaveButton) {
      leaveButton.disabled = !canRoomAction;
    }
    const startLocalButton = document.getElementById("start-new-game");
    if (startLocalButton) {
      startLocalButton.disabled = hasActiveMultiplayerRoom();
    }
    const resetButton = document.getElementById("reset-game");
    if (resetButton) {
      resetButton.disabled = hasActiveMultiplayerRoom() && !isLocalPlayerHost();
    }
  }

  async function ensureMultiplayerConnection() {
    if (multiplayerState.connected || multiplayerState.connecting) {
      return;
    }
    multiplayerState.connecting = true;
    multiplayerState.lastError = "";
    renderMultiplayerUi();
    try {
      await multiplayerClient.connect(multiplayerState.url);
      if (!multiplayerState.connected) {
        multiplayerState.connected = true;
        multiplayerState.connecting = false;
      }
    } catch (error) {
      multiplayerState.connecting = false;
      multiplayerState.connected = false;
      multiplayerState.lastError = String(error?.message || "connect_failed");
      loggerService.logEvent("error", "Multiplayer connection failed", { detail: multiplayerState.lastError, source: "ui" });
      renderMultiplayerUi();
    }
  }

  function hasJoinedMultiplayerRoom() {
    return Boolean(multiplayerState.room && multiplayerState.room.code && multiplayerState.room.status === "in_game");
  }

  function hasActiveMultiplayerRoom() {
    return Boolean(multiplayerState.room && multiplayerState.room.code);
  }

  function isMultiplayerGameActive() {
    return Boolean(multiplayerState.room && multiplayerState.room.status === "in_game");
  }

  function isLocalPlayerHost() {
    return Boolean(multiplayerState.room && multiplayerState.playerId &&
      multiplayerState.room.hostPlayerId === multiplayerState.playerId);
  }

  function getCurrentOnlineTurnSummary() {
    const state = roundEngineService.getState();
    const player = (state.players || []).find((item) => item.id === activePlayerId);
    return {
      completedJournals: Number(player?.completedJournals || 0),
      totalScore: Number(player?.totalScore || 0),
      payload: {
        day: state.currentDay,
        turnNumber: state.turnNumber,
        phase: state.phase,
      },
      actions: getLocalTurnDeltaActions(),
    };
  }

  function getLocalTurnDeltaActions() {
    const entries = typeof loggerService.toSerializableEntries === "function"
      ? loggerService.toSerializableEntries()
      : [];
    const slice = entries.slice(Math.max(0, localTurnActionCursor));
    return slice
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        level: String(entry.level || "info"),
        message: String(entry.message || ""),
        timestamp: entry.timestamp || null,
        context: entry.context && typeof entry.context === "object" ? entry.context : {},
      }));
  }

  function makeServerTurnKey(room) {
    const code = String(room?.code || "");
    const day = String(room?.turn?.day || "");
    const turn = String(room?.turn?.number || "");
    const roll = Array.isArray(room?.turn?.roll) ? room.turn.roll.join(",") : "";
    return [code, day, turn, roll].join("|");
  }

  function buildLocalStateSyncPayload(stateInput) {
    const state = stateInput || roundEngineService.getState();
    const payload = JSON.parse(JSON.stringify(state || {}));
    delete payload.logs;
    delete payload.undoHistory;
    if (isMultiplayerGameActive() && multiplayerState.playerId) {
      const playerId = String(multiplayerState.playerId);
      const ownPlayer = Array.isArray(payload.players)
        ? payload.players.find((player) => String(player?.id || "") === playerId)
        : null;
      payload.players = ownPlayer ? [ownPlayer] : [];
      payload.activePlayerId = playerId;
      const ownScopedMap = (input) => {
        if (!input || typeof input !== "object") {
          return {};
        }
        const value = input[playerId];
        if (typeof value === "undefined") {
          return {};
        }
        return { [playerId]: value };
      };
      payload.journalSelections = ownScopedMap(payload.journalSelections);
      payload.workshopSelections = ownScopedMap(payload.workshopSelections);
      payload.workshopPhaseContext = ownScopedMap(payload.workshopPhaseContext);
      payload.buildDrafts = ownScopedMap(payload.buildDrafts);
      payload.buildDecisions = ownScopedMap(payload.buildDecisions);
      payload.turnToolUsage = ownScopedMap(payload.turnToolUsage);
      payload.inventTransforms = ownScopedMap(payload.inventTransforms);
    }
    return payload;
  }

  function normalizeRecoveredLiveState(stateInput) {
    if (!stateInput || typeof stateInput !== "object") {
      return null;
    }
    const payload = JSON.parse(JSON.stringify(stateInput));
    const playerId = String(multiplayerState.playerId || "");
    if (!playerId) {
      return payload;
    }
    const ownPlayer = Array.isArray(payload.players)
      ? payload.players.find((player) => String(player?.id || "") === playerId)
      : null;
    payload.players = ownPlayer ? [ownPlayer] : [];
    payload.activePlayerId = playerId;
    const ownScopedMap = (input) => {
      if (!input || typeof input !== "object") {
        return {};
      }
      const value = input[playerId];
      if (typeof value === "undefined") {
        return {};
      }
      return { [playerId]: value };
    };
    payload.journalSelections = ownScopedMap(payload.journalSelections);
    payload.workshopSelections = ownScopedMap(payload.workshopSelections);
    payload.workshopPhaseContext = ownScopedMap(payload.workshopPhaseContext);
    payload.buildDrafts = ownScopedMap(payload.buildDrafts);
    payload.buildDecisions = ownScopedMap(payload.buildDecisions);
    payload.turnToolUsage = ownScopedMap(payload.turnToolUsage);
    payload.inventTransforms = ownScopedMap(payload.inventTransforms);
    return payload;
  }

  function maybePublishLocalState(stateInput) {
    if (!isMultiplayerGameActive() || !multiplayerState.connected || waitingForRoomTurnAdvance) {
      return;
    }
    const state = stateInput || roundEngineService.getState();
    const roomTurnNumber = Number(multiplayerState.room?.turn?.number || 0);
    const roomDay = String(multiplayerState.room?.turn?.day || "");
    if (Number(state.turnNumber || 0) !== roomTurnNumber || String(state.currentDay || "") !== roomDay) {
      return;
    }
    const payload = buildLocalStateSyncPayload(state);
    const signature = JSON.stringify({
      turnNumber: payload.turnNumber,
      currentDay: payload.currentDay,
      phase: payload.phase,
      journalSelections: payload.journalSelections || {},
      workshopSelections: payload.workshopSelections || {},
      buildDrafts: payload.buildDrafts || {},
      buildDecisions: payload.buildDecisions || {},
      players: payload.players || [],
    });
    if (signature === lastSyncedStateSignature) {
      return;
    }
    lastSyncedStateSignature = signature;
    multiplayerClient.send("player_state_update", {
      state: payload,
    });
  }

  function submitOnlineEndTurn() {
    if (!isMultiplayerGameActive()) {
      return false;
    }
    const sent = multiplayerClient.send("end_turn", {
      turnSummary: getCurrentOnlineTurnSummary(),
    });
    if (sent) {
      waitingForRoomTurnAdvance = true;
      loggerService.logEvent("info", "Ended turn online; waiting for other players", { source: "network" });
      renderMultiplayerUi();
      return true;
    }
    return false;
  }

  function advancePhaseForCurrentMode() {
    const state = roundEngineService.getState();
    if (!isMultiplayerGameActive()) {
      roundEngineService.advancePhase();
      return;
    }
    if (state.phase === "invent") {
      submitOnlineEndTurn();
      return;
    }
    if (state.phase === "build") {
      gameStateService.update({ phase: "invent" });
      return;
    }
    if (state.phase === "workshop") {
      gameStateService.update({ phase: "build" });
      return;
    }
    roundEngineService.advancePhase();
  }

  function syncLocalRollFromRoomTurn(room) {
    if (!room || room.status !== "in_game") {
      return;
    }
    const roll = Array.isArray(room.turn?.roll) ? room.turn.roll.map((value) => Number(value)) : [];
    if (roll.length !== 5 || typeof roundEngineService.analyzeDice !== "function") {
      return;
    }
    const analysis = roundEngineService.analyzeDice(roll);
    const state = roundEngineService.getState();
    const turnNumber = Number(room.turn?.number || state.turnNumber || 1);
    const currentDay = String(room.turn?.day || state.currentDay || "Friday");
    const existingRoll = Array.isArray(state.rollAndGroup?.dice) ? state.rollAndGroup.dice.map((value) => Number(value)) : [];
    const isSameTurn =
      Number(state.turnNumber || 0) === turnNumber &&
      String(state.currentDay || "") === currentDay;
    const hasSameRollForTurn =
      isSameTurn &&
      Number(state.rollAndGroup?.rolledAtTurn || 0) === turnNumber &&
      String(state.rollAndGroup?.rolledAtDay || "") === currentDay &&
      existingRoll.length === roll.length &&
      existingRoll.every((value, index) => Number(value) === Number(roll[index]));
    if (hasSameRollForTurn) {
      return;
    }
    const payload = {
      currentDay,
      turnNumber,
      activePlayerId,
      rollAndGroup: {
        dice: roll,
        outcomeType: analysis.outcomeType,
        groups: analysis.groups,
        rolledAtTurn: turnNumber,
        rolledAtDay: currentDay,
      },
    };
    if (!isSameTurn) {
      payload.phase = "roll_and_group";
      // In multiplayer, server turn advancement replaces local completeTurn(),
      // so clear per-turn local artifacts here to avoid carrying stale picks.
      payload.journalSelections = {};
      payload.workshopSelections = {};
      payload.workshopPhaseContext = {};
      payload.buildDrafts = {};
      payload.buildDecisions = {};
      payload.turnToolUsage = {};
      payload.inventTransforms = {};
    }
    gameStateService.update(payload);
  }

  function syncLocalGameToRoom(room) {
    if (!room || !room.code) {
      return;
    }
    if (multiplayerState.playerId) {
      activePlayerId = multiplayerState.playerId;
    }
    if (room.status !== "in_game") {
      if (gameStateService.getState().gameStarted) {
        clearRollPhaseTimers();
        undoStack.length = 0;
        gameStateService.reset();
        persistUndoHistory();
        loggerService.replaceEntries([]);
      }
      gameStateService.update({ gameStarted: false });
      waitingForRoomTurnAdvance = false;
      appliedServerTurnKey = "";
      awaitingRoomStateRecovery = false;
      lastSyncedStateSignature = "";
      return;
    }

    const state = roundEngineService.getState();
    if (String(state.activePlayerId || "") !== String(activePlayerId || "")) {
      gameStateService.update({ activePlayerId });
    }
    const hasPlayer = (state.players || []).some((player) => player.id === activePlayerId);
    if (!state.gameStarted || !hasPlayer) {
      clearRollPhaseTimers();
      undoStack.length = 0;
      gameStateService.reset();
      persistUndoHistory();
      loggerService.replaceEntries([]);
      roundEngineService.initializePlayers([activePlayerId]);
      roundEngineService.setSeed(String(room.code));
      gameStateService.update({ gameStarted: true, activePlayerId });
      localTurnActionCursor = loggerService.toSerializableEntries().length;
    }
    const incomingTurnKey = makeServerTurnKey(room);
    const turnChanged = incomingTurnKey !== appliedServerTurnKey;
    if (turnChanged) {
      syncLocalRollFromRoomTurn(room);
      appliedServerTurnKey = incomingTurnKey;
      waitingForRoomTurnAdvance = false;
      localTurnActionCursor = loggerService.toSerializableEntries().length;
      lastSyncedStateSignature = "";
    }
    const me = (room.players || []).find((item) => item.playerId === multiplayerState.playerId);
    if (me) {
      waitingForRoomTurnAdvance = Boolean(me.endedTurn);
    }
  }

  multiplayerClient.onOpen(() => {
    clearReconnectTimer();
    reconnectAttempts = 0;
    multiplayerState.connecting = false;
    multiplayerState.connected = true;
    multiplayerState.lastError = "";
    renderMultiplayerUi();
    loggerService.logEvent("info", "Connected to multiplayer server", { url: multiplayerState.url, source: "ui" });
  });

  multiplayerClient.onClose(() => {
    multiplayerState.connecting = false;
    multiplayerState.connected = false;
    multiplayerState.connectionId = "";
    renderMultiplayerUi();
    loggerService.logEvent("warn", "Disconnected from multiplayer server", { source: "ui" });
    scheduleAutoReconnect();
  });

  multiplayerClient.onError(() => {
    multiplayerState.connecting = false;
    multiplayerState.connected = false;
    if (!multiplayerState.lastError) {
      multiplayerState.lastError = "socket_error";
    }
    renderMultiplayerUi();
  });

  multiplayerClient.onMessage((message) => {
    const type = String(message?.type || "");
    if (type === "connected") {
      multiplayerState.connectionId = String(message.connectionId || "");
      renderMultiplayerUi();
      return;
    }
    if (type === "room_joined") {
      multiplayerState.lastError = "";
      multiplayerState.roomCode = String(message.roomCode || "");
      multiplayerState.playerId = String(message.playerId || "");
      activePlayerId = multiplayerState.playerId || activePlayerId;
      multiplayerState.reconnectToken = String(message.reconnectToken || "");
      appliedServerTurnKey = "";
      awaitingRoomStateRecovery = true;
      persistMultiplayerState();
      gameStateService.update({ gameStarted: false });
      renderMultiplayerUi();
      loggerService.logEvent("info", "Joined multiplayer room", {
        roomCode: multiplayerState.roomCode,
        playerId: multiplayerState.playerId,
        source: "ui",
      });
      return;
    }
    if (type === "room_state") {
      multiplayerState.lastError = "";
      multiplayerState.room = message.room || null;
      if (message?.you?.playerId) {
        multiplayerState.playerId = String(message.you.playerId);
        activePlayerId = multiplayerState.playerId || activePlayerId;
      }
      if (message?.you?.reconnectToken) {
        multiplayerState.reconnectToken = String(message.you.reconnectToken);
      }
      const incomingLiveState = message?.you?.liveState && typeof message.you.liveState === "object"
        ? message.you.liveState
        : null;
      persistMultiplayerState();
      if (awaitingRoomStateRecovery && incomingLiveState) {
        const recoveredState = normalizeRecoveredLiveState(incomingLiveState);
        const roomTurn = Number(multiplayerState.room?.turn?.number || 0);
        const roomDay = String(multiplayerState.room?.turn?.day || "");
        if (
          Number(recoveredState?.turnNumber || 0) === roomTurn &&
          String(recoveredState?.currentDay || "") === roomDay
        ) {
          gameStateService.setState(recoveredState);
          awaitingRoomStateRecovery = false;
        }
      }
      syncLocalGameToRoom(multiplayerState.room);
      renderMultiplayerUi();
      renderState();
      return;
    }
    if (type === "turn_advanced") {
      waitingForRoomTurnAdvance = false;
      if (multiplayerState.room && multiplayerState.room.code === message.roomCode) {
        const normalizedPlayers = Array.isArray(multiplayerState.room.players)
          ? multiplayerState.room.players.map((player) => ({
            ...player,
            endedTurn: false,
          }))
          : [];
        multiplayerState.room = {
          ...multiplayerState.room,
          status: "in_game",
          players: normalizedPlayers,
          turn: {
            number: Number(message.turnNumber || multiplayerState.room.turn?.number || 1),
            day: String(message.day || multiplayerState.room.turn?.day || "Friday"),
            roll: Array.isArray(message.roll) ? message.roll : multiplayerState.room.turn?.roll || null,
            rolledAt: Date.now(),
          },
        };
      }
      syncLocalGameToRoom(multiplayerState.room);
      loggerService.logEvent("info", "Online turn advanced", {
        roomCode: message.roomCode,
        day: message.day,
        turnNumber: message.turnNumber,
        roll: message.roll,
        source: "network",
      });
      return;
    }
    if (type === "game_completed") {
      waitingForRoomTurnAdvance = false;
      if (multiplayerState.room && multiplayerState.room.code === message.roomCode) {
        multiplayerState.room = {
          ...multiplayerState.room,
          status: "completed",
        };
      }
      loggerService.logEvent("info", "Online game completed", {
        roomCode: message.roomCode,
        finalDay: message.finalDay,
        source: "network",
      });
      renderMultiplayerUi();
      return;
    }
    if (type === "removed_from_room") {
      teardownMultiplayerSession("Removed from multiplayer room (" + String(message.reason || "unknown") + ")");
      return;
    }
    if (type === "room_terminated") {
      teardownMultiplayerSession(
        "Room terminated by host (" +
          String(message.roomCode || "") +
          (message.reason ? ", " + String(message.reason) : "") +
          ")",
      );
      return;
    }
    if (type === "error") {
      const code = String(message.code || "server_error");
      const detail = String(message.message || code);
      if (code === "room_not_found" || code === "room_full" || code === "room_in_progress" || code === "turn_mismatch") {
        clearMultiplayerSessionIdentity();
      }
      multiplayerState.lastError = detail;
      renderMultiplayerUi();
      loggerService.logEvent("warn", "Multiplayer server error", { code, detail, source: "network" });
    }
  });

  function setGameSurfaceVisibility(started) {
    const newGameScreen = document.getElementById("new-game-screen");
    const appShell = document.getElementById("app-shell");
    const footer = document.getElementById("action-footer");
    const showGameSurface = Boolean(started || hasActiveMultiplayerRoom());
    if (newGameScreen && newGameScreen.style) {
      newGameScreen.style.display = showGameSurface ? "none" : "grid";
    }
    if (appShell && appShell.style) {
      appShell.style.display = showGameSurface ? "grid" : "none";
    }
    if (footer && footer.style) {
      footer.style.display = showGameSurface ? "grid" : "none";
    }
  }

  function recoverFromRenderCrash(error) {
    if (renderRecoveryInProgress) {
      return;
    }
    renderRecoveryInProgress = true;
    try {
      clearRollPhaseTimers();
      undoStack.length = 0;
      loggerService.clear();
      gameStateService.reset();
      roundEngineService.initializePlayers(["P1"]);
      loggerService.logEvent(
        "error",
        "Recovered from a corrupted session after a render failure; returned to New Game",
        {
          source: "system",
          detail: String(error?.message || error),
        },
      );
      setGameSurfaceVisibility(false);
    } catch (recoveryError) {
      if (typeof globalScope.console !== "undefined" && typeof globalScope.console.error === "function") {
        globalScope.console.error("Render recovery failed", recoveryError);
      }
    } finally {
      renderRecoveryInProgress = false;
    }
  }

  function createSnapshot() {
    const snapshotState = gameStateService.getState();
    delete snapshotState.undoHistory;
    return {
      state: snapshotState,
      logs: loggerService
        .toSerializableEntries()
        .slice(-MAX_SNAPSHOT_LOG_ENTRIES),
    };
  }

  function persistUndoHistory() {
    const compactUndoHistory = undoStack
      .slice(-MAX_PERSISTED_UNDO_SNAPSHOTS)
      .map((snapshot) => ({
        state: snapshot.state,
        logs: Array.isArray(snapshot.logs)
          ? snapshot.logs.slice(-MAX_SNAPSHOT_LOG_ENTRIES)
          : [],
      }));
    gameStateService.update({
      undoHistory: compactUndoHistory,
    });
  }

  function pushUndoSnapshot() {
    undoStack.push(createSnapshot());
    if (undoStack.length > MAX_UNDO_SNAPSHOTS) {
      undoStack.splice(0, undoStack.length - MAX_UNDO_SNAPSHOTS);
    }
    persistUndoHistory();
  }

  function runWithUndo(action) {
    pushUndoSnapshot();
    action();
  }

  function runWithoutUndo(action) {
    action();
  }

  function setBuildDecision(value) {
    const state = roundEngineService.getState();
    const next = { ...(state.buildDecisions || {}) };
    next[activePlayerId] = value;
    gameStateService.update({ buildDecisions: next });
  }

  function canAdvancePhase(state) {
    if (state.gameStatus === "completed") {
      return false;
    }
    if (state.phase === "roll_and_group") {
      return true;
    }
    if (state.phase === "build") {
      return true;
    }
    if (state.phase !== "journal") {
      return true;
    }
    if (hasPendingJournalIdeaFromState(state)) {
      return false;
    }
    if (state.rollAndGroup?.outcomeType === "quantum_leap") {
      return true;
    }
    const selection = state.journalSelections?.[activePlayerId];
    if (!selection?.selectedGroupKey) {
      return false;
    }
    return Number(selection.placementsThisTurn || 0) >= 1;
  }

  function hasPendingJournalIdeaFromState(state) {
    const player = (state.players || []).find((item) => item.id === activePlayerId);
    if (!player) {
      return false;
    }
    return (player.journals || []).some(
      (journal) => journal.ideaStatus === "completed" && !journal.ideaAssignedToInventionId,
    );
  }

  function getFooterHint(state) {
    if (state.gameStatus === "completed") {
      return "Game completed.";
    }

    if (state.phase === "journal") {
      return "";
    }

    if (state.phase === "workshop") {
      return "Workshop phase.";
    }

    if (state.phase === "build") {
      return "";
    }

    return "Invent phase.";
  }

  function getNextPhaseLabel(state) {
    if (state.gameStatus === "completed") {
      return "Game Completed";
    }
    const phaseLabels = {
      roll_and_group: "Skip",
      journal: "Go to Workshopping",
      workshop: "Go to Build",
      build: "Go to Invent",
      invent: "End Turn",
    };
    return phaseLabels[state.phase] || "Next Phase";
  }

  function getPhaseExpectation(state) {
    if (!state || state.gameStatus === "completed") {
      return "Game completed.";
    }
    if (pendingToolUnlocks.length > 0) {
      return "";
    }
    const pendingJournalIdeas = typeof roundEngineService.getPendingJournalIdeaJournals === "function"
      ? roundEngineService.getPendingJournalIdeaJournals(activePlayerId)
      : [];
    const buildDecision = state.buildDecisions?.[activePlayerId] || "";
    if (state.phase === "roll_and_group") {
      return "Rolling and grouping dice automatically.";
    }
    if (state.phase === "journal") {
      if (pendingJournalIdeas.length > 0) {
        return "You got an Idea from completing a journal, use it in an invention.";
      }
      return "Choose a group of dice to use in a journal.";
    }
    if (state.phase === "workshop") {
      return "Get parts";
    }
    if (state.phase === "build") {
      if (buildDecision !== "accepted") {
        return "Build a mechanism?";
      }
      return "Select parts to build a mechanism.";
    }
    if (state.phase === "invent") {
      return "Use mechanism in one of your inventions.";
    }
    return "Proceed with the current phase.";
  }

  function renderPhaseExpectation(state) {
    const node = document.getElementById("phase-expectation");
    if (!node) {
      return;
    }
    node.textContent = getPhaseExpectation(state);
  }

  function renderPhaseBreadcrumb(currentPhase) {
    const breadcrumb = document.getElementById("footer-breadcrumb");
    if (!breadcrumb) {
      return;
    }
    const phases = roundEngineService.getPhases();
    const state = roundEngineService.getState();
    const currentDay = state.currentDay || "Friday";
    const currentSeed = state.rngSeed || "default-seed";
    const currentTurn = "Turn " + String(state.turnNumber || 1);
    const crumbs = [currentSeed, currentDay, currentTurn]
      .concat(phases.map((phase) => phase.replaceAll("_", " ")))
      .map(function toCrumb(label, index) {
        const isActive = index > 2 && phases[index - 3] === currentPhase;
        return '<span class="action-footer__crumb' + (isActive ? " action-footer__crumb--active" : "") + '">' + label + "</span>";
      });
    breadcrumb.innerHTML = crumbs.join('<span class="action-footer__separator">&gt;</span>');
  }

  function renderFooterWrenchCount(state) {
    const wrenchCounter = document.getElementById("footer-wrench-count");
    if (!wrenchCounter) {
      return;
    }
    const available = typeof roundEngineService.getAvailableWrenches === "function"
      ? roundEngineService.getAvailableWrenches(activePlayerId)
      : 0;
    wrenchCounter.textContent = "🔧 " + String(available) + " wrenches";
    const scoreCounter = document.getElementById("footer-total-score");
    if (scoreCounter) {
      const player = (state.players || []).find((item) => item.id === activePlayerId);
      const totalScore = player ? Number(player.totalScore || 0) : 0;
      scoreCounter.textContent = "★ " + String(totalScore) + " score";
      if (typeof scoreCounter.setAttribute === "function") {
        scoreCounter.setAttribute("title", getTotalScoreTooltip(player));
      }
    }
  }

  function getTotalScoreTooltip(player) {
    if (!player) {
      return "No score data available.";
    }
    const inventions = Array.isArray(player.inventions) ? player.inventions : [];
    const presented = inventions.filter((item) => Boolean(item.presentedDay));
    if (presented.length === 0) {
      return "No presented inventions yet. Score is counted at end of each day.";
    }
    const lines = ["Score breakdown:"];
    const byDay = new Map();
    presented.forEach((invention) => {
      const points = Number(invention.scoring?.total || 0);
      const day = String(invention.presentedDay);
      byDay.set(day, Number(byDay.get(day) || 0) + points);
      lines.push(invention.name + " (" + day + "): " + String(points));
    });
    byDay.forEach((points, day) => {
      lines.push(day + " subtotal: " + String(points));
    });
    lines.push("Total: " + String(Number(player.totalScore || 0)));
    return lines.join("\n");
  }

  function renderRoundRoll(state) {
    const container = document.getElementById("round-roll-container");
    if (!container) {
      return;
    }
    const dice = Array.isArray(state.rollAndGroup?.dice) ? state.rollAndGroup.dice : [];
    const groups = Array.isArray(state.rollAndGroup?.groups) ? state.rollAndGroup.groups : [];
    const outcomeType = String(state.rollAndGroup?.outcomeType || "");
    if (dice.length === 0) {
      container.innerHTML = "<span class='journal-muted'>Waiting for roll and group phase.</span>";
      container.className = "round-roll-container";
      return;
    }
    const rollKey = String(state.rollAndGroup?.rolledAtDay || "") + ":" + String(state.rollAndGroup?.rolledAtTurn || "");
    const waitingForReveal = state.phase === "roll_and_group" && rollRevealVisibleKey !== rollKey;
    if (waitingForReveal) {
      container.innerHTML =
        '<span class="round-roll-spinner" aria-hidden="true"></span>' +
        "<span class='journal-muted'>Rolling and grouping outcomes...</span>";
      container.className = "round-roll-container round-roll-container--pending";
      return;
    }
    const diceChips = dice
      .map((value) => '<span class="round-roll-chip">' + String(value) + "</span>")
      .join("");
    const groupChips = groups
      .map((group) => '<span class="round-roll-chip">' + (Array.isArray(group) ? group.join(", ") : "") + "</span>")
      .join("");
    container.innerHTML =
      '<span class="journal-muted">Dice:</span>' +
      diceChips +
      '<span class="journal-muted">Groups:</span>' +
      '<span class="round-roll-groups">' +
      groupChips +
      "</span>" +
      '<span class="journal-muted">Outcome:</span>' +
      '<span class="round-roll-chip">' +
      outcomeType.replaceAll("_", " ") +
      "</span>";
    container.className = "round-roll-container";
  }

  function getActiveAnchorIdForPhase(phase) {
    if (phase === "roll_and_group") {
      return "round-roll-panel";
    }
    if (phase === "journal") {
      return "journals-panel";
    }
    if (phase === "workshop" || phase === "build") {
      return "workshops-panel";
    }
    if (phase === "invent") {
      return "inventions-panel";
    }
    return "";
  }

  function renderActiveAnchorStateBySection(activeSectionId) {
    const nav = typeof document.querySelector === "function"
      ? document.querySelector(".workspace-nav")
      : null;
    if (!nav || typeof nav.querySelectorAll !== "function") {
      return;
    }
    nav.querySelectorAll("a[href^='#']").forEach((link) => {
      const href = String(link.getAttribute("href") || "");
      const isActive = href === "#" + activeSectionId;
      link.classList.toggle("workspace-nav__link--active", isActive);
    });
  }

  function updateActiveAnchorFromScroll() {
    const workspace = typeof document.querySelector === "function"
      ? document.querySelector(".workspace")
      : null;
    if (!workspace) {
      return;
    }
    const ids = ["round-roll-panel", "journals-panel", "workshops-panel", "inventions-panel", "tools-panel"];
    const workspaceRect = workspace.getBoundingClientRect();
    const pivotY = workspaceRect.top + 170;
    let bestId = ids[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    ids.forEach((id) => {
      const section = document.getElementById(id);
      if (!section || typeof section.getBoundingClientRect !== "function") {
        return;
      }
      const rect = section.getBoundingClientRect();
      const distance = Math.abs(rect.top - pivotY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = id;
      }
    });
    renderActiveAnchorStateBySection(bestId);
  }

  function generateRandomSeed() {
    return "seed-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function maybeAutoAdvanceAfterJournalProgress() {
    const state = roundEngineService.getState();
    if (state.phase !== "journal") {
      return;
    }
    if (state.rollAndGroup?.outcomeType === "quantum_leap") {
      return;
    }
    const selection = state.journalSelections?.[activePlayerId];
    const placements = Number(selection?.placementsThisTurn || 0);
    const remainingNumbers = Array.isArray(selection?.remainingNumbers)
      ? selection.remainingNumbers
      : [];
    if (placements >= 1 && remainingNumbers.length === 0) {
      advancePhaseForCurrentMode();
    }
  }

  function maybeAutoSelectSingleWorkshopGroup() {
    const state = roundEngineService.getState();
    if (state.phase !== "workshop") {
      return;
    }
    const selection = state.workshopSelections?.[activePlayerId];
    if (selection?.selectedGroupKey) {
      return;
    }
    const options = roundEngineService.getWorkshoppingOptions(activePlayerId);
    if (options.length === 1) {
      roundEngineService.selectWorkshoppingGroup(activePlayerId, options[0].key);
    }
  }

  function maybeAutoAdvanceAfterWorkshopProgress() {
    const state = roundEngineService.getState();
    if (state.phase !== "workshop") {
      return;
    }
    const selection = state.workshopSelections?.[activePlayerId];
    const remainingNumbers = Array.isArray(selection?.remainingNumbers) ? selection.remainingNumbers : [];
    const placements = Number(selection?.placementsThisTurn || 0);
    if (placements >= 1 && remainingNumbers.length === 0) {
      advancePhaseForCurrentMode();
    }
  }

  function maybeAutoSkipEmptyInventPhase(state) {
    if (state.phase !== "invent") {
      return false;
    }
    if (isMultiplayerGameActive()) {
      return false;
    }
    if (state.gameStatus === "completed") {
      return false;
    }
    const pendingMechanism = typeof roundEngineService.getPendingMechanismForInvent === "function"
      ? roundEngineService.getPendingMechanismForInvent(activePlayerId)
      : null;
    if (pendingMechanism) {
      return false;
    }
    const beforeKey = String(state.currentDay) + ":" + String(state.turnNumber) + ":" + String(state.phase) + ":" + String(state.gameStatus);
    const advanced = roundEngineService.advancePhase();
    const afterKey = String(advanced?.currentDay) + ":" + String(advanced?.turnNumber) + ":" + String(advanced?.phase) + ":" + String(advanced?.gameStatus);
    return afterKey !== beforeKey;
  }

  function renderState() {
    try {
      renderMultiplayerUi();
      const state = roundEngineService.getState();
      const started = isGameStarted(state);
      setGameSurfaceVisibility(started);
      if (!started) {
        clearRollPhaseTimers();
        lastAutoScrollTarget = "";
        pendingToolUnlocks = [];
        if (hasActiveMultiplayerRoom()) {
          renderPhaseBreadcrumb("roll_and_group");
          const expectation = document.getElementById("phase-expectation");
          if (expectation) {
            expectation.textContent = "Lobby: waiting for host to start";
          }
          renderPhaseControls(state);
          const rollContainer = document.getElementById("round-roll-container");
          if (rollContainer) {
            rollContainer.innerHTML = "<div class='journal-muted'>Room is in lobby. Start game when everyone has joined.</div>";
          }
          const journalsContainer = document.getElementById("journals-container");
          if (journalsContainer) {
            journalsContainer.innerHTML = "";
          }
          const workshopsContainer = document.getElementById("workshops-container");
          if (workshopsContainer) {
            workshopsContainer.innerHTML = "";
          }
          const inventionsContainer = document.getElementById("inventions-container");
          if (inventionsContainer) {
            inventionsContainer.innerHTML = "";
          }
          const toolsPanel = document.getElementById("tools-panel");
          if (toolsPanel) {
            toolsPanel.innerHTML = "<h2>Tools</h2><p class='tools-placeholder'>Tools unlock after the game starts.</p>";
          }
          const summary = document.getElementById("player-state-summary");
          if (summary) {
            summary.innerHTML = "<p>Multiplayer room joined.</p><p>Waiting in lobby.</p>";
          }
        }
        return;
      }
      if (typeof roundEngineService.ensurePlayerInventions === "function") {
        roundEngineService.ensurePlayerInventions();
      }
      maybeAutoSelectSingleWorkshopGroup();
      let withAutoWorkshopState = roundEngineService.getState();
      if (maybeAutoSkipEmptyInventPhase(withAutoWorkshopState)) {
        renderState();
        return;
      }
      maybeAutoResolveRollPhase(withAutoWorkshopState);
      withAutoWorkshopState = roundEngineService.getState();
      if (withAutoWorkshopState.phase !== "invent") {
        inventionHover = null;
        inventionVarietyHover = null;
      }
      const p1 = (withAutoWorkshopState.players || []).find((player) => player.id === activePlayerId);
      renderPhaseBreadcrumb(withAutoWorkshopState.phase);
      renderFooterWrenchCount(withAutoWorkshopState);
      renderPhaseExpectation(withAutoWorkshopState);
      const advanceButton = document.getElementById("advance-phase");
      const nextPhaseLabel = getNextPhaseLabel(withAutoWorkshopState);
      if (advanceButton) {
        advanceButton.textContent = "Skip";
        if (typeof advanceButton.setAttribute === "function") {
          advanceButton.setAttribute("title", nextPhaseLabel);
        }
        advanceButton.style.display = "none";
      }
      let disableAdvance = !canAdvancePhase(withAutoWorkshopState);
      if (advanceButton) {
        if (withAutoWorkshopState.phase === "roll_and_group") {
          disableAdvance = true;
        }
        if (withAutoWorkshopState.phase === "build") {
          const decision = withAutoWorkshopState.buildDecisions?.[activePlayerId] || "";
          const draft = withAutoWorkshopState.buildDrafts?.[activePlayerId];
          if (decision !== "accepted" && (!Array.isArray(draft?.path) || draft.path.length === 0)) {
            disableAdvance = true;
          }
        }
        if (withAutoWorkshopState.phase === "invent") {
          disableAdvance = true;
        }
        advanceButton.disabled = disableAdvance;
      }
      const undoButton = document.getElementById("undo-action");
      if (undoButton) {
        undoButton.disabled = undoStack.length === 0;
      }
      renderPhaseControls(withAutoWorkshopState);
      renderPlayerStatePanel(withAutoWorkshopState, p1);
      renderRoundRoll(withAutoWorkshopState);
      renderJournals(withAutoWorkshopState, p1);
      renderWorkshops(withAutoWorkshopState, p1);
      renderInventions(withAutoWorkshopState, p1);
      renderToolsPanel(withAutoWorkshopState, p1);
      maybeAutoScrollToPhaseSection(withAutoWorkshopState);
      updateActiveAnchorFromScroll();
      maybePublishLocalState(withAutoWorkshopState);
      renderMultiplayerUi();
    } catch (error) {
      recoverFromRenderCrash(error);
    }
  }

  function getSectionIdForPhase(phase) {
    const state = roundEngineService.getState();
    if (pendingToolUnlocks.length > 0) {
      return "tools-panel";
    }
    const pendingIdeas = typeof roundEngineService.getPendingJournalIdeaJournals === "function"
      ? roundEngineService.getPendingJournalIdeaJournals(activePlayerId)
      : [];
    if (phase === "journal" && pendingIdeas.length > 0) {
      return "inventions-panel";
    }
    const journalSelection = state.journalSelections?.[activePlayerId];
    if (phase === "journal" && !journalSelection?.selectedGroupKey) {
      return "round-roll-panel";
    }
    if (phase === "roll_and_group") {
      return "round-roll-panel";
    }
    if (phase === "journal") {
      return "journals-panel";
    }
    if (phase === "workshop" || phase === "build") {
      return "workshops-panel";
    }
    if (phase === "invent") {
      return "inventions-panel";
    }
    return "";
  }

  function scrollWorkspaceToSection(sectionId) {
    const workspace = typeof document.querySelector === "function"
      ? document.querySelector(".workspace")
      : null;
    const section = document.getElementById(sectionId);
    if (!workspace || !section) {
      return;
    }
    const header = workspace.querySelector(".workspace-head");
    const headerHeight = header && typeof header.getBoundingClientRect === "function"
      ? Math.ceil(header.getBoundingClientRect().height)
      : 0;
    const topPadding = 10;
    const targetTop = Math.max(0, section.offsetTop - headerHeight - topPadding);
    if (typeof workspace.scrollTo === "function") {
      workspace.scrollTo({
        top: targetTop,
        behavior: "smooth",
      });
    }
  }

  function maybeAutoScrollToPhaseSection(state) {
    const nextSectionId = getSectionIdForPhase(state.phase);
    if (!nextSectionId) {
      return;
    }
    if (lastAutoScrollTarget === nextSectionId) {
      return;
    }
    lastAutoScrollTarget = nextSectionId;
    scrollWorkspaceToSection(nextSectionId);
  }

  function renderPhaseControls(state) {
    const controls = document.getElementById("journal-controls");
    if (!controls) {
      return;
    }

    if (!isGameStarted(state) && hasActiveMultiplayerRoom()) {
      const room = multiplayerState.room || {};
      const players = Array.isArray(room.players) ? room.players : [];
      const playerNames = players
        .map((player) => String(player.name || player.playerId || "Guest"))
        .join(", ");
      const canHostStart = isLocalPlayerHost() && room.status === "lobby" && players.length >= 1;
      const hostControls = isLocalPlayerHost()
        ? (
            '<button type="button" class="journal-chip journal-chip--group" data-action="mp-start-lobby"' +
            (canHostStart ? "" : " disabled") +
            ">Start Game</button>" +
            '<button type="button" class="journal-chip" data-action="mp-cancel-room">Cancel Room</button>'
          )
        : "<span class='journal-muted'>Waiting for host to start.</span>";
      controls.innerHTML =
        "<div class='journal-control-row'><strong>Room " + String(room.code || "-") + "</strong></div>" +
        "<div class='journal-control-row'><span class='journal-muted'>Players: " + (playerNames || "none") + "</span></div>" +
        "<div class='journal-control-row'>" + hostControls + "</div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    if (state.phase !== "roll_and_group" && state.phase !== "journal" && state.phase !== "workshop" && state.phase !== "build" && state.phase !== "invent") {
      controls.innerHTML = "";
      if (controls.style) {
        controls.style.display = "none";
      }
      return;
    }

    if (pendingToolUnlocks.length > 0) {
      const title = pendingToolUnlocks.length === 1
        ? String(pendingToolUnlocks[0]?.name || "Tool") + " unlocked"
        : "Tools unlocked";
      const message = pendingToolUnlocks
        .map((tool) => {
          const ability = String(tool?.abilityText || "").trim();
          return ability || "";
        })
        .filter((text) => text.length > 0)
        .join(" ");
      controls.innerHTML =
        "<div class='journal-control-row'><strong>" + title + "</strong></div>" +
        "<div class='journal-control-row journal-control-row--tool-unlock'><span>" +
        (message || "No tool description available.") +
        "</span></div>" +
        '<div class="journal-control-row">' +
        '<button type="button" class="journal-chip journal-chip--group" data-action="confirm-tool-unlock">Confirm</button>' +
        "</div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    if (state.phase === "roll_and_group") {
      controls.innerHTML =
        "<div class='journal-control-row'>" +
        "<span class='journal-muted'>Rolling and grouping outcomes...</span>" +
        "</div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    if (state.phase === "invent") {
      const pendingMechanism = typeof roundEngineService.getPendingMechanismForInvent === "function"
        ? roundEngineService.getPendingMechanismForInvent(activePlayerId)
        : null;
      const inventShape = typeof roundEngineService.getPendingMechanismInventShape === "function"
        ? roundEngineService.getPendingMechanismInventShape(activePlayerId)
        : { points: [], rotation: 0, mirrored: false, toolActive: false };
      const shapePreview = renderInventOrientationShape(inventShape.points || []);
      const orientationControls = inventShape.toolActive
        ? (
            '<div class="journal-control-row invent-orientation-row">' +
            '<button type="button" class="journal-chip" data-action="invent-rotate-cw">↻</button>' +
            shapePreview +
            '<button type="button" class="journal-chip" data-action="invent-rotate-ccw">↺</button>' +
            '<button type="button" class="journal-chip" data-action="invent-mirror">Mirror</button>' +
            '<button type="button" class="journal-chip journal-chip--group" data-action="invent-confirm">Confirm</button>' +
            '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
            "</div>" +
            ""
          )
        : "";
      const endTurnAction = isMultiplayerGameActive()
        ? '<button type="button" class="journal-chip journal-chip--group" data-action="invent-end-turn">End Turn</button>'
        : '<button type="button" class="journal-chip journal-chip--group" data-action="invent-confirm">Confirm</button>';
      controls.innerHTML = pendingMechanism
        ? "<div class='journal-control-row'><span class='journal-muted'>Click an invention pattern to place " +
          String(pendingMechanism.id) +
          " (" +
          String(Array.isArray(pendingMechanism.path) ? pendingMechanism.path.length : 0) +
          " parts.</span></div>" +
          orientationControls +
          (inventShape.toolActive
            ? ""
            : (
                '<div class="journal-control-row">' +
                endTurnAction +
                '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
                "</div>"
              ))
        : (
            "<div class='journal-control-row'><span class='journal-muted'>No mechanism available to invent.</span></div>" +
            (isMultiplayerGameActive()
              ? '<div class="journal-control-row">' + endTurnAction + "</div>"
              : "")
          );
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    if (state.phase === "build") {
      const player = (state.players || []).find((item) => item.id === activePlayerId);
      const availableWrenches =
        typeof roundEngineService.getAvailableWrenches === "function"
          ? roundEngineService.getAvailableWrenches(activePlayerId)
          : 0;
      const buildCost =
        typeof roundEngineService.getBuildCost === "function"
          ? roundEngineService.getBuildCost(activePlayerId)
          : 2;
      const draft = state.buildDrafts?.[activePlayerId];
      const builtThisTurn =
        Boolean(player) &&
        player.lastBuildAtTurn === state.turnNumber &&
        player.lastBuildAtDay === state.currentDay;
      const buildDecision = state.buildDecisions?.[activePlayerId] || "";
      if (!builtThisTurn && buildDecision !== "accepted" && (!Array.isArray(draft?.path) || draft.path.length === 0)) {
        controls.innerHTML =
          '<div class="journal-control-row">' +
          '<button type="button" class="journal-chip journal-chip--group" data-action="build-accept">Build</button>' +
          '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
          "</div>";
        if (controls.style) {
          controls.style.display = "grid";
        }
        return;
      }
      const canFinish =
        !builtThisTurn &&
        availableWrenches >= buildCost &&
        Array.isArray(draft?.path) &&
        draft.path.length >= 2;
      controls.innerHTML =
        (Array.isArray(draft?.path)
          ? '<div class="journal-control-row"><span class="journal-chip">Draft ' + String(draft.path.length) + " parts</span></div>"
          : "") +
        '<div class="journal-control-row">' +
        '<button type="button" class="journal-chip journal-chip--group" data-action="finish-building" ' +
        (canFinish ? "" : "disabled") +
        ">Finish Building</button>" +
        '<button type="button" class="journal-chip" data-action="clear-build-draft" ' +
        (Array.isArray(draft?.path) && draft.path.length > 0 ? "" : "disabled") +
        ">Clear Draft</button>" +
        '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
        "</div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    if (state.phase === "workshop") {
      const selection = state.workshopSelections?.[activePlayerId];
      const options = roundEngineService.getWorkshoppingOptions(activePlayerId);
      const selectedGroupKey = selection?.selectedGroupKey || "";
      const availableWrenches =
        typeof roundEngineService.getAvailableWrenches === "function"
          ? roundEngineService.getAvailableWrenches(activePlayerId)
          : 0;
      const canUseWrenchPart = availableWrenches > 0;
      const wrenchPickPending = Boolean(selection?.wrenchPickPending);
      const wrenchButton = canUseWrenchPart
        ? (
            '<button type="button" class="journal-chip' +
            (wrenchPickPending ? " journal-chip--active" : "") +
            '" data-action="workshop-use-wrench">Pay a 🔧 → ?</button>'
          )
        : "";
      const groupButtons = options.length > 0
        ? options
            .map(
              (option) =>
                '<button type="button" class="journal-chip journal-chip--group' +
                (option.key === selectedGroupKey ? " journal-chip--active" : "") +
                '" data-action="workshop-select-group" data-group-key="' +
                option.key +
                '">' +
                option.label +
                "</button>",
            )
            .join("")
        : "<span class='journal-muted'>No workshop options this turn.</span>";
      const workshopNumberChoices =
        typeof roundEngineService.getWorkshopNumberChoices === "function"
          ? roundEngineService.getWorkshopNumberChoices(activePlayerId)
          : [];
      const activeWorkshopPick = selection?.activePick || null;
      const numberButtons = workshopNumberChoices.length
        ? workshopNumberChoices
            .map(
              (choice, index) =>
                '<button type="button" class="journal-chip journal-chip--number' +
              (Number(choice.usedValue) === Number(activeWorkshopPick?.usedValue) &&
                Number(choice.consumeValue) === Number(activeWorkshopPick?.consumeValue) &&
                Boolean(choice.adjusted) === Boolean(activeWorkshopPick?.adjusted)
                  ? " journal-chip--active"
                  : "") +
                '" data-action="workshop-select-number" data-number="' +
                String(choice.usedValue) +
                '" data-consume-number="' +
                String(choice.consumeValue) +
                '" data-adjusted="' +
                String(Boolean(choice.adjusted)) +
                '">' +
                String(choice.usedValue) +
                "</button>",
            )
            .join("")
        : "<span class='journal-muted'>No numbers remaining.</span>";

      let html = "";
      if (!selectedGroupKey) {
        html = '<div class="journal-control-row journal-control-row--prominent">' +
          groupButtons +
          wrenchButton +
          '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
          "</div>";
      } else {
        html =
          '<div class="journal-control-row">' +
          numberButtons +
          wrenchButton +
          '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
          "</div>";
      }
      controls.innerHTML = html;
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    const selection = state.journalSelections?.[activePlayerId];
    const pendingJournalIdeas = typeof roundEngineService.getPendingJournalIdeaJournals === "function"
      ? roundEngineService.getPendingJournalIdeaJournals(activePlayerId)
      : [];
    if (pendingJournalIdeas.length > 0) {
      const pendingJournal = pendingJournalIdeas[0];
      const player = (state.players || []).find((item) => item.id === activePlayerId);
      const inventions = Array.isArray(player?.inventions) ? player.inventions : [];
      const assignableInventions = inventions.filter((invention) => !invention.presentedDay);
      const ideaButtons = assignableInventions
        .map(
          (invention) =>
            '<button type="button" class="journal-chip journal-chip--group" data-action="assign-journal-idea" data-journal-id="' +
            pendingJournal.id +
            '" data-invention-id="' +
            invention.id +
            '">' +
            invention.name +
            "</button>",
        )
        .join("");
      controls.innerHTML =
        "<div class='journal-control-row'><span class='journal-muted'>Assign idea from " +
        pendingJournal.id +
        " before ending Journal phase.</span></div>" +
        '<div class="journal-control-row">' +
        (ideaButtons || "<span class='journal-muted'>No eligible inventions (presented inventions cannot be modified).</span>") +
        '<button type="button" class="journal-chip" data-action="advance-phase-inline" disabled>Skip</button>' +
        "</div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    const options = roundEngineService.getJournalingOptions(activePlayerId);
    const selectedGroupKey = selection?.selectedGroupKey || "";
    const selectedJournalId = selection?.selectedJournalId || "";
    const activeNumber = selection?.activeNumber;
    const groupLocked = Boolean(selectedJournalId);

    const groupButtons = options.length > 0
      ? options
          .map(
            (option) =>
              '<button type="button" class="journal-chip' +
              " journal-chip--group" +
              (option.key === selectedGroupKey ? " journal-chip--active" : "") +
              (groupLocked && option.key !== selectedGroupKey ? " journal-chip--disabled" : "") +
              '" data-action="select-group" data-group-key="' +
              option.key +
              '" ' +
              (groupLocked && option.key !== selectedGroupKey ? "disabled" : "") +
              '">' +
              option.label +
              "</button>",
          )
          .join("")
      : "<span class='journal-muted'>No group choices available.</span>";

    const journalNumberChoices =
      typeof roundEngineService.getJournalNumberChoices === "function"
        ? roundEngineService.getJournalNumberChoices(activePlayerId)
        : [];
    const activePick = selection?.activePick || null;
    const numberButtons = journalNumberChoices.length
      ? journalNumberChoices
          .map(
            (choice, index) =>
              '<button type="button" class="journal-chip journal-chip--number' +
              (Number(choice.usedValue) === Number(activePick?.usedValue) &&
                Number(choice.consumeValue) === Number(activePick?.consumeValue) &&
                Boolean(choice.adjusted) === Boolean(activePick?.adjusted)
                ? " journal-chip--active"
                : "") +
              '" data-action="select-number" data-number="' +
              String(choice.usedValue) +
              '" data-consume-number="' +
              String(choice.consumeValue) +
              '" data-adjusted="' +
              String(Boolean(choice.adjusted)) +
              '">' +
              String(choice.usedValue) +
              "</button>",
          )
          .join("")
      : "<span class='journal-muted'>No numbers remaining.</span>";

    if (state.rollAndGroup?.outcomeType === "quantum_leap") {
      controls.innerHTML =
        "<div class='journal-control-row'><span class='journal-muted'>Quantum Leap skips journaling.</span></div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    let controlsHtml = "";
    if (!selectedGroupKey) {
      controlsHtml =
        '<div class="journal-control-row journal-control-row--prominent">' +
        groupButtons +
        '<button type="button" class="journal-chip" data-action="advance-phase-inline" disabled>Skip</button>' +
        "</div>";
    } else if (!selectedJournalId) {
      controlsHtml =
        '<div class="journal-control-row">' +
        numberButtons +
        '<button type="button" class="journal-chip" data-action="advance-phase-inline" ' +
        (canAdvancePhase(state) ? "" : "disabled") +
        ">Skip</button>" +
        "</div>";
    } else {
      controlsHtml =
        '<div class="journal-control-row">' +
        numberButtons +
        '<button type="button" class="journal-chip" data-action="advance-phase-inline" ' +
        (canAdvancePhase(state) ? "" : "disabled") +
        ">Skip</button>" +
        "</div>";
    }

    controls.innerHTML = controlsHtml;
    if (controls.style) {
      controls.style.display = "grid";
    }
  }

  function clearRollPhaseTimers() {
    if (rollPhaseRevealTimeout) {
      globalScope.clearTimeout(rollPhaseRevealTimeout);
      rollPhaseRevealTimeout = null;
    }
    if (rollPhaseAdvanceTimeout) {
      globalScope.clearTimeout(rollPhaseAdvanceTimeout);
      rollPhaseAdvanceTimeout = null;
    }
    rollRevealVisibleKey = "";
    rollPhaseKey = "";
  }

  function maybeAutoResolveRollPhase(state) {
    if (state.phase !== "roll_and_group") {
      if (rollPhaseRevealTimeout || rollPhaseAdvanceTimeout) {
        clearRollPhaseTimers();
      }
      return;
    }
    const key = String(state.currentDay) + ":" + String(state.turnNumber);
    const alreadyRolledForTurn =
      state.rollAndGroup &&
      state.rollAndGroup.rolledAtTurn === state.turnNumber &&
      state.rollAndGroup.rolledAtDay === state.currentDay &&
      Array.isArray(state.rollAndGroup.dice) &&
      state.rollAndGroup.dice.length > 0;
    if (!alreadyRolledForTurn) {
      if (isMultiplayerGameActive()) {
        syncLocalRollFromRoomTurn(multiplayerState.room);
      } else if (typeof roundEngineService.rollForJournalPhase === "function") {
        roundEngineService.rollForJournalPhase(state);
      }
      state = roundEngineService.getState();
    }
    if (rollPhaseKey === key) {
      return;
    }
    clearRollPhaseTimers();
    rollPhaseKey = key;
    rollPhaseRevealTimeout = globalScope.setTimeout(() => {
      const current = roundEngineService.getState();
      if (current.phase !== "roll_and_group") {
        clearRollPhaseTimers();
        return;
      }
      rollRevealVisibleKey = key;
      renderState();
      rollPhaseAdvanceTimeout = globalScope.setTimeout(() => {
        const latest = roundEngineService.getState();
        if (
          latest.phase === "roll_and_group" &&
          String(latest.currentDay) + ":" + String(latest.turnNumber) === key
        ) {
          if (isMultiplayerGameActive()) {
            gameStateService.update({ phase: "journal" });
          } else {
            roundEngineService.advancePhase();
          }
          renderState();
        } else {
          clearRollPhaseTimers();
        }
      }, ROLL_RESULT_HOLD_MS);
    }, ROLL_SPINNER_MS);
  }

  function resolvePendingToolUnlockPrompt() {
    if (pendingToolUnlocks.length === 0) {
      return;
    }
    lastAutoScrollTarget = "";
    pendingToolUnlocks = [];
    const state = roundEngineService.getState();
    if (state.phase === "build") {
      roundEngineService.advancePhase();
    }
  }

  function captureUnlockedToolsFromBuildResult(buildResult) {
    if (!buildResult || !buildResult.ok) {
      return;
    }
    const unlocked = Array.isArray(buildResult.unlockedTools)
      ? buildResult.unlockedTools
      : [];
    if (unlocked.length > 0) {
      const activeTools = typeof roundEngineService.getActiveTools === "function"
        ? roundEngineService.getActiveTools(activePlayerId)
        : [];
      const toolById = new Map(activeTools.map((tool) => [String(tool.id), tool]));
      pendingToolUnlocks = unlocked.map((unlock) => ({
        ...unlock,
        abilityText: String(toolById.get(String(unlock.id))?.abilityText || ""),
      }));
      const currentWithUnlock = roundEngineService.getState();
      if (currentWithUnlock.phase === "build") {
        roundEngineService.advancePhase();
      }
      lastAutoScrollTarget = "";
      return;
    }
    const current = roundEngineService.getState();
    if (current.phase === "build") {
      roundEngineService.advancePhase();
    }
  }

  function shouldDeferActionsForUnlockPrompt() {
    return pendingToolUnlocks.length > 0;
  }

  function maybeBlockActionForUnlockPrompt(action) {
    if (!shouldDeferActionsForUnlockPrompt()) {
      return false;
    }
    if (action === "confirm-tool-unlock") {
      resolvePendingToolUnlockPrompt();
      renderState();
      return true;
    }
    return true;
  }

  function isOnlineInteractionLocked() {
    return isMultiplayerGameActive() && waitingForRoomTurnAdvance;
  }

  function renderPlayerStatePanel(state, player) {
    const summary = document.getElementById("player-state-summary");
    if (!summary) {
      return;
    }
    const available = typeof roundEngineService.getAvailableWrenches === "function"
      ? roundEngineService.getAvailableWrenches(activePlayerId)
      : 0;
    const wrenchTokens = available > 0
      ? Array.from({ length: Math.min(24, available) }, () => '<span class="wrench-token wrench-token--earned">🔧</span>').join("")
      : "<span class='journal-muted'>none</span>";
    const wrenchOverflow = available > 24 ? "<span class='journal-muted'> +" + String(available - 24) + "</span>" : "";
    const totalScore = Number(player?.totalScore || 0);
    const toolScore = Number(player?.toolScore || 0);
    const activeTools = typeof roundEngineService.getActiveTools === "function"
      ? roundEngineService.getActiveTools(activePlayerId)
      : [];
    const unlockedTools = activeTools.filter((tool) => tool.active);
    const unlockedToolDetailsHtml = unlockedTools.length > 0
      ? unlockedTools
          .map((tool) =>
            "<div><strong>" +
            String(tool.name || tool.id || "") +
            ":</strong> " +
            String(tool.abilityText || "") +
            "</div>",
          )
          .join("")
      : "";
    const completedJournals = Number(player?.completedJournals || 0);
    const currentDay = String(state?.currentDay || "Friday");
    summary.innerHTML =
      "<div class='summary-layout'>" +
      "<div class='summary-info'>" +
      "<div><strong>Day:</strong> " + currentDay + "</div>" +
      "<div><strong>Total score:</strong> " + String(totalScore) + "</div>" +
      "<div><strong>Tool score:</strong> " + String(toolScore) + "</div>" +
      "<div><strong>Completed journals:</strong> " + String(completedJournals) + "/3</div>" +
      unlockedToolDetailsHtml +
      "</div>" +
      "<div class='summary-wrench-box'><strong>Wrenches</strong><span class='summary-wrenches'>" + wrenchTokens + wrenchOverflow + "</span></div>" +
      "</div>" +
      "";
  }

  function renderToolsPanel(_state, player) {
    const container = document.getElementById("tools-panel");
    if (!container) {
      return;
    }
    const catalog = typeof roundEngineService.getActiveTools === "function"
      ? roundEngineService.getActiveTools(activePlayerId)
      : [];
    if (catalog.length === 0) {
      container.innerHTML = '<h2>Tools</h2><p class="tools-placeholder">No tools configured.</p>';
      return;
    }
    const cards = catalog
      .map((tool) => {
        const unlock = tool.unlock;
        const unlocked = Boolean(tool.active);
        const shape = renderToolShape(tool.pattern);
        return (
          '<article class="tool-card' +
          (unlocked ? " tool-card--unlocked" : "") +
          '">' +
          '<div class="tool-card__name">' + String(tool.name) + "</div>" +
          "<div class='tool-card__shape'>" +
          shape.html +
          "</div>" +
          '<div class="tool-card__vp">VP: ' +
          String(Number(tool.firstUnlockPoints || 0)) +
          " / " +
          String(Number(tool.laterUnlockPoints || 0)) +
          "</div>" +
          '<span class="tool-card__ability">' +
          String(tool.abilityText || "") +
          "</span>" +
          "</article>"
        );
      })
      .join("");
    container.innerHTML = "<h2>Tools</h2><div class='tool-grid'>" + cards + "</div>";
  }

  function renderToolShape(patternRows) {
    const rows = Array.isArray(patternRows) ? patternRows.map((row) => String(row)) : [];
    if (rows.length === 0) {
      return { html: "" };
    }
    const cols = rows.reduce((maxCols, row) => Math.max(maxCols, row.length), 1);
    const paddedRows = rows.map((row) => row.padEnd(cols, "0"));
    const filledKeys = new Set();
    paddedRows.forEach((row, rowIndex) => {
      row.split("").forEach((cell, colIndex) => {
        if (cell === "1") {
          filledKeys.add(String(rowIndex) + ":" + String(colIndex));
        }
      });
    });
    const html = rows
      .map((row) => row.padEnd(cols, "0"))
      .map((row, rowIndex) =>
        row
          .split("")
          .map((cell, colIndex) => {
            const key = String(rowIndex) + ":" + String(colIndex);
            const hasRight = filledKeys.has(key) && filledKeys.has(String(rowIndex) + ":" + String(colIndex + 1));
            const hasDown = filledKeys.has(key) && filledKeys.has(String(rowIndex + 1) + ":" + String(colIndex));
            return (
              '<span class="tool-shape-cell' +
              (cell === "1" ? " tool-shape-cell--filled" : "") +
              (hasRight ? " tool-shape-cell--edge-right" : "") +
              (hasDown ? " tool-shape-cell--edge-down" : "") +
              '"></span>'
            );
          })
          .join(""),
      )
      .join("");
    return {
      html:
        '<span class="tool-shape" style="--tool-shape-cols:' +
        String(cols) +
        '">' +
        html +
        "</span>",
    };
  }

  function renderInventOrientationShape(pointsInput) {
    const points = Array.isArray(pointsInput) ? pointsInput : [];
    if (points.length === 0) {
      return "<span class='journal-muted'>No shape</span>";
    }
    const maxRow = Math.max(...points.map((point) => Number(point.row)));
    const maxCol = Math.max(...points.map((point) => Number(point.col)));
    const rows = maxRow + 1;
    const cols = maxCol + 1;
    const filledKeys = new Set(
      points.map((point) => String(Number(point.row)) + ":" + String(Number(point.col))),
    );
    let html = "";
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const key = String(row) + ":" + String(col);
        const filled = filledKeys.has(key);
        const right = filled && filledKeys.has(String(row) + ":" + String(col + 1));
        const down = filled && filledKeys.has(String(row + 1) + ":" + String(col));
        html +=
          '<span class="invent-shape-cell' +
          (filled ? " invent-shape-cell--filled" : " invent-shape-cell--void") +
          (right ? " invent-shape-cell--edge-right" : "") +
          (down ? " invent-shape-cell--edge-down" : "") +
          '"></span>';
      }
    }
    return (
      '<span class="invent-shape-preview" style="--invent-shape-cols:' +
      String(cols) +
      '">' +
      html +
      "</span>"
    );
  }

  function renderWorkshops(state, player) {
    const container = document.getElementById("workshops-container");
    if (!container) {
      return;
    }
    if (!player || !Array.isArray(player.workshops) || player.workshops.length === 0) {
      container.innerHTML = "<p>No workshops initialized.</p>";
      return;
    }
    const workshopOrder = ["W1", "W2", "W3", "W4"];
    const workshopNames = {
      W1: "Hydraulic",
      W2: "Magnetic",
      W3: "Electrical",
      W4: "Mechanical",
    };
    const byId = new Map(player.workshops.map((workshop) => [workshop.id, workshop]));
    const selection = state.workshopSelections?.[activePlayerId];
    const allowedWorkshopValues =
      state.phase === "workshop"
        ? (
            typeof roundEngineService.getWorkshopNumberChoices === "function"
              ? roundEngineService
                  .getWorkshopNumberChoices(activePlayerId)
                  .map((choice) => Number(choice.usedValue))
              : (Array.isArray(selection?.remainingNumbers)
                  ? selection.remainingNumbers.map((item) => Number(item))
                  : [])
          )
        : [];
    const cardsHtml = workshopOrder
      .map((workshopId) => {
        const workshop = byId.get(workshopId);
        if (!workshop) {
          return "";
        }
        const cells = Array.isArray(workshop.cells) ? workshop.cells : [];
        const selectedWorkshopId = selection?.selectedWorkshopId || "";
        const hasReamer =
          typeof roundEngineService.hasTool === "function"
            ? roundEngineService.hasTool(activePlayerId, "T4")
            : false;
        const workshopLockedOut = !hasReamer && Boolean(selectedWorkshopId) && selectedWorkshopId !== workshop.id;
        const activeNumber = Number(selection?.activeNumber);
        const buildDraft = state.buildDrafts?.[activePlayerId];
        const isBuildPhase = state.phase === "build";
        const buildCheatEnabled =
          typeof roundEngineService.isBuildCheatEnabled === "function"
            ? roundEngineService.isBuildCheatEnabled()
            : false;
        const draftWorkshopId = buildDraft?.workshopId || "";
        const buildLockedOut = Boolean(draftWorkshopId) && draftWorkshopId !== workshop.id;
        const draftPath = Array.isArray(buildDraft?.path) ? buildDraft.path : [];
        const builtThisTurn =
          Boolean(player) &&
          player.lastBuildAtTurn === state.turnNumber &&
          player.lastBuildAtDay === state.currentDay;
        const committedCellToMechanism = new Map();
        (Array.isArray(player.mechanisms) ? player.mechanisms : [])
          .filter((item) => item.workshopId === workshop.id)
          .forEach((mechanism) => {
            (Array.isArray(mechanism.path) ? mechanism.path : []).forEach((point) => {
              committedCellToMechanism.set(
                String(point.row) + ":" + String(point.col),
                String(mechanism.id || ""),
              );
            });
          });
        const grid = cells
          .map((value, rowIndex) => {
            return value
              .map((cell, columnIndex) => {
                if (cell.kind === "empty") {
                  return '<span class="workshop-cell workshop-cell--empty"></span>';
                }
                const label = cell.kind === "wild" ? "?" : String(cell.value || "");
                const valueClass =
                  cell.kind === "number" && Number.isInteger(cell.value)
                    ? " workshop-cell--v" + String(cell.value)
                    : "";
                const canMatchActive =
                  state.phase === "workshop" &&
                  selection?.selectedGroupKey &&
                  !workshopLockedOut &&
                  !cell.circled &&
                  (
                    cell.kind === "wild" ||
                    (cell.kind === "number" && allowedWorkshopValues.includes(Number(cell.value)))
                  );
                const canWrenchPick =
                  state.phase === "workshop" &&
                  Boolean(selection?.wrenchPickPending) &&
                  !cell.circled &&
                  cell.kind !== "empty";
                const isDraftWorkshop = isBuildPhase && draftWorkshopId === workshop.id;
                const onDraftPath = isDraftWorkshop && Array.isArray(buildDraft?.path)
                  ? buildDraft.path.some((item) => item.row === rowIndex && item.col === columnIndex)
                  : false;
                const cellKey = String(rowIndex) + ":" + String(columnIndex);
                const mechanismIdForCell = committedCellToMechanism.get(cellKey) || "";
                const inCommittedMechanism = Boolean(mechanismIdForCell);
                const adjacentToDraft = isDraftWorkshop
                  ? draftPath.some(
                      (item) => Math.abs(item.row - rowIndex) + Math.abs(item.col - columnIndex) === 1,
                    )
                  : false;
                const canBuildSelect =
                  isBuildPhase &&
                  !builtThisTurn &&
                  (cell.circled || buildCheatEnabled) &&
                  !buildLockedOut &&
                  !inCommittedMechanism &&
                  (
                    (draftWorkshopId === "" && draftPath.length === 0) ||
                    (isDraftWorkshop && (onDraftPath || adjacentToDraft))
                  );
                const isDisabled = isBuildPhase
                  ? (!canBuildSelect && !inCommittedMechanism)
                  : (!cell.circled && !canMatchActive && !canWrenchPick);
                const shouldVisuallyDim = isBuildPhase
                  ? (!canBuildSelect && !cell.circled && !onDraftPath && !inCommittedMechanism)
                  : (!cell.circled && !canMatchActive && !canWrenchPick && !inCommittedMechanism);
                return (
                  '<button type="button" class="workshop-cell' +
                  valueClass +
                  (onDraftPath ? " workshop-cell--path" : "") +
                  (inCommittedMechanism ? " workshop-cell--mechanism" : "") +
                  (state.phase === "workshop" && (canMatchActive || canWrenchPick) ? " workshop-cell--clickable" : "") +
                  (canBuildSelect ? " workshop-cell--build-clickable" : "") +
                  (shouldVisuallyDim ? " workshop-cell--disabled" : "") +
                  (cell.circled ? " workshop-cell--circled" : "") +
                  (cell.kind === "wild" ? " workshop-cell--wild" : "") +
                  '" data-workshop-id="' +
                  workshop.id +
                  '" data-row-index="' +
                  String(rowIndex) +
                  '" data-column-index="' +
                  String(columnIndex) +
                  '" data-mechanism-id="' +
                  mechanismIdForCell +
                  '" ' +
                  (isDisabled ? "disabled" : "") +
                  ">" +
                  label +
                  "</button>"
                );
              })
              .join("");
          })
          .join("");
        const mechanismLines = renderWorkshopMechanismLines(state, player, workshop.id);
        const workshopIdeas = getWorkshopIdeasForRender(workshop);
        const ideasLayer = renderWorkshopIdeasLayer(workshopIdeas);
        return (
          '<article class="workshop-card">' +
          "<h3>" +
          workshopNames[workshop.id] +
          ' <span class="workshop-id">(' +
          workshop.id +
          ")</span>" +
          "</h3>" +
          '<div class="workshop-grid-wrapper">' +
          '<div class="workshop-grid-lines">' +
          mechanismLines +
          "</div>" +
          '<div class="workshop-ideas-layer">' +
          ideasLayer +
          "</div>" +
          '<div class="workshop-grid">' +
          grid +
          "</div>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");
    container.innerHTML = cardsHtml;
  }

  function getWorkshopIdeasForRender(workshop) {
    const currentIdeas = Array.isArray(workshop.ideas) ? workshop.ideas : [];
    if (
      typeof roundEngineService.getWorkshopIdeaAnchors !== "function" ||
      currentIdeas.length > 0
    ) {
      return currentIdeas;
    }
    const fallbackAnchors = roundEngineService.getWorkshopIdeaAnchors(workshop.id);
    return fallbackAnchors.map((anchor, index) => ({
      id: workshop.id + "-I" + String(index + 1),
      row: Number(anchor.row),
      col: Number(anchor.col),
      status: "locked",
      unlockedAtTurn: null,
      unlockedAtDay: null,
    }));
  }

  function renderWorkshopIdeasLayer(ideas) {
    if (!Array.isArray(ideas) || ideas.length === 0) {
      return "";
    }
    return ideas
      .map((idea) => {
        const topPercent = ((Number(idea.row) + 1) / 5) * 100;
        const leftPercent = ((Number(idea.col) + 1) / 5) * 100;
        const unlocked = idea.status === "unlocked";
        return (
          '<span class="workshop-idea' +
          (unlocked ? " workshop-idea--unlocked" : "") +
          '" title="' +
          (unlocked ? "Idea unlocked" : "Idea locked") +
          '" style="top:' +
          String(topPercent) +
          "%;left:" +
          String(leftPercent) +
          '%;">💡</span>'
        );
      })
      .join("");
  }

  function renderWorkshopMechanismLines(state, player, workshopId) {
    const workshop = player.workshops.find((item) => item.id === workshopId);
    if (!workshop) {
      return "";
    }
    const lines = [];
    const committed = Array.isArray(player.mechanisms)
      ? player.mechanisms.filter((item) => item.workshopId === workshopId)
      : [];
    committed.forEach((mechanism) => {
      const edges = Array.isArray(mechanism.edges) ? mechanism.edges : [];
      edges.forEach((edgeId) => {
        const parsed = parseEdgeId(edgeId);
        if (parsed) {
          lines.push({ a: parsed.a, b: parsed.b, className: "workshop-line workshop-line--committed" });
        }
      });
    });
    const draft = state.buildDrafts?.[activePlayerId];
    if (draft?.workshopId === workshopId && Array.isArray(draft.path)) {
      const edgeIds = typeof roundEngineService.selectionToEdgeIds === "function"
        ? roundEngineService.selectionToEdgeIds(draft.path)
        : [];
      edgeIds.forEach((edgeId) => {
        const parsed = parseEdgeId(edgeId);
        if (parsed) {
          lines.push({ a: parsed.a, b: parsed.b, className: "workshop-line workshop-line--draft" });
        }
      });
    }
    if (lines.length === 0) {
      return "";
    }
    const lineHtml = lines
      .map(({ a, b, className }) => {
        const x1 = a.col * 100 + 50;
        const y1 = a.row * 100 + 50;
        const x2 = b.col * 100 + 50;
        const y2 = b.row * 100 + 50;
        return (
          '<line class="' +
          className +
          '" x1="' +
          String(x1) +
          '" y1="' +
          String(y1) +
          '" x2="' +
          String(x2) +
          '" y2="' +
          String(y2) +
          '"></line>'
        );
      })
      .join("");
    return '<svg viewBox="0 0 500 500" preserveAspectRatio="none">' + lineHtml + "</svg>";
  }

  function parseEdgeId(edgeId) {
    const match = /^r(\d+)c(\d+)-r(\d+)c(\d+)$/.exec(String(edgeId || ""));
    if (!match) {
      return null;
    }
    return {
      a: { row: Number(match[1]), col: Number(match[2]) },
      b: { row: Number(match[3]), col: Number(match[4]) },
    };
  }

  function renderJournals(state, player) {
    const container = document.getElementById("journals-container");
    if (!container) {
      return;
    }

    if (!player || !Array.isArray(player.journals) || player.journals.length === 0) {
      container.innerHTML = "<p>No journals initialized.</p>";
      return;
    }

    const journalsHtml = player.journals.map((journal) => {
      const rows = Array.isArray(journal.grid) ? journal.grid : [];
      const cellMeta = Array.isArray(journal.cellMeta) ? journal.cellMeta : [];
      const rowWrenches = Array.isArray(journal.rowWrenches) ? journal.rowWrenches : [];
      const columnWrenches = Array.isArray(journal.columnWrenches) ? journal.columnWrenches : [];
      const playerSelection = state.journalSelections?.[activePlayerId];
      const activeJournalId = playerSelection?.selectedJournalId || "";
      const activeNumber = Number(playerSelection?.activeNumber);
      const hasActiveNumber = Number.isInteger(activeNumber);
      const isJournalLockedOut = Boolean(activeJournalId) && activeJournalId !== journal.id;
      const cellsHtml = rows
        .map((row, rowIndex) =>
          row
            .map((cell, columnIndex) => {
              const value = cell === null || typeof cell === "undefined" ? "" : String(cell);
              const meta = cellMeta[rowIndex]?.[columnIndex] || null;
              const isCurrentRoundEntry =
                Boolean(meta) &&
                meta.placedAtTurn === state.turnNumber &&
                meta.placedAtDay === state.currentDay;
              const isPreviousRoundEntry = Boolean(meta) && !isCurrentRoundEntry;
              const rightQuadrantBorder = columnIndex === 1 ? " journal-cell--q-right" : "";
              const bottomQuadrantBorder = rowIndex === 1 ? " journal-cell--q-bottom" : "";
              const gridColumn = columnIndex < 2 ? columnIndex + 1 : columnIndex + 2;
              const gridRow = rowIndex < 2 ? rowIndex + 1 : rowIndex + 2;
              const clickable =
                playerSelection?.selectedGroupKey && !isJournalLockedOut
                  ? " journal-cell--clickable"
                  : "";
              const shouldValidate =
                playerSelection?.selectedGroupKey &&
                hasActiveNumber &&
                !isJournalLockedOut;
              const validation = shouldValidate
                ? roundEngineService.validateJournalPlacement(journal, rowIndex, columnIndex, activeNumber)
                : { ok: true };
              const isDisabled =
                isJournalLockedOut ||
                !playerSelection?.selectedGroupKey ||
                (shouldValidate && !validation.ok);
              const disabledClass = isDisabled ? " journal-cell--disabled" : "";
              const roundClass = isCurrentRoundEntry
                ? " journal-cell--current-round"
                : isPreviousRoundEntry
                  ? " journal-cell--previous-round"
                  : "";
              return (
                '<button type="button" class="journal-cell' +
                rightQuadrantBorder +
                bottomQuadrantBorder +
                clickable +
                disabledClass +
                roundClass +
                '" ' +
                (isDisabled ? "disabled " : "") +
                'data-row-index="' +
                String(rowIndex) +
                '" data-column-index="' +
                String(columnIndex) +
                '" style="grid-column:' +
                String(gridColumn) +
                ";grid-row:" +
                String(gridRow) +
                ';"' +
                '">' +
                value +
                "</button>"
              );
            })
            .join(""),
        )
        .join("");
      const rowWrenchesHtml = rowWrenches
        .map(
          (status, index) => {
            const indicator = status === "earned" ? "✅" : status === "lost" ? "✖" : "🔧";
            return (
              '<div class="wrench-row-item">' +
              '<span class="wrench-label">R' +
              String(index + 1) +
              "</span>" +
              '<span class="wrench-token wrench-token--' +
              status +
              '">' +
              indicator +
              "</span>" +
              "</div>"
            );
          },
        )
        .join("");
      const columnWrenchesHtml = columnWrenches
        .map(
          (status, index) => {
            const indicator = status === "earned" ? "✅" : status === "lost" ? "✖" : "🔧";
            return (
              '<div class="wrench-col-item">' +
              '<span class="wrench-label">C' +
              String(index + 1) +
              "</span>" +
              '<span class="wrench-token wrench-token--' +
              status +
              '">' +
              indicator +
              "</span>" +
              "</div>"
            );
          },
        )
        .join("");

      const ideaStatus = String(journal.ideaStatus || "available");
      const ideaBadgeClass =
        ideaStatus === "completed"
          ? " journal-idea-badge--completed"
          : ideaStatus === "lost"
            ? " journal-idea-badge--lost"
            : "";

      return (
        '<article class="journal-card' +
        (isJournalLockedOut ? " journal-card--disabled" : "") +
        '">' +
        '<h3 class="journal-title">' +
        "<span>" +
        journal.id +
        "</span>" +
        '<span class="journal-idea-status">(' +
        '<span class="journal-idea-badge' +
        ideaBadgeClass +
        '">💡</span> Idea: ' +
        ideaStatus +
        ")</span>" +
        "</h3>" +
        '<div class="journal-layout">' +
        '<div class="journal-column-wrenches">' +
        columnWrenchesHtml +
        "</div>" +
        '<div class="journal-grid" data-journal-id="' +
        journal.id +
        '">' +
        cellsHtml +
        "</div>" +
        '<div class="journal-row-wrenches">' +
        rowWrenchesHtml +
        "</div>" +
        "</div>" +
        "</article>"
      );
    });

    container.innerHTML = journalsHtml.join("");
  }

  function renderInventions(state, player) {
    const container = document.getElementById("inventions-container");
    if (!container) {
      return;
    }
    if (!player) {
      container.innerHTML = "<p>No player found.</p>";
      return;
    }
    const inventions = getPlayerInventionsForRender(player);
    const pendingMechanism = state.phase === "invent" &&
      typeof roundEngineService.getPendingMechanismForInvent === "function"
      ? roundEngineService.getPendingMechanismForInvent(activePlayerId)
      : null;
    const cards = inventions
      .map((invention) => {
        const marks = invention.workshopTypeMarks || {};
        const workshopNames = {
          W1: "Hydraulic",
          W2: "Magnetic",
          W3: "Electrical",
          W4: "Mechanical",
        };
        const placements = Array.isArray(invention.placements) ? invention.placements : [];
        const activeVarietyType =
          inventionVarietyHover && inventionVarietyHover.inventionId === invention.id
            ? inventionVarietyHover.workshopId
            : "";
        const highlightedPlacementKeys = new Set(
          placements
            .filter((item) => !activeVarietyType || item.workshopId === activeVarietyType)
            .flatMap((item) => (Array.isArray(item.cells) ? item.cells : []))
            .map((cell) => String(cell.row) + ":" + String(cell.col)),
        );
        const types = ["W1", "W2", "W3", "W4"]
          .map((typeId) => {
            const marked = Boolean(marks[typeId]);
            return (
              '<span class="invention-type' +
              (marked ? " invention-type--marked" : "") +
              (marked ? " invention-type--hoverable" : "") +
              (activeVarietyType === typeId ? " invention-type--active-hover" : "") +
              '" data-invention-id="' +
              invention.id +
              '" data-workshop-id="' +
              typeId +
              '">' +
              workshopNames[typeId] +
              "</span>"
            );
          })
          .join("");
        const scoring = invention.scoring || {};
        const uniqueIdeasMarked = Math.min(6, Math.max(1, Number(invention.uniqueIdeasMarked || invention.multiplier || 1)));
        const ideaTrackHtml = renderInventionIdeaTrack(uniqueIdeasMarked);
        const uniqueTooltip = getUniqueCriterionTooltip(invention.criterionKey);
        const uniqueBase = getUniqueBaseValue(invention, player);
        const uniqueBaseLabel = getUniqueBaseLabel(invention.criterionKey);
        const completionBonusText = getCompletionBonusText(invention.id);
        const occupiedKeys = new Set(
          placements
            .flatMap((item) => (Array.isArray(item.cells) ? item.cells : []))
            .map((cell) => String(cell.row) + ":" + String(cell.col)),
        );
        const connectionMap = buildInventionConnectionMap(placements);
        const preview =
          state.phase === "invent" &&
          pendingMechanism &&
          inventionHover &&
          inventionHover.inventionId === invention.id &&
          typeof roundEngineService.computeInventionPlacementPreview === "function"
            ? roundEngineService.computeInventionPlacementPreview(
                activePlayerId,
                invention.id,
                inventionHover.row,
                inventionHover.col,
              )
            : null;
        const pattern = renderInventionPattern(invention.pattern, {
          inventionId: invention.id,
          preview,
          interactive: state.phase === "invent" && Boolean(pendingMechanism),
          occupiedKeys,
          connectionMap,
          highlightedKeys: activeVarietyType ? highlightedPlacementKeys : null,
        });
        return (
          '<article class="invention-card">' +
          '<div class="invention-header-row">' +
          "<h3>" +
          invention.name +
          "</h3>" +
          '<span class="invention-presented' +
          (invention.presentedDay ? " invention-presented--yes" : "") +
          '">' +
          (invention.presentedDay ? "Presented: " + invention.presentedDay : "Not presented") +
          "</span>" +
          "</div>" +
          '<div class="invention-pattern" style="--pattern-cols:' +
          String(pattern.cols) +
          ';">' +
          pattern.html +
          "</div>" +
          '<div class="invention-criterion-row invention-criterion-row--unique" data-tooltip="' +
          uniqueTooltip +
          '">' +
          "<span>" +
          (invention.criterionLabel || "Unique") +
          ": " +
          String(Number(scoring.unique || 0)) +
          "</span>" +
          '<span class="invention-criterion-desc">' +
          uniqueBaseLabel +
          " (" +
          String(uniqueBase) +
          ") x</span>" +
          '<span class="invention-criterion-extra">' +
          ideaTrackHtml +
          "</span>" +
          "</div>" +
          '<div class="invention-criterion-row">' +
          "<span>Variety: " +
          String(Number(scoring.variety || 0)) +
          "</span>" +
          '<span class="invention-criterion-desc">0, 3, 7, 12 points for 1, 2, 3, 4 different types</span>' +
          '<span class="invention-criterion-extra">' +
          types +
          "</span>" +
          "</div>" +
          '<div class="invention-criterion-row">' +
          "<span>Completion: " +
          String(Number(scoring.completion || 0)) +
          "</span>" +
          '<span class="invention-criterion-desc">' +
          completionBonusText +
          "</span>" +
          "</div>" +
          '<div class="invention-criterion-row invention-criterion-row--total">' +
          "<span>Total: " +
          String(Number(scoring.total || 0)) +
          "</span>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");
    container.innerHTML = cards;
  }

  function getPlayerInventionsForRender(player) {
    if (Array.isArray(player.inventions) && player.inventions.length > 0) {
      return player.inventions;
    }
    const fallbackCatalog = typeof roundEngineService.getDefaultInventionCatalog === "function"
      ? roundEngineService.getDefaultInventionCatalog()
      : [
          { id: "I1", name: "The Integron Assembly", criterionLabel: "Intricacy", pattern: ["0001000", "0011100", "1111111", "1111111"] },
          { id: "I2", name: "The Unison Motorworks", criterionLabel: "Synchrony", pattern: ["00110011", "11111111", "11111111", "11001100"] },
          { id: "I3", name: "The Lateral Arc Engine", criterionLabel: "Modularity", pattern: ["01000010", "11100111", "11111111", "11111111", "11100111", "01000010"] },
        ];
    return fallbackCatalog.map((item) => ({
      id: item.id,
      name: item.name,
      criterionLabel: item.criterionLabel,
      ideasCaptured: 0,
      uniqueIdeasMarked: 1,
      multiplier: 1,
      completionStatus: "incomplete",
      pattern: item.pattern,
      scoring: {
        variety: 0,
        completion: 0,
        unique: 0,
        total: 0,
      },
      usedMechanismIds: [],
      placements: [],
      workshopTypeMarks: {
        W1: false,
        W2: false,
        W3: false,
        W4: false,
      },
    }));
  }

  function renderInventionIdeaTrack(markedCount) {
    return Array.from({ length: 6 }, (_item, index) => {
      const marked = index < markedCount;
      return (
        '<span class="invention-idea-dot' +
        (marked ? " invention-idea-dot--marked" : "") +
        '">💡</span>'
      );
    }).join("");
  }

  function renderInventionPattern(patternRows, options) {
    const config = options || {};
    const safeRows = Array.isArray(patternRows) ? patternRows.map((row) => String(row)) : [];
    if (safeRows.length === 0) {
      return { html: "", cols: 1 };
    }
    const cols = safeRows.reduce((maxCols, row) => Math.max(maxCols, row.length), 1);
    const previewCells = Array.isArray(config.preview?.cells) ? config.preview.cells : [];
    const previewKeys = new Set(previewCells.map((cell) => String(cell.row) + ":" + String(cell.col)));
    const occupiedKeys = config.occupiedKeys instanceof Set ? config.occupiedKeys : new Set();
    const highlightedKeys = config.highlightedKeys instanceof Set ? config.highlightedKeys : null;
    const connectionMap = config.connectionMap instanceof Map ? config.connectionMap : new Map();
    const html = safeRows
      .map((row) => row.padEnd(cols, "0"))
      .map((row, rowIndex) =>
        row
          .split("")
          .map((cell, columnIndex) => {
            const key = String(rowIndex) + ":" + String(columnIndex);
            const inPreview = previewKeys.has(key);
            const inFilled = occupiedKeys.has(key);
            const dimmedByVarietyHover =
              highlightedKeys instanceof Set &&
              inFilled &&
              !highlightedKeys.has(key);
            const emphasizedByVarietyHover =
              highlightedKeys instanceof Set &&
              inFilled &&
              highlightedKeys.has(key);
            const connection = connectionMap.get(key) || {};
            const previewClass = inPreview
              ? (config.preview?.ok ? " invention-pattern-cell--preview-valid" : " invention-pattern-cell--preview-invalid")
              : "";
            return (
            '<span class="invention-pattern-cell' +
            (cell === "1" ? " invention-pattern-cell--open" : " invention-pattern-cell--void") +
            (inFilled ? " invention-pattern-cell--filled" : "") +
            (dimmedByVarietyHover ? " invention-pattern-cell--variety-dim" : "") +
            (emphasizedByVarietyHover ? " invention-pattern-cell--variety-highlight" : "") +
            (connection.right ? " invention-pattern-cell--edge-right" : "") +
            (connection.down ? " invention-pattern-cell--edge-down" : "") +
            previewClass +
            (config.interactive ? " invention-pattern-cell--interactive" : "") +
            '" data-invention-id="' +
            String(config.inventionId || "") +
            '" data-row-index="' +
            String(rowIndex) +
            '" data-column-index="' +
            String(columnIndex) +
            '"></span>'
            );
          })
          .join(""),
      )
      .join("");
    return { html, cols };
  }

  function buildInventionConnectionMap(placements) {
    const connectionMap = new Map();
    (Array.isArray(placements) ? placements : []).forEach((placement) => {
      const cells = Array.isArray(placement.cells) ? placement.cells : [];
      const cellKeys = new Set(cells.map((cell) => String(cell.row) + ":" + String(cell.col)));
      cells.forEach((cell) => {
        const key = String(cell.row) + ":" + String(cell.col);
        const rightKey = String(cell.row) + ":" + String(cell.col + 1);
        const downKey = String(cell.row + 1) + ":" + String(cell.col);
        const existing = connectionMap.get(key) || { right: false, down: false };
        if (cellKeys.has(rightKey)) {
          existing.right = true;
        }
        if (cellKeys.has(downKey)) {
          existing.down = true;
        }
        connectionMap.set(key, existing);
      });
    });
    return connectionMap;
  }

  function getUniqueCriterionTooltip(criterionKey) {
    if (criterionKey === "intricacy") {
      return "Intricacy = number of mechanisms in this invention x number of ideas.";
    }
    if (criterionKey === "synchrony") {
      return "Synchrony = most repeated mechanism shape count x number of ideas.";
    }
    if (criterionKey === "modularity") {
      return "Modularity = number of different mechanism sizes x number of ideas.";
    }
    return "Unique score uses this invention's special rule x number of ideas.";
  }

  function getUniqueCriterionDescription(criterionKey) {
    if (criterionKey === "intricacy") {
      return "Mechanisms count";
    }
    if (criterionKey === "synchrony") {
      return "Most repeated shape count";
    }
    if (criterionKey === "modularity") {
      return "Different size count";
    }
    return "Unique criteria";
  }

  function getUniqueBaseLabel(criterionKey) {
    if (criterionKey === "intricacy") {
      return "Number of mechanisms";
    }
    if (criterionKey === "synchrony") {
      return "Most repeated shape count";
    }
    if (criterionKey === "modularity") {
      return "Different mechanism sizes";
    }
    return "Unique criteria";
  }

  function getCompletionBonusText(inventionId) {
    const map = {
      I1: "Friday = 10, Saturday = 8, Sunday = 5",
      I2: "Friday = 13, Saturday = 11, Sunday = 8",
      I3: "Friday = 18, Saturday = 16, Sunday = 12",
    };
    return map[inventionId] || "Completion bonus by presented day";
  }

  function getUniqueBaseValue(invention, player) {
    const mechanismsById = new Map(
      (Array.isArray(player?.mechanisms) ? player.mechanisms : []).map((item) => [item.id, item]),
    );
    const placements = Array.isArray(invention?.placements) ? invention.placements : [];
    const usedMechanisms = placements
      .map((placement) => mechanismsById.get(placement.mechanismId))
      .filter(Boolean);
    if (invention?.criterionKey === "synchrony") {
      const frequencyByShape = new Map();
      usedMechanisms.forEach((mechanism) => {
        const signature = roundEngineService.getMechanismShapeSignature(mechanism.path, true);
        frequencyByShape.set(signature, Number(frequencyByShape.get(signature) || 0) + 1);
      });
      return Math.max(0, ...Array.from(frequencyByShape.values()));
    }
    if (invention?.criterionKey === "modularity") {
      return new Set(
        usedMechanisms.map((mechanism) => (Array.isArray(mechanism.path) ? mechanism.path.length : 0)),
      ).size;
    }
    return usedMechanisms.length;
  }

  function renderMechanismUsageTooltip(state, player, mechanismId, targetElement) {
    if (!player || !mechanismId || !targetElement) {
      hideWorkshopTooltip();
      return;
    }
    const mechanisms = Array.isArray(player.mechanisms) ? player.mechanisms : [];
    const mechanism = mechanisms.find((item) => String(item.id) === String(mechanismId));
    if (!mechanism || !mechanism.usedInventionId) {
      hideWorkshopTooltip();
      return;
    }
    const inventions = Array.isArray(player.inventions) ? player.inventions : [];
    const invention = inventions.find((item) => item.id === mechanism.usedInventionId);
    if (!invention || !mechanism.inventionPlacement || !Array.isArray(mechanism.inventionPlacement.cells)) {
      hideWorkshopTooltip();
      return;
    }
    const placementCells = mechanism.inventionPlacement.cells;
    if (placementCells.length === 0) {
      hideWorkshopTooltip();
      return;
    }
    const placementKeys = new Set(
      placementCells.map((cell) => String(cell.row) + ":" + String(cell.col)),
    );
    const preview = renderInventionMiniPattern(invention.pattern, placementKeys);
    const tooltip = ensureWorkshopTooltipElement();
    tooltip.innerHTML =
      '<div class="mechanism-tooltip__title">' +
      "Used in " +
      String(invention.name) +
      "</div>" +
      '<div class="mechanism-tooltip__pattern" style="--tooltip-pattern-cols:' +
      String(preview.cols) +
      ';">' +
      preview.html +
      "</div>";
    const rect = targetElement.getBoundingClientRect();
    const viewportWidth = Number(globalScope.innerWidth || 1200);
    const left = Math.min(viewportWidth - 230, rect.right + 10);
    const top = Math.max(8, rect.top - 12);
    tooltip.style.left = String(left) + "px";
    tooltip.style.top = String(top) + "px";
    tooltip.style.opacity = "1";
  }

  function renderInventionMiniPattern(patternRows, placementKeys) {
    const rows = Array.isArray(patternRows) ? patternRows.map((row) => String(row)) : [];
    if (rows.length === 0) {
      return { html: "", cols: 1 };
    }
    const cols = rows.reduce((maxCols, row) => Math.max(maxCols, row.length), 1);
    const html = rows
      .map((row) => row.padEnd(cols, "0"))
      .map((row, rowIndex) =>
        row
          .split("")
          .map((cell, columnIndex) => {
            const key = String(rowIndex) + ":" + String(columnIndex);
            const highlighted = placementKeys.has(key);
            return (
              '<span class="mechanism-tooltip__cell' +
              (cell === "1" ? " mechanism-tooltip__cell--open" : " mechanism-tooltip__cell--void") +
              (highlighted ? " mechanism-tooltip__cell--highlight" : "") +
              '"></span>'
            );
          })
          .join(""),
      )
      .join("");
    return { html, cols };
  }

  function ensureWorkshopTooltipElement() {
    let tooltip = document.getElementById("mechanism-usage-tooltip");
    if (tooltip) {
      return tooltip;
    }
    tooltip = document.createElement("div");
    tooltip.id = "mechanism-usage-tooltip";
    tooltip.className = "mechanism-usage-tooltip";
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function hideWorkshopTooltip() {
    const tooltip = document.getElementById("mechanism-usage-tooltip");
    if (!tooltip) {
      return;
    }
    tooltip.style.opacity = "0";
  }

  document.getElementById("advance-phase").addEventListener("click", function onAdvancePhase() {
    runWithUndo(() => {
      advancePhaseForCurrentMode();
    });
    renderState();
  });

  document.getElementById("start-new-game").addEventListener("click", function onStartNewGame() {
    if (hasActiveMultiplayerRoom()) {
      loggerService.logEvent("warn", "Leave multiplayer room to start a local solo game", { source: "ui" });
      renderMultiplayerUi();
      return;
    }
    const input = document.getElementById("new-game-seed");
    const desiredSeed = String(input?.value || "").trim() || generateRandomSeed();
    undoStack.length = 0;
    gameStateService.reset();
    persistUndoHistory();
    loggerService.replaceEntries([]);
    roundEngineService.initializePlayers(["P1"]);
    roundEngineService.setSeed(desiredSeed);
    gameStateService.update({ gameStarted: true });
    loggerService.logEvent("info", "New game started", { seed: desiredSeed, source: "ui" });
    renderState();
  });

  const mpConnectButton = document.getElementById("mp-connect");
  if (mpConnectButton) {
    mpConnectButton.addEventListener("click", async function onConnectMultiplayer() {
      const urlInput = document.getElementById("mp-url");
      const nameInput = document.getElementById("mp-name");
      multiplayerState.url = String(urlInput?.value || "").trim() || "ws://localhost:8080";
      multiplayerState.name = String(nameInput?.value || "").trim();
      persistMultiplayerState();
      await ensureMultiplayerConnection();
      renderMultiplayerUi();
    });
  }

  const mpCreateRoomButton = document.getElementById("mp-create-room");
  if (mpCreateRoomButton) {
    mpCreateRoomButton.addEventListener("click", async function onCreateMultiplayerRoom() {
      const urlInput = document.getElementById("mp-url");
      const nameInput = document.getElementById("mp-name");
      multiplayerState.url = String(urlInput?.value || "").trim() || "ws://localhost:8080";
      multiplayerState.name = String(nameInput?.value || "").trim();
      multiplayerState.lastError = "";
      clearMultiplayerSessionIdentity();
      gameStateService.update({ gameStarted: false });
      persistMultiplayerState();
      await ensureMultiplayerConnection();
      const sent = multiplayerClient.send("create_room", {
        name: multiplayerState.name || "Host",
      });
      if (!sent) {
        multiplayerState.lastError = "not_connected";
        renderMultiplayerUi();
      }
    });
  }

  const mpJoinRoomButton = document.getElementById("mp-join-room");
  if (mpJoinRoomButton) {
    mpJoinRoomButton.addEventListener("click", async function onJoinMultiplayerRoom() {
      const urlInput = document.getElementById("mp-url");
      const nameInput = document.getElementById("mp-name");
      const roomCodeInput = document.getElementById("mp-room-code");
      multiplayerState.url = String(urlInput?.value || "").trim() || "ws://localhost:8080";
      multiplayerState.name = String(nameInput?.value || "").trim();
      const requestedRoomCode = String(roomCodeInput?.value || "").trim().toUpperCase();
      multiplayerState.lastError = "";
      if (!requestedRoomCode) {
        multiplayerState.lastError = "Enter a room code like ABC123";
        renderMultiplayerUi();
        return;
      }
      clearMultiplayerSessionIdentity();
      gameStateService.update({ gameStarted: false });
      multiplayerState.roomCode = requestedRoomCode;
      persistMultiplayerState();
      await ensureMultiplayerConnection();
      const payload = {
        roomCode: multiplayerState.roomCode,
        name: multiplayerState.name || "Guest",
      };
      const sent = multiplayerClient.send("join_room", payload);
      if (!sent) {
        multiplayerState.lastError = "not_connected";
        renderMultiplayerUi();
      }
    });
  }

  const mpStartGameButton = document.getElementById("mp-start-game");
  if (mpStartGameButton) {
    mpStartGameButton.addEventListener("click", function onStartRoomGame() {
      multiplayerClient.send("start_game");
    });
  }

  const mpSyncButton = document.getElementById("mp-sync");
  if (mpSyncButton) {
    mpSyncButton.addEventListener("click", function onSyncRoomState() {
      multiplayerClient.send("request_sync");
    });
  }

  const mpLeaveButton = document.getElementById("mp-leave-room");
  if (mpLeaveButton) {
    mpLeaveButton.addEventListener("click", function onLeaveRoom() {
      multiplayerClient.send("leave_room");
      teardownMultiplayerSession("Left multiplayer room");
    });
  }

  document.getElementById("reset-game").addEventListener("click", function onResetGame() {
    if (hasActiveMultiplayerRoom() && isLocalPlayerHost()) {
      const confirmedHost = typeof globalScope.confirm === "function"
        ? globalScope.confirm("Terminate this multiplayer room for all players?")
        : true;
      if (!confirmedHost) {
        return;
      }
      multiplayerClient.send("terminate_room");
      return;
    }
    const confirmed = typeof globalScope.confirm === "function"
      ? globalScope.confirm("Reset the current game and return to New Game? This cannot be undone.")
      : true;
    if (!confirmed) {
      return;
    }
    undoStack.length = 0;
    gameStateService.reset();
    persistUndoHistory();
    loggerService.replaceEntries([]);
    loggerService.logEvent("warn", "Game reset; returned to New Game screen", { source: "ui" });
    renderState();
  });

  document.getElementById("undo-action").addEventListener("click", function onUndoAction() {
    if (undoStack.length === 0) {
      return;
    }
    const snapshot = undoStack.pop();
    gameStateService.setState(snapshot.state);
    persistUndoHistory();
    loggerService.replaceEntries(snapshot.logs);
    renderState();
  });

  document.getElementById("journal-controls").addEventListener("click", function onControlClick(event) {
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }

    const action = target.getAttribute("data-action");
    if (action === "mp-start-lobby") {
      multiplayerClient.send("start_game");
      return;
    }
    if (action === "mp-cancel-room") {
      multiplayerClient.send("terminate_room");
      return;
    }
    if (isOnlineInteractionLocked() && action !== "confirm-tool-unlock") {
      return;
    }
    if (maybeBlockActionForUnlockPrompt(action)) {
      return;
    }

    if (action === "select-group") {
      runWithUndo(() => {
        roundEngineService.selectJournalingGroup(activePlayerId, target.getAttribute("data-group-key"));
      });
      renderState();
      return;
    }

    if (action === "workshop-select-group") {
      runWithUndo(() => {
        roundEngineService.selectWorkshoppingGroup(activePlayerId, target.getAttribute("data-group-key"));
      });
      renderState();
      return;
    }

    if (action === "workshop-select-number") {
      runWithUndo(() => {
        roundEngineService.selectActiveWorkshopNumber(
          activePlayerId,
          Number(target.getAttribute("data-number")),
          Number(target.getAttribute("data-consume-number")),
          String(target.getAttribute("data-adjusted") || "false"),
        );
      });
      renderState();
      return;
    }

    if (action === "workshop-use-wrench") {
      runWithUndo(() => {
        if (typeof roundEngineService.activateWorkshopWrenchPick === "function") {
          roundEngineService.activateWorkshopWrenchPick(activePlayerId);
        }
      });
      renderState();
      return;
    }

    if (action === "finish-building") {
      runWithUndo(() => {
        setBuildDecision("accepted");
        const built = roundEngineService.finishBuildingMechanism(activePlayerId);
        captureUnlockedToolsFromBuildResult(built);
      });
      renderState();
      return;
    }

    if (action === "assign-journal-idea") {
      runWithUndo(() => {
        roundEngineService.assignJournalIdeaToInvention(
          activePlayerId,
          String(target.getAttribute("data-journal-id") || ""),
          String(target.getAttribute("data-invention-id") || ""),
        );
        maybeAutoAdvanceAfterJournalProgress();
      });
      renderState();
      return;
    }

    if (action === "clear-build-draft") {
      runWithUndo(() => {
        roundEngineService.clearMechanismDraft(activePlayerId);
      });
      renderState();
      return;
    }

    if (action === "build-accept") {
      runWithUndo(() => {
        setBuildDecision("accepted");
      });
      renderState();
      return;
    }

    if (action === "build-skip") {
      runWithUndo(() => {
        advancePhaseForCurrentMode();
      });
      renderState();
      return;
    }

    if (action === "advance-phase-inline") {
      runWithUndo(() => {
        advancePhaseForCurrentMode();
      });
      renderState();
      return;
    }

    if (action === "invent-confirm") {
      runWithUndo(() => {
        advancePhaseForCurrentMode();
      });
      renderState();
      return;
    }

    if (action === "invent-end-turn") {
      runWithUndo(() => {
        submitOnlineEndTurn();
      });
      renderState();
      return;
    }

    if (action === "invent-rotate-cw") {
      runWithoutUndo(() => {
        roundEngineService.rotatePendingMechanismForInvent(activePlayerId, "cw");
      });
      renderState();
      return;
    }

    if (action === "invent-rotate-ccw") {
      runWithoutUndo(() => {
        roundEngineService.rotatePendingMechanismForInvent(activePlayerId, "ccw");
      });
      renderState();
      return;
    }

    if (action === "invent-mirror") {
      runWithoutUndo(() => {
        roundEngineService.toggleMirrorPendingMechanismForInvent(activePlayerId);
      });
      renderState();
      return;
    }

    if (action === "invent-orientation-reset") {
      runWithUndo(() => {
        roundEngineService.resetPendingMechanismTransform(activePlayerId);
      });
      renderState();
      return;
    }

    if (action === "select-number") {
      runWithUndo(() => {
        roundEngineService.selectActiveJournalNumber(
          activePlayerId,
          Number(target.getAttribute("data-number")),
          Number(target.getAttribute("data-consume-number")),
          String(target.getAttribute("data-adjusted") || "false"),
        );
      });
      renderState();
    }
  });

  document.getElementById("journals-container").addEventListener("click", function onJournalClick(event) {
    if (isOnlineInteractionLocked()) {
      return;
    }
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }

    const cellButton = target.closest(".journal-cell");
    if (!cellButton) {
      return;
    }

    const grid = cellButton.closest(".journal-grid");
    if (!grid) {
      return;
    }

    const cells = Array.from(grid.querySelectorAll(".journal-cell"));
    const index = cells.indexOf(cellButton);
    if (index < 0) {
      return;
    }

    const rowIndex = Math.floor(index / 4);
    const columnIndex = index % 4;
    const journalId = grid.getAttribute("data-journal-id");
    runWithUndo(() => {
      roundEngineService.placeJournalNumber(activePlayerId, rowIndex, columnIndex, journalId);
      maybeAutoAdvanceAfterJournalProgress();
    });
    renderState();
  });

  document.getElementById("workshops-container").addEventListener("click", function onWorkshopClick(event) {
    if (isOnlineInteractionLocked()) {
      return;
    }
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }
    const button = target.closest(".workshop-cell");
    if (!button) {
      return;
    }
    const workshopId = button.getAttribute("data-workshop-id");
    const rowIndex = Number(button.getAttribute("data-row-index"));
    const columnIndex = Number(button.getAttribute("data-column-index"));
    const state = roundEngineService.getState();
    runWithUndo(() => {
      if (state.phase === "workshop") {
        const selection = state.workshopSelections?.[activePlayerId];
        if (selection?.wrenchPickPending && typeof roundEngineService.placeWorkshopPartByWrench === "function") {
          roundEngineService.placeWorkshopPartByWrench(activePlayerId, workshopId, rowIndex, columnIndex);
        } else {
          roundEngineService.placeWorkshopPart(activePlayerId, workshopId, rowIndex, columnIndex);
        }
        maybeAutoAdvanceAfterWorkshopProgress();
        return;
      }
      if (state.phase === "build") {
        roundEngineService.updateMechanismDraft(activePlayerId, workshopId, rowIndex, columnIndex);
      }
    });
    renderState();
  });

  document.getElementById("workshops-container").addEventListener("mousemove", function onWorkshopHover(event) {
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }
    const button = target.closest(".workshop-cell");
    if (!button) {
      hideWorkshopTooltip();
      return;
    }
    const mechanismId = String(button.getAttribute("data-mechanism-id") || "");
    if (!mechanismId) {
      hideWorkshopTooltip();
      return;
    }
    const state = roundEngineService.getState();
    const player = (state.players || []).find((item) => item.id === activePlayerId);
    renderMechanismUsageTooltip(state, player, mechanismId, button);
  });

  document.getElementById("workshops-container").addEventListener("mouseleave", function onWorkshopLeave() {
    hideWorkshopTooltip();
  });

  document.getElementById("inventions-container").addEventListener("mousemove", function onInventionHover(event) {
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }
    const state = roundEngineService.getState();
    if (state.phase !== "invent") {
      return;
    }
    if (typeof roundEngineService.getPendingMechanismForInvent === "function" &&
      !roundEngineService.getPendingMechanismForInvent(activePlayerId)) {
      return;
    }
    const cell = target.closest(".invention-pattern-cell");
    if (!cell) {
      if (inventionHover) {
        inventionHover = null;
        const player = (state.players || []).find((item) => item.id === activePlayerId);
        renderInventions(state, player);
      }
      return;
    }
    const nextHover = {
      inventionId: String(cell.getAttribute("data-invention-id") || ""),
      row: Number(cell.getAttribute("data-row-index")),
      col: Number(cell.getAttribute("data-column-index")),
    };
    if (
      inventionHover &&
      inventionHover.inventionId === nextHover.inventionId &&
      inventionHover.row === nextHover.row &&
      inventionHover.col === nextHover.col
    ) {
      return;
    }
    inventionHover = nextHover;
    const player = (state.players || []).find((item) => item.id === activePlayerId);
    renderInventions(state, player);
  });

  document.getElementById("inventions-container").addEventListener("mouseover", function onInventionTypeHover(event) {
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }
    const typeChip = target.closest(".invention-type");
    if (!typeChip) {
      return;
    }
    if (!typeChip.classList.contains("invention-type--hoverable")) {
      return;
    }
    const nextHover = {
      inventionId: String(typeChip.getAttribute("data-invention-id") || ""),
      workshopId: String(typeChip.getAttribute("data-workshop-id") || ""),
    };
    if (
      inventionVarietyHover &&
      inventionVarietyHover.inventionId === nextHover.inventionId &&
      inventionVarietyHover.workshopId === nextHover.workshopId
    ) {
      return;
    }
    inventionVarietyHover = nextHover;
    const state = roundEngineService.getState();
    const player = (state.players || []).find((item) => item.id === activePlayerId);
    renderInventions(state, player);
  });

  document.getElementById("inventions-container").addEventListener("mouseout", function onInventionTypeLeave(event) {
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }
    const typeChip = target.closest(".invention-type");
    if (!typeChip) {
      return;
    }
    if (!inventionVarietyHover) {
      return;
    }
    const related = event.relatedTarget;
    if (related && typeof globalScope.HTMLElement !== "undefined" && related instanceof globalScope.HTMLElement) {
      const relatedType = related.closest(".invention-type");
      if (relatedType && relatedType !== typeChip) {
        return;
      }
    }
    inventionVarietyHover = null;
    const state = roundEngineService.getState();
    const player = (state.players || []).find((item) => item.id === activePlayerId);
    renderInventions(state, player);
  });

  document.getElementById("inventions-container").addEventListener("mouseleave", function onInventionLeave() {
    if (!inventionHover) {
      if (!inventionVarietyHover) {
        return;
      }
    }
    inventionHover = null;
    inventionVarietyHover = null;
    const state = roundEngineService.getState();
    const player = (state.players || []).find((item) => item.id === activePlayerId);
    renderInventions(state, player);
  });

  document.getElementById("inventions-container").addEventListener("click", function onInventionClick(event) {
    if (isOnlineInteractionLocked()) {
      return;
    }
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }
    if (shouldDeferActionsForUnlockPrompt()) {
      return;
    }
    const cell = target.closest(".invention-pattern-cell");
    if (!cell) {
      return;
    }
    const state = roundEngineService.getState();
    if (state.phase !== "invent") {
      return;
    }
    const inventionId = String(cell.getAttribute("data-invention-id") || "");
    const rowIndex = Number(cell.getAttribute("data-row-index"));
    const columnIndex = Number(cell.getAttribute("data-column-index"));
    const preview = typeof roundEngineService.computeInventionPlacementPreview === "function"
      ? roundEngineService.computeInventionPlacementPreview(activePlayerId, inventionId, rowIndex, columnIndex)
      : { ok: false };
    if (!preview.ok) {
      return;
    }
    runWithUndo(() => {
      const placed = roundEngineService.placeMechanismInInvention(activePlayerId, inventionId, rowIndex, columnIndex);
      if (placed.ok) {
        inventionHover = null;
        advancePhaseForCurrentMode();
      }
    });
    renderState();
  });

  const workspaceNav = typeof document.querySelector === "function"
    ? document.querySelector(".workspace-nav")
    : null;
  if (workspaceNav) {
    workspaceNav.addEventListener("click", function onWorkspaceNavClick(event) {
      const target = event.target;
      if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
        return;
      }
      const link = target.closest("a[href^='#']");
      if (!link) {
        return;
      }
      const href = String(link.getAttribute("href") || "");
      if (!href.startsWith("#")) {
        return;
      }
      event.preventDefault();
      scrollWorkspaceToSection(href.slice(1));
    });
  }
  const workspace = typeof document.querySelector === "function"
    ? document.querySelector(".workspace")
    : null;
  if (workspace && typeof workspace.addEventListener === "function" && !workspaceScrollBound) {
    workspace.addEventListener("scroll", updateActiveAnchorFromScroll, { passive: true });
    workspaceScrollBound = true;
  }

  const startupState = roundEngineService.getState();
  if (isGameStarted(startupState)) {
    roundEngineService.initializePlayers(["P1"]);
  }
  if (Array.isArray(loadedState.undoHistory) && loadedState.undoHistory.length > MAX_PERSISTED_UNDO_SNAPSHOTS) {
    persistUndoHistory();
  }

  if (loadedState.logs.length === 0) {
    loggerService.logEvent("info", "Logging system initialized", { source: "system" });
    loggerService.logEvent("debug", "Layered architecture ready for game integration", {
      source: "system",
    });
  } else {
    loggerService.logEvent("info", "Previous session restored from local storage", {
      source: "system",
    });
  }

  renderMultiplayerUi();
  if (multiplayerState.roomCode && multiplayerState.reconnectToken) {
    ensureMultiplayerConnection().then(() => {
      if (!multiplayerState.connected) {
        return;
      }
      multiplayerClient.send("join_room", {
        roomCode: multiplayerState.roomCode,
        reconnectToken: multiplayerState.reconnectToken,
      });
    });
  }
  renderState();
})(typeof window !== "undefined" ? window : globalThis);

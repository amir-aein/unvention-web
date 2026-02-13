(function attachRoundEngineService(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  const PHASES = [
    "journal",
    "workshop",
    "build",
    "invent",
  ];

  const DAYS = ["Friday", "Saturday", "Sunday"];
  const DAY_THRESHOLDS = {
    Friday: 1,
    Saturday: 2,
    Sunday: 3,
  };
  const JOURNAL_COUNT = 3;
  const JOURNAL_SIZE = 4;
  const WORKSHOP_COUNT = 4;
  const WORKSHOP_SIZE = 5;
  const BUILD_WRENCH_COST = 2;
  const WORKSHOP_LAYOUTS = [
    [
      [5, 3, 5, 4, 2],
      [6, 2, "?", 1, 6],
      [3, 6, 4, 3, "?"],
      ["?", 5, 1, 3, 1],
      [1, 5, 2, 4, null],
    ],
    [
      [4, 3, "?", 1, 5],
      [1, 4, 5, 4, 3],
      ["?", 2, 3, 6, 1],
      [3, 6, 1, "?", 2],
      [null, 5, 4, 2, 6],
    ],
    [
      [2, 6, 1, 4, null],
      [1, 5, "?", 3, 1],
      [5, 2, 4, 5, "?"],
      [3, "?", 5, 2, 6],
      [6, 4, 2, 6, 3],
    ],
    [
      [null, 4, 3, 2, 5],
      ["?", 2, 6, "?", 3],
      [6, 2, 1, 4, 6],
      [4, 3, "?", 1, 2],
      [1, 6, 5, 5, 4],
    ],
  ];
  const WORKSHOP_IDEA_ANCHORS = {
    W1: [
      { row: 0, col: 1 },
      { row: 0, col: 3 },
      { row: 1, col: 3 },
      { row: 2, col: 0 },
      { row: 3, col: 1 },
    ],
    W2: [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 2, col: 0 },
      { row: 2, col: 3 },
      { row: 3, col: 2 },
    ],
    W3: [
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 2, col: 2 },
      { row: 3, col: 0 },
      { row: 3, col: 3 },
    ],
    W4: [
      { row: 0, col: 3 },
      { row: 1, col: 1 },
      { row: 1, col: 3 },
      { row: 3, col: 1 },
      { row: 3, col: 2 },
    ],
  };

  function getWorkshopLayoutsForSeed(_seed) {
    // Intentionally fixed for now; later this can return a deterministic
    // permutation based on seed without changing workshop consumers.
    return WORKSHOP_LAYOUTS;
  }

  class RoundEngineService {
    constructor(gameStateService, loggerService, diceRoller) {
      this.gameStateService = gameStateService;
      this.loggerService = loggerService;
      this.diceRoller = typeof diceRoller === "function" ? diceRoller : this.defaultDiceRoller;
    }

    getState() {
      return this.gameStateService.getState();
    }

    getPhases() {
      return [...PHASES];
    }

    getJournalingOptions(playerId) {
      const state = this.gameStateService.getState();
      const rollState = state.rollAndGroup || {};
      const outcomeType = rollState.outcomeType;
      if (!outcomeType) {
        return [];
      }

      if (outcomeType === "eureka") {
        return [1, 2, 3, 4, 5, 6].map((value, index) => ({
          key: "eureka-" + String(index),
          label: String(value),
          values: [value],
          source: { type: "eureka", value },
        }));
      }

      if (outcomeType === "quantum_leap") {
        return [];
      }

      const groups = Array.isArray(rollState.groups) ? rollState.groups : [];
      return groups.map((groupValues, index) => ({
        key: "group-" + String(index),
        label: groupValues.join(", "),
        values: [...groupValues],
        source: { type: "group", index },
      }));
    }

    getWorkshoppingOptions(playerId) {
      const state = this.gameStateService.getState();
      if (state.phase !== "workshop") {
        return [];
      }
      const rollState = state.rollAndGroup || {};
      const outcomeType = rollState.outcomeType;
      if (!outcomeType || outcomeType === "quantum_leap") {
        return [];
      }

      const context = state.workshopPhaseContext?.[playerId] || {};
      if (outcomeType === "eureka") {
        return [1, 2, 3, 4, 5, 6]
          .map((value, index) => ({
            key: "workshop-eureka-" + String(index),
            label: String(value),
            values: [value],
          }));
      }

      const groups = Array.isArray(rollState.groups) ? rollState.groups : [];
      return groups
        .map((groupValues, index) => ({
          key: "group-" + String(index),
          label: groupValues.join(", "),
          values: [...groupValues],
        }))
        .filter((option) => option.key !== context.excludedGroupKey);
    }

    getAvailableWrenches(playerId) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return 0;
      }
      const earned = (player.journals || []).reduce((count, journal) => {
        const row = Array.isArray(journal.rowWrenches) ? journal.rowWrenches : [];
        const col = Array.isArray(journal.columnWrenches) ? journal.columnWrenches : [];
        return (
          count +
          row.filter((value) => value === "earned").length +
          col.filter((value) => value === "earned").length
        );
      }, 0);
      const spent = Number(player.spentWrenches || 0);
      return Math.max(0, earned - spent);
    }

    getBuildCost(_playerId) {
      return BUILD_WRENCH_COST;
    }

    selectJournalingGroup(playerId, selectionKey) {
      const state = this.gameStateService.getState();
      if (state.phase !== "journal") {
        return state;
      }

      const existingSelection = state.journalSelections?.[playerId];
      if (
        existingSelection &&
        existingSelection.selectedJournalId &&
        existingSelection.selectedGroupKey !== selectionKey
      ) {
        this.loggerService.logEvent("warn", "Journaling group is locked after journal selection", {
          playerId,
          selectedJournalId: existingSelection.selectedJournalId,
        });
        return state;
      }

      const options = this.getJournalingOptions(playerId);
      const selected = options.find((option) => option.key === selectionKey);
      if (!selected) {
        this.loggerService.logEvent("warn", "Invalid journaling group selection", {
          playerId,
          selectionKey,
        });
        return state;
      }

      const selections = { ...(state.journalSelections || {}) };
      selections[playerId] = {
        selectedGroupKey: selected.key,
        selectedGroupValues: [...selected.values],
        remainingNumbers: [...selected.values],
        selectedJournalId: null,
        activeNumber: selected.values[0] || null,
        placementsThisTurn: 0,
        journalLocked: false,
      };

      const updated = this.gameStateService.update({
        journalSelections: selections,
      });
      this.loggerService.logEvent("info", "Player X selected journaling group " + selected.values.join(", "), {
        playerId,
        values: selected.values,
      });
      return updated;
    }

    selectJournal(playerId, journalId) {
      const state = this.gameStateService.getState();
      const selections = { ...(state.journalSelections || {}) };
      const playerSelection = selections[playerId];
      if (!playerSelection) {
        return state;
      }

      if (!playerSelection.selectedGroupKey) {
        return state;
      }

      if (playerSelection.selectedJournalId && playerSelection.selectedJournalId !== journalId) {
        this.loggerService.logEvent("warn", "Journal selection is locked for this turn", {
          playerId,
          selectedJournalId: playerSelection.selectedJournalId,
        });
        return state;
      }

      playerSelection.selectedJournalId = journalId;
      playerSelection.journalLocked = true;
      selections[playerId] = playerSelection;
      return this.gameStateService.update({ journalSelections: selections });
    }

    selectActiveJournalNumber(playerId, numberValue) {
      const state = this.gameStateService.getState();
      const selections = { ...(state.journalSelections || {}) };
      const playerSelection = selections[playerId];
      if (!playerSelection) {
        return state;
      }

      const value = Number(numberValue);
      if (!playerSelection.remainingNumbers.includes(value)) {
        return state;
      }

      playerSelection.activeNumber = value;
      selections[playerId] = playerSelection;
      return this.gameStateService.update({ journalSelections: selections });
    }

    selectWorkshoppingGroup(playerId, selectionKey) {
      const state = this.gameStateService.getState();
      if (state.phase !== "workshop") {
        return state;
      }
      const options = this.getWorkshoppingOptions(playerId);
      const selected = options.find((option) => option.key === selectionKey);
      if (!selected) {
        this.loggerService.logEvent("warn", "Invalid workshop group selection", {
          playerId,
          selectionKey,
        });
        return state;
      }

      const selections = { ...(state.workshopSelections || {}) };
      const existing = selections[playerId] || {};
      selections[playerId] = {
        ...existing,
        selectedGroupKey: selected.key,
        selectedGroupValues: [...selected.values],
        remainingNumbers: [...selected.values],
        activeNumber: selected.values[0] || null,
        selectedWorkshopId: existing.selectedWorkshopId || null,
        workshopLocked: Boolean(existing.selectedWorkshopId),
        placementsThisTurn: existing.placementsThisTurn || 0,
      };
      const updated = this.gameStateService.update({ workshopSelections: selections });
      this.loggerService.logEvent("info", "Player X selected workshopping group " + selected.values.join(", "), {
        playerId,
        values: selected.values,
      });
      return updated;
    }

    selectActiveWorkshopNumber(playerId, numberValue) {
      const state = this.gameStateService.getState();
      const selections = { ...(state.workshopSelections || {}) };
      const playerSelection = selections[playerId];
      if (!playerSelection) {
        return state;
      }
      const value = Number(numberValue);
      if (!Array.isArray(playerSelection.remainingNumbers) || !playerSelection.remainingNumbers.includes(value)) {
        return state;
      }
      playerSelection.activeNumber = value;
      selections[playerId] = playerSelection;
      return this.gameStateService.update({ workshopSelections: selections });
    }

    placeWorkshopPart(playerId, workshopId, rowIndex, columnIndex) {
      const state = this.gameStateService.getState();
      if (state.phase !== "workshop") {
        return { ok: false, reason: "invalid_phase", state };
      }
      const selection = state.workshopSelections?.[playerId];
      if (!selection?.selectedGroupValues?.length) {
        return { ok: false, reason: "missing_selection", state };
      }
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return { ok: false, reason: "missing_player", state };
      }
      const workshop = player.workshops.find((item) => item.id === workshopId);
      if (!workshop) {
        return { ok: false, reason: "invalid_workshop", state };
      }

      if (
        selection.selectedWorkshopId &&
        selection.selectedWorkshopId !== workshopId
      ) {
        return { ok: false, reason: "workshop_locked", state };
      }

      const activeNumber = Number(selection.activeNumber);
      const remainingNumbers = Array.isArray(selection.remainingNumbers) ? selection.remainingNumbers : [];
      if (remainingNumbers.length === 0) {
        return { ok: false, reason: "missing_number", state };
      }

      const row = workshop.cells?.[rowIndex];
      const cell = row?.[columnIndex];
      if (!cell || cell.kind === "empty") {
        return { ok: false, reason: "out_of_bounds", state };
      }
      if (cell.circled) {
        return { ok: false, reason: "already_circled", state };
      }
      const valueUsed = cell.kind === "number"
        ? Number(cell.value)
        : Number.isInteger(activeNumber) && remainingNumbers.includes(activeNumber)
          ? activeNumber
          : Number(remainingNumbers[0]);
      if (!Number.isInteger(valueUsed) || !remainingNumbers.includes(valueUsed)) {
        return { ok: false, reason: "number_mismatch", state };
      }

      workshop.cells[rowIndex][columnIndex] = { ...cell, circled: true };
      workshop.partsByNumber = this.countWorkshopPartsByNumber(workshop.cells);
      workshop.lastWorkedAtTurn = state.turnNumber;
      workshop.lastWorkedAtDay = state.currentDay;

      const selections = { ...(state.workshopSelections || {}) };
      selections[playerId] = {
        ...selection,
        selectedWorkshopId: workshopId,
        workshopLocked: true,
        remainingNumbers: this.removeSingleValue(remainingNumbers, valueUsed),
        placementsThisTurn: Number(selection.placementsThisTurn || 0) + 1,
      };
      selections[playerId].activeNumber = selections[playerId].remainingNumbers[0] || null;
      const updatedPlayers = state.players.map((item) => (item.id === playerId ? player : item));
      const updated = this.gameStateService.update({
        players: updatedPlayers,
        workshopSelections: selections,
      });
      this.loggerService.logEvent(
        "info",
        "Player X added part " +
          String(valueUsed) +
          " in " +
          String(workshop.id) +
          " at R" +
          String(rowIndex + 1) +
          "C" +
          String(columnIndex + 1),
        {
        playerId,
        workshopId,
        value: valueUsed,
        rowIndex,
        columnIndex,
      });
      return { ok: true, reason: null, state: updated };
    }

    updateMechanismDraft(playerId, workshopId, rowIndex, columnIndex) {
      const state = this.gameStateService.getState();
      if (state.phase !== "build") {
        return { ok: false, reason: "invalid_phase", state };
      }
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return { ok: false, reason: "missing_player", state };
      }
      const workshop = player.workshops.find((item) => item.id === workshopId);
      if (!workshop) {
        return { ok: false, reason: "invalid_workshop", state };
      }
      const cell = workshop.cells?.[rowIndex]?.[columnIndex];
      if (!cell || cell.kind === "empty") {
        return { ok: false, reason: "out_of_bounds", state };
      }
      if (!cell.circled) {
        return { ok: false, reason: "uncircled_part", state };
      }

      const drafts = { ...(state.buildDrafts || {}) };
      const currentDraft = drafts[playerId] || null;
      const committedCellKeys = new Set(
        (Array.isArray(player.mechanisms) ? player.mechanisms : [])
          .filter((item) => item.workshopId === workshopId)
          .flatMap((item) => (Array.isArray(item.path) ? item.path : []))
          .map((item) => this.pointKey(item)),
      );
      const point = { row: Number(rowIndex), col: Number(columnIndex) };
      const pointKey = this.pointKey(point);
      if (committedCellKeys.has(pointKey)) {
        return { ok: false, reason: "already_in_mechanism", state };
      }
      if (!currentDraft) {
        drafts[playerId] = {
          workshopId,
          path: [point],
        };
        const updated = this.gameStateService.update({ buildDrafts: drafts });
        return { ok: true, reason: null, state: updated };
      }

      if (currentDraft.workshopId !== workshopId) {
        return { ok: false, reason: "workshop_mismatch", state };
      }

      const path = Array.isArray(currentDraft.path) ? [...currentDraft.path] : [];
      if (path.length === 0) {
        drafts[playerId] = { workshopId, path: [point] };
        const updated = this.gameStateService.update({ buildDrafts: drafts });
        return { ok: true, reason: null, state: updated };
      }
      const existingIndex = path.findIndex((item) => item.row === point.row && item.col === point.col);
      if (existingIndex >= 0) {
        const nextPath = [...path.slice(0, existingIndex), ...path.slice(existingIndex + 1)];
        if (nextPath.length > 1 && !this.isConnectedSelection(nextPath)) {
          return { ok: false, reason: "disconnect_not_allowed", state };
        }
        drafts[playerId] = { workshopId, path: nextPath };
        const updated = this.gameStateService.update({ buildDrafts: drafts });
        return { ok: true, reason: "removed", state: updated };
      }

      const hasAdjacent = path.some((item) => this.areOrthogonallyAdjacent(item, point));
      if (!hasAdjacent) {
        return { ok: false, reason: "not_adjacent", state };
      }

      const nextPath = [...path, point];
      drafts[playerId] = { workshopId, path: nextPath };
      const updated = this.gameStateService.update({ buildDrafts: drafts });
      return { ok: true, reason: null, state: updated };
    }

    clearMechanismDraft(playerId) {
      const state = this.gameStateService.getState();
      const drafts = { ...(state.buildDrafts || {}) };
      delete drafts[playerId];
      return this.gameStateService.update({ buildDrafts: drafts });
    }

    finishBuildingMechanism(playerId) {
      const state = this.gameStateService.getState();
      if (state.phase !== "build") {
        return { ok: false, reason: "invalid_phase", state };
      }
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return { ok: false, reason: "missing_player", state };
      }
      if (
        player.lastBuildAtTurn === state.turnNumber &&
        player.lastBuildAtDay === state.currentDay
      ) {
        return { ok: false, reason: "already_built_this_turn", state };
      }
      const draft = state.buildDrafts?.[playerId];
      if (!draft || !Array.isArray(draft.path) || draft.path.length < 2) {
        return { ok: false, reason: "invalid_path", state };
      }
      const available = this.getAvailableWrenches(playerId);
      const cost = this.getBuildCost(playerId);
      if (available < cost) {
        return { ok: false, reason: "insufficient_wrenches", state };
      }

      const mechanisms = Array.isArray(player.mechanisms) ? [...player.mechanisms] : [];
      mechanisms.push({
        id: "M" + String(mechanisms.length + 1),
        workshopId: draft.workshopId,
        path: draft.path.map((item) => ({ row: item.row, col: item.col })),
        edges: this.selectionToEdgeIds(draft.path),
        builtAtTurn: state.turnNumber,
        builtAtDay: state.currentDay,
      });
      player.mechanisms = mechanisms;
      const workshop = player.workshops.find((item) => item.id === draft.workshopId);
      const unlockedIdeas = workshop
        ? this.updateUnlockedWorkshopIdeas(workshop, draft.path, state)
        : [];
      player.spentWrenches = Number(player.spentWrenches || 0) + cost;
      player.lastBuildAtTurn = state.turnNumber;
      player.lastBuildAtDay = state.currentDay;

      const players = state.players.map((item) => (item.id === player.id ? player : item));
      const drafts = { ...(state.buildDrafts || {}) };
      delete drafts[playerId];
      const updated = this.gameStateService.update({
        players,
        buildDrafts: drafts,
      });
      this.loggerService.logEvent("info", "Player X finished building in " + draft.workshopId, {
        playerId,
        workshopId: draft.workshopId,
        size: draft.path.length,
        wrenchCost: cost,
        unlockedIdeas: unlockedIdeas.length,
      });
      unlockedIdeas.forEach((idea) => {
        this.loggerService.logEvent(
          "info",
          "Player X unlocked workshop idea " + String(idea.id) + " in " + String(draft.workshopId),
          {
            playerId,
            workshopId: draft.workshopId,
            ideaId: idea.id,
          },
        );
      });
      return { ok: true, reason: null, state: updated };
    }

    updateUnlockedWorkshopIdeas(workshop, mechanismPath, state) {
      const ideas = this.ensureWorkshopIdeas(workshop);
      const pathKeys = new Set(
        (Array.isArray(mechanismPath) ? mechanismPath : []).map((item) =>
          this.pointKey({ row: Number(item.row), col: Number(item.col) }),
        ),
      );
      const unlocked = [];
      ideas.forEach((idea) => {
        if (idea.status === "unlocked") {
          return;
        }
        const covered = this.getIdeaSurroundingPoints(idea).every((point) =>
          pathKeys.has(this.pointKey(point)),
        );
        if (!covered) {
          return;
        }
        idea.status = "unlocked";
        idea.unlockedAtTurn = state.turnNumber;
        idea.unlockedAtDay = state.currentDay;
        unlocked.push(idea);
      });
      workshop.ideas = ideas;
      return unlocked;
    }

    getIdeaSurroundingPoints(idea) {
      const row = Number(idea.row);
      const col = Number(idea.col);
      return [
        { row, col },
        { row, col: col + 1 },
        { row: row + 1, col },
        { row: row + 1, col: col + 1 },
      ];
    }

    placeJournalNumber(playerId, rowIndex, columnIndex, journalId) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      const selections = { ...(state.journalSelections || {}) };
      const playerSelection = selections[playerId];
      if (!player || !playerSelection) {
        return { ok: false, reason: "missing_selection", state };
      }

      const requestedJournalId = journalId || playerSelection.selectedJournalId;
      if (!requestedJournalId) {
        return { ok: false, reason: "missing_selection", state };
      }

      if (
        playerSelection.selectedJournalId &&
        playerSelection.selectedJournalId !== requestedJournalId
      ) {
        return { ok: false, reason: "journal_locked", state };
      }

      if (!playerSelection.selectedJournalId) {
        playerSelection.selectedJournalId = requestedJournalId;
        playerSelection.journalLocked = true;
      }

      const journal = player.journals.find((item) => item.id === requestedJournalId);
      if (!journal) {
        return { ok: false, reason: "invalid_journal", state };
      }

      const value = Number(playerSelection.activeNumber);
      const remainingNumbers = Array.isArray(playerSelection.remainingNumbers)
        ? playerSelection.remainingNumbers
        : [];

      if (!Number.isInteger(value) || value < 1 || value > 6) {
        return { ok: false, reason: "missing_number", state };
      }

      if (!remainingNumbers.includes(value)) {
        return { ok: false, reason: "missing_number", state };
      }

      const validation = this.validateJournalPlacement(journal, rowIndex, columnIndex, value);
      if (!validation.ok) {
        this.loggerService.logEvent("warn", "Illegal journal placement blocked", {
          playerId,
          journalId: journal.id,
          rowIndex,
          columnIndex,
          value,
          reason: validation.reason,
        });
        return { ok: false, reason: validation.reason, state };
      }

      journal.grid[rowIndex][columnIndex] = value;
      if (!Array.isArray(journal.cellMeta) || !Array.isArray(journal.cellMeta[rowIndex])) {
        journal.cellMeta = this.createEmptyGrid(journal.size || 4);
      }
      journal.cellMeta[rowIndex][columnIndex] = {
        placedAtTurn: state.turnNumber,
        placedAtDay: state.currentDay,
      };
      this.updateWrenchesForJournal(journal);
      playerSelection.remainingNumbers = this.removeSingleValue(playerSelection.remainingNumbers, value);
      playerSelection.activeNumber = playerSelection.remainingNumbers[0] || null;
      playerSelection.placementsThisTurn += 1;
      selections[playerId] = playerSelection;
      journal.completionStatus = this.isJournalComplete(journal) ? "complete" : "incomplete";
      if (journal.completionStatus === "complete" && journal.ideaStatus === "available") {
        journal.ideaStatus = "completed";
      }
      player.completedJournals = player.journals.filter((item) => this.isJournalComplete(item)).length;

      const updatedPlayers = state.players.map((item) => (item.id === player.id ? player : item));
      const updated = this.gameStateService.update({
        players: updatedPlayers,
        journalSelections: selections,
      });

      this.loggerService.logEvent(
        "info",
        "Player X added a " +
          String(value) +
          " in " +
          String(journal.id) +
          " at R" +
          String(rowIndex + 1) +
          "C" +
          String(columnIndex + 1),
        {
        playerId,
        journalId: journal.id,
        rowIndex,
        columnIndex,
        value,
      });

      return { ok: true, reason: null, state: updated };
    }

    initializePlayers(playerIds) {
      const ids = Array.isArray(playerIds) ? playerIds : [];
      if (ids.length === 0) {
        return this.gameStateService.getState();
      }

      const state = this.gameStateService.getState();
      const players = Array.isArray(state.players) ? [...state.players] : [];
      let changed = false;

      ids.forEach((id) => {
        const playerId = String(id || "").trim();
        if (!playerId) {
          return;
        }
        if (!players.some((player) => player.id === playerId)) {
          players.push(this.createDefaultPlayer(playerId));
          changed = true;
        }
      });

      if (!changed) {
        return state;
      }

      const updated = this.gameStateService.update({ players });
      this.loggerService.logEvent("info", "Players initialized", {
        playerIds: ids,
      });
      return updated;
    }

    setSeed(seedInput) {
      const seed = String(seedInput || "").trim() || "default-seed";
      const hashed = this.hashSeed(seed);
      const updated = this.gameStateService.update({
        rngSeed: seed,
        rngState: hashed,
      });

      this.loggerService.logEvent("info", "RNG seed updated", {
        seed,
      });
      return updated;
    }

    updatePlayerJournalCompletion(playerId, completedJournals) {
      const state = this.gameStateService.getState();
      const players = Array.isArray(state.players) ? [...state.players] : [];
      const safeCompleted = Math.max(0, Math.min(3, Number(completedJournals) || 0));
      const existingIndex = players.findIndex((player) => player.id === playerId);

      if (existingIndex >= 0) {
        players[existingIndex] = {
          ...players[existingIndex],
          completedJournals: safeCompleted,
        };
      } else {
        const player = this.createDefaultPlayer(playerId);
        player.completedJournals = safeCompleted;
        players.push(player);
      }

      const updated = this.gameStateService.update({ players });
      this.loggerService.logEvent("debug", "Journal completion updated", {
        playerId,
        completedJournals: safeCompleted,
      });
      return updated;
    }

    createDefaultPlayer(playerId) {
      return {
        id: playerId,
        completedJournals: 0,
        spentWrenches: 0,
        mechanisms: [],
        lastBuildAtTurn: null,
        lastBuildAtDay: null,
        journals: Array.from({ length: JOURNAL_COUNT }, (_item, index) =>
          this.createDefaultJournal(index + 1),
        ),
        workshops: Array.from({ length: WORKSHOP_COUNT }, (_item, index) =>
          this.createDefaultWorkshop(index + 1),
        ),
      };
    }

    createDefaultJournal(journalNumber) {
      return {
        id: "J" + String(journalNumber),
        size: JOURNAL_SIZE,
        grid: this.createEmptyGrid(JOURNAL_SIZE),
        cellMeta: this.createEmptyGrid(JOURNAL_SIZE),
        rowWrenches: Array.from({ length: JOURNAL_SIZE }, () => "available"),
        columnWrenches: Array.from({ length: JOURNAL_SIZE }, () => "available"),
        ideaStatus: "available",
        completionStatus: "incomplete",
      };
    }

    createDefaultWorkshop(workshopNumber) {
      const state = this.gameStateService.getState();
      const layouts = getWorkshopLayoutsForSeed(state.rngSeed);
      const template = layouts[workshopNumber - 1] || layouts[0];
      const workshopId = "W" + String(workshopNumber);
      const cells = template.map((row) =>
        row.map((token) => {
          if (token === null) {
            return {
              kind: "empty",
              value: null,
              circled: false,
            };
          }
          if (token === "?") {
            return {
              kind: "wild",
              value: null,
              circled: false,
            };
          }
          return {
            kind: "number",
            value: Number(token),
            circled: false,
          };
        }),
      );
      return {
        id: workshopId,
        size: WORKSHOP_SIZE,
        cells,
        ideas: this.createWorkshopIdeas(workshopId),
        partsByNumber: this.countWorkshopPartsByNumber(cells),
        lastWorkedAtTurn: null,
        lastWorkedAtDay: null,
      };
    }

    createWorkshopIdeas(workshopId) {
      const anchors = WORKSHOP_IDEA_ANCHORS[workshopId] || [];
      return anchors.map((anchor, index) => ({
        id: workshopId + "-I" + String(index + 1),
        row: Number(anchor.row),
        col: Number(anchor.col),
        status: "locked",
        unlockedAtTurn: null,
        unlockedAtDay: null,
      }));
    }

    getWorkshopIdeaAnchors(workshopId) {
      return (WORKSHOP_IDEA_ANCHORS[workshopId] || []).map((anchor) => ({
        row: Number(anchor.row),
        col: Number(anchor.col),
      }));
    }

    ensureWorkshopIdeas(workshop) {
      if (!workshop || !workshop.id) {
        return [];
      }
      const anchors = this.getWorkshopIdeaAnchors(workshop.id);
      const existing = Array.isArray(workshop.ideas) ? workshop.ideas : [];
      if (existing.length === anchors.length) {
        return existing;
      }
      const byAnchor = new Map(
        existing.map((idea) => [String(idea.row) + ":" + String(idea.col), idea]),
      );
      const normalized = anchors.map((anchor, index) => {
        const key = String(anchor.row) + ":" + String(anchor.col);
        const previous = byAnchor.get(key);
        if (previous) {
          return {
            id: previous.id || workshop.id + "-I" + String(index + 1),
            row: Number(anchor.row),
            col: Number(anchor.col),
            status: previous.status === "unlocked" ? "unlocked" : "locked",
            unlockedAtTurn: previous.unlockedAtTurn ?? null,
            unlockedAtDay: previous.unlockedAtDay ?? null,
          };
        }
        return {
          id: workshop.id + "-I" + String(index + 1),
          row: Number(anchor.row),
          col: Number(anchor.col),
          status: "locked",
          unlockedAtTurn: null,
          unlockedAtDay: null,
        };
      });
      workshop.ideas = normalized;
      return normalized;
    }

    countWorkshopPartsByNumber(cells) {
      const totals = {
        "1": { total: 0, circled: 0 },
        "2": { total: 0, circled: 0 },
        "3": { total: 0, circled: 0 },
        "4": { total: 0, circled: 0 },
        "5": { total: 0, circled: 0 },
        "6": { total: 0, circled: 0 },
        wild: { total: 0, circled: 0 },
      };
      cells.forEach((row) => {
        row.forEach((cell) => {
          if (cell.kind === "number" && Number.isInteger(cell.value)) {
            const key = String(cell.value);
            totals[key].total += 1;
            if (cell.circled) {
              totals[key].circled += 1;
            }
            return;
          }
          if (cell.kind === "wild") {
            totals.wild.total += 1;
            if (cell.circled) {
              totals.wild.circled += 1;
            }
          }
        });
      });
      return totals;
    }

    createEmptyGrid(size) {
      return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
    }

    advancePhase() {
      const state = this.gameStateService.getState();

      if (state.gameStatus === "completed") {
        this.loggerService.logEvent("warn", "Game already completed; phase cannot advance", {
          day: state.currentDay,
          turnNumber: state.turnNumber,
          phase: state.phase,
        });
        return state;
      }

      const phaseIndex = PHASES.indexOf(state.phase);
      if (phaseIndex < 0) {
        const repaired = this.gameStateService.update({ phase: PHASES[0] });
        this.loggerService.logEvent("error", "Unknown phase detected; resetting to first phase", {
          invalidPhase: state.phase,
        });
        return repaired;
      }

      if (phaseIndex < PHASES.length - 1) {
        if (state.phase === "journal") {
          const preparedState = this.ensureJournalRoll(state);
          return this.completeJournalPhase(preparedState);
        }

        if (state.phase === "workshop") {
          const canBuild = this.canBuildThisTurn(state, "P1");
          if (!canBuild) {
            this.loggerService.logEvent("info", "Build phase skipped (not enough wrenches)", {
              playerId: "P1",
              required: this.getBuildCost("P1"),
              available: this.getAvailableWrenches("P1"),
            });
            if (!this.hasBuiltThisTurn(state, "P1")) {
              this.loggerService.logEvent("info", "Invent phase skipped (no mechanism built this turn)", {
                playerId: "P1",
              });
              return this.completeTurn(state);
            }
            const inventState = this.gameStateService.update({ phase: "invent" });
            return inventState;
          }
        }

        if (state.phase === "build") {
          if (!this.hasBuiltThisTurn(state, "P1")) {
            this.loggerService.logEvent("info", "Invent phase skipped (no mechanism built this turn)", {
              playerId: "P1",
            });
            return this.completeTurn(state);
          }
        }

        const nextPhase = PHASES[phaseIndex + 1];
        const updated = this.gameStateService.update({ phase: nextPhase });
        this.loggerService.logEvent("info", "Phase advanced", {
          day: updated.currentDay,
          turnNumber: updated.turnNumber,
          from: state.phase,
          to: nextPhase,
        });
        return updated;
      }

      if (state.phase === "invent" && !this.hasBuiltThisTurn(state, "P1")) {
        this.loggerService.logEvent("info", "Invent phase skipped (no mechanism built this turn)", {
          playerId: "P1",
        });
      }

      return this.completeTurn(state);
    }

    completeJournalPhase(stateAtJournalPhase) {
      const playerId = "P1";
      const rollOutcome = stateAtJournalPhase.rollAndGroup?.outcomeType;
      if (rollOutcome === "quantum_leap") {
        const updatedQuantum = this.gameStateService.update({ phase: "workshop" });
        this.loggerService.logEvent("info", "Journal phase skipped due to Quantum Leap", {
          playerId,
        });
        return updatedQuantum;
      }

      const selection = stateAtJournalPhase.journalSelections?.[playerId];
      if (!selection || !selection.selectedGroupKey) {
        this.loggerService.logEvent("warn", "Select a journaling group before continuing", {
          playerId,
        });
        return stateAtJournalPhase;
      }

      if ((selection.placementsThisTurn || 0) < 1) {
        this.loggerService.logEvent("warn", "Place at least one number before ending Journal phase", {
          playerId,
        });
        return stateAtJournalPhase;
      }

      const clearedSelections = { ...(stateAtJournalPhase.journalSelections || {}) };
      delete clearedSelections[playerId];
      const workshopContext = { ...(stateAtJournalPhase.workshopPhaseContext || {}) };
      workshopContext[playerId] = {
        excludedGroupKey: selection.selectedGroupKey || null,
        journalChosenNumber: Number(selection.selectedGroupValues?.[0] ?? NaN),
      };
      const updated = this.gameStateService.update({
        phase: "workshop",
        journalSelections: clearedSelections,
        workshopPhaseContext: workshopContext,
      });
      this.loggerService.logEvent("info", "Journal phase completed", {
        playerId,
      });
      return updated;
    }

    ensureJournalRoll(stateInput) {
      const state = stateInput || this.gameStateService.getState();
      if (state.phase !== "journal") {
        return state;
      }
      const alreadyRolledForTurn =
        state.rollAndGroup?.rolledAtTurn === state.turnNumber &&
        state.rollAndGroup?.rolledAtDay === state.currentDay &&
        Array.isArray(state.rollAndGroup?.dice) &&
        state.rollAndGroup.dice.length === 5;
      if (alreadyRolledForTurn) {
        return state;
      }
      return this.rollForJournalPhase(state);
    }

    rollForJournalPhase(stateAtJournalPhase) {
      const rollResult = this.rollFiveDice(stateAtJournalPhase);
      const dice = rollResult.dice;
      const analysis = this.analyzeDice(dice);
      const updated = this.gameStateService.update({
        rngState: rollResult.nextRngState,
        rollAndGroup: {
          dice: [...dice],
          outcomeType: analysis.outcomeType,
          groups: analysis.groups,
          rolledAtTurn: stateAtJournalPhase.turnNumber,
          rolledAtDay: stateAtJournalPhase.currentDay,
        },
      });

      this.loggerService.logEvent("info", "Dice rolled and grouped", {
        day: updated.currentDay,
        turnNumber: updated.turnNumber,
        dice,
        outcomeType: analysis.outcomeType,
        groups: analysis.groups,
      });

      return updated;
    }

    rollFiveDice(state) {
      if (typeof this.diceRoller === "function" && this.diceRoller !== this.defaultDiceRoller) {
        const dice = this.diceRoller();
        return {
          dice,
          nextRngState: state.rngState,
        };
      }

      let rngState = Number.isInteger(state.rngState) ? state.rngState : this.hashSeed(state.rngSeed);
      const dice = [];
      for (let index = 0; index < 5; index += 1) {
        const next = this.nextRandom(rngState);
        rngState = next.state;
        dice.push(Math.floor(next.value * 6) + 1);
      }

      return {
        dice,
        nextRngState: rngState,
      };
    }

    analyzeDice(diceInput) {
      const dice = [...diceInput];
      const frequency = this.buildFrequency(dice);
      const uniqueValues = Object.keys(frequency).map((value) => Number(value));
      const isQuantumLeap = uniqueValues.length === 1;
      const isEureka = uniqueValues.length === 5;

      if (isQuantumLeap) {
        return {
          outcomeType: "quantum_leap",
          groups: [],
        };
      }

      if (isEureka) {
        return {
          outcomeType: "eureka",
          groups: [],
        };
      }

      const equalGroups = uniqueValues
        .filter((value) => frequency[value] > 1)
        .sort((a, b) => a - b)
        .map((value) => Array.from({ length: frequency[value] }, () => value));

      const singleValues = uniqueValues.filter((value) => frequency[value] === 1).sort((a, b) => a - b);
      const groups = singleValues.length > 0 ? [...equalGroups, singleValues] : equalGroups;

      return {
        outcomeType: groups.length === 3 ? "three_groups" : "two_groups",
        groups,
      };
    }

    buildFrequency(dice) {
      return dice.reduce((accumulator, value) => {
        const key = Number(value);
        accumulator[key] = (accumulator[key] || 0) + 1;
        return accumulator;
      }, {});
    }

    defaultDiceRoller() {
      return Array.from({ length: 5 }, () => Math.floor(Math.random() * 6) + 1);
    }

    hashSeed(seed) {
      let hash = 2166136261;
      for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    nextRandom(currentState) {
      // xorshift32
      let x = currentState >>> 0;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      const state = x >>> 0;
      const value = state / 4294967296;
      return { state, value };
    }

    completeTurn(stateAtEndPhase) {
      const dayResolution = this.resolveDayTransition(stateAtEndPhase);

      if (dayResolution.gameCompleted) {
        const completed = this.gameStateService.update({
          gameStatus: "completed",
          phase: PHASES[PHASES.length - 1],
          currentDay: dayResolution.finalDay,
        });

        this.loggerService.logEvent("info", "Day ended", {
          day: dayResolution.endedDay,
          turnNumber: stateAtEndPhase.turnNumber,
        });

        if (dayResolution.skippedDay) {
          this.loggerService.logEvent("warn", "Day skipped due to simultaneous trigger", {
            skippedDay: dayResolution.skippedDay,
          });
        }

        this.loggerService.logEvent("info", "Game completed", {
          day: completed.currentDay,
          turnNumber: completed.turnNumber,
        });
        return completed;
      }

      if (dayResolution.endedDay) {
        const progressed = this.gameStateService.update({
          currentDay: dayResolution.nextDay,
          turnNumber: stateAtEndPhase.turnNumber + 1,
          phase: PHASES[0],
          journalSelections: {},
          workshopSelections: {},
          workshopPhaseContext: {},
          buildDrafts: {},
        });
        const prepared = this.ensureJournalRoll(progressed);

        this.loggerService.logEvent("info", "Day ended", {
          day: dayResolution.endedDay,
          turnNumber: stateAtEndPhase.turnNumber,
        });

        if (dayResolution.skippedDay) {
          this.loggerService.logEvent("warn", "Day skipped due to simultaneous trigger", {
            skippedDay: dayResolution.skippedDay,
          });
        }

        this.loggerService.logEvent("info", "New day started", {
          day: prepared.currentDay,
          turnNumber: prepared.turnNumber,
          phase: prepared.phase,
        });
        return prepared;
      }

      const nextTurn = this.gameStateService.update({
        turnNumber: stateAtEndPhase.turnNumber + 1,
        phase: PHASES[0],
        journalSelections: {},
        workshopSelections: {},
        workshopPhaseContext: {},
        buildDrafts: {},
      });
      const prepared = this.ensureJournalRoll(nextTurn);

      this.loggerService.logEvent("info", "Turn completed", {
        day: prepared.currentDay,
        turnNumber: stateAtEndPhase.turnNumber,
      });
      return prepared;
    }

    resolveDayTransition(state) {
      const currentDayIndex = DAYS.indexOf(state.currentDay);
      const normalizedDayIndex = currentDayIndex >= 0 ? currentDayIndex : 0;
      const players = Array.isArray(state.players) ? state.players : [];
      const completions = players.map((player) => Number(player.completedJournals) || 0);

      const findTriggeredDayIndex = (startIndex) => {
        for (let index = startIndex; index < DAYS.length; index += 1) {
          const day = DAYS[index];
          const threshold = DAY_THRESHOLDS[day];
          if (completions.some((value) => value >= threshold)) {
            return index;
          }
        }
        return -1;
      };

      const endedDayIndex = findTriggeredDayIndex(normalizedDayIndex);
      if (endedDayIndex < 0) {
        return {
          endedDay: null,
          skippedDay: null,
          nextDay: null,
          gameCompleted: false,
          finalDay: state.currentDay,
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
      const nextDayThreshold = DAY_THRESHOLDS[DAYS[nextDayIndex]];

      if (completions.some((value) => value >= nextDayThreshold)) {
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

    findPlayer(state, playerId) {
      const players = Array.isArray(state.players) ? state.players : [];
      return players.find((player) => player.id === playerId);
    }

    validateJournalPlacement(journal, rowIndex, columnIndex, value) {
      if (!journal.grid[rowIndex] || typeof journal.grid[rowIndex][columnIndex] === "undefined") {
        return { ok: false, reason: "out_of_bounds" };
      }
      if (journal.grid[rowIndex][columnIndex] !== null) {
        return { ok: false, reason: "cell_filled" };
      }

      const row = journal.grid[rowIndex];
      if (row.includes(value)) {
        return { ok: false, reason: "row_conflict" };
      }

      const columnValues = journal.grid.map((rowItem) => rowItem[columnIndex]);
      if (columnValues.includes(value)) {
        return { ok: false, reason: "column_conflict" };
      }

      const quadrantRowStart = Math.floor(rowIndex / 2) * 2;
      const quadrantColumnStart = Math.floor(columnIndex / 2) * 2;
      for (let rowOffset = 0; rowOffset < 2; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
          const rowValue = journal.grid[quadrantRowStart + rowOffset][quadrantColumnStart + columnOffset];
          if (rowValue === value) {
            return { ok: false, reason: "quadrant_conflict" };
          }
        }
      }

      return { ok: true, reason: null };
    }

    removeSingleValue(values, target) {
      const index = values.indexOf(target);
      if (index < 0) {
        return [...values];
      }
      return [...values.slice(0, index), ...values.slice(index + 1)];
    }

    areOrthogonallyAdjacent(a, b) {
      const delta = Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
      return delta === 1;
    }

    pathToEdgeIds(path) {
      const safePath = Array.isArray(path) ? path : [];
      const edges = [];
      for (let index = 1; index < safePath.length; index += 1) {
        const a = safePath[index - 1];
        const b = safePath[index];
        const left = "r" + String(a.row) + "c" + String(a.col);
        const right = "r" + String(b.row) + "c" + String(b.col);
        edges.push(left < right ? left + "-" + right : right + "-" + left);
      }
      return edges;
    }

    pointKey(point) {
      return String(point.row) + ":" + String(point.col);
    }

    isConnectedSelection(points) {
      const queue = [points[0]];
      const visited = new Set([this.pointKey(points[0])]);
      while (queue.length > 0) {
        const current = queue.shift();
        points.forEach((point) => {
          const key = this.pointKey(point);
          if (visited.has(key)) {
            return;
          }
          if (this.areOrthogonallyAdjacent(current, point)) {
            visited.add(key);
            queue.push(point);
          }
        });
      }
      return visited.size === points.length;
    }

    selectionToEdgeIds(points) {
      const safe = Array.isArray(points) ? points : [];
      const edges = [];
      for (let i = 0; i < safe.length; i += 1) {
        for (let j = i + 1; j < safe.length; j += 1) {
          const a = safe[i];
          const b = safe[j];
          if (!this.areOrthogonallyAdjacent(a, b)) {
            continue;
          }
          const left = "r" + String(a.row) + "c" + String(a.col);
          const right = "r" + String(b.row) + "c" + String(b.col);
          edges.push(left < right ? left + "-" + right : right + "-" + left);
        }
      }
      return edges;
    }

    canBuildThisTurn(state, playerId) {
      return this.getAvailableWrenches(playerId) >= this.getBuildCost(playerId);
    }

    hasBuiltThisTurn(state, playerId) {
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return false;
      }
      return (
        player.lastBuildAtTurn === state.turnNumber &&
        player.lastBuildAtDay === state.currentDay
      );
    }

    updateWrenchesForJournal(journal) {
      for (let rowIndex = 0; rowIndex < journal.grid.length; rowIndex += 1) {
        if (
          journal.rowWrenches[rowIndex] === "available" &&
          journal.grid[rowIndex].every((cell) => cell !== null)
        ) {
          journal.rowWrenches[rowIndex] = "earned";
        }
      }

      for (let columnIndex = 0; columnIndex < journal.grid[0].length; columnIndex += 1) {
        if (journal.columnWrenches[columnIndex] !== "available") {
          continue;
        }
        const columnComplete = journal.grid.every((row) => row[columnIndex] !== null);
        if (columnComplete) {
          journal.columnWrenches[columnIndex] = "earned";
        }
      }
    }

    isJournalComplete(journal) {
      return journal.grid.every((row) => row.every((cell) => cell !== null));
    }
  }

  root.RoundEngineService = RoundEngineService;
})(typeof window !== "undefined" ? window : globalThis);

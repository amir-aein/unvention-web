(function attachRoundEngineService(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  const PHASES = [
    "roll_and_group_dice",
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
      this.loggerService.logEvent("info", "Journaling group selected", {
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

    placeJournalNumber(playerId, rowIndex, columnIndex) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      const selections = { ...(state.journalSelections || {}) };
      const playerSelection = selections[playerId];
      if (!player || !playerSelection || !playerSelection.selectedJournalId) {
        return { ok: false, reason: "missing_selection", state };
      }

      const journal = player.journals.find((item) => item.id === playerSelection.selectedJournalId);
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
      player.completedJournals = player.journals.filter((item) => this.isJournalComplete(item)).length;

      const updatedPlayers = state.players.map((item) => (item.id === player.id ? player : item));
      const updated = this.gameStateService.update({
        players: updatedPlayers,
        journalSelections: selections,
      });

      this.loggerService.logEvent("info", "Journal number placed", {
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
        journals: Array.from({ length: JOURNAL_COUNT }, (_item, index) =>
          this.createDefaultJournal(index + 1),
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
        if (state.phase === "roll_and_group_dice") {
          return this.executeRollAndGroup(state);
        }
        if (state.phase === "journal") {
          return this.completeJournalPhase(state);
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
      const updated = this.gameStateService.update({
        phase: "workshop",
        journalSelections: clearedSelections,
      });
      this.loggerService.logEvent("info", "Journal phase completed", {
        playerId,
      });
      return updated;
    }

    executeRollAndGroup(stateAtRollPhase) {
      if (stateAtRollPhase.phase !== "roll_and_group_dice") {
        this.loggerService.logEvent("warn", "Cannot roll dice outside roll phase", {
          phase: stateAtRollPhase.phase,
        });
        return stateAtRollPhase;
      }

      const rollResult = this.rollFiveDice(stateAtRollPhase);
      const dice = rollResult.dice;
      const analysis = this.analyzeDice(dice);
      const updated = this.gameStateService.update({
        phase: "journal",
        rngState: rollResult.nextRngState,
        rollAndGroup: {
          dice: [...dice],
          outcomeType: analysis.outcomeType,
          groups: analysis.groups,
          rolledAtTurn: stateAtRollPhase.turnNumber,
          rolledAtDay: stateAtRollPhase.currentDay,
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

        this.loggerService.logEvent("info", "New day started", {
          day: progressed.currentDay,
          turnNumber: progressed.turnNumber,
          phase: progressed.phase,
        });
        return progressed;
      }

      const nextTurn = this.gameStateService.update({
        turnNumber: stateAtEndPhase.turnNumber + 1,
        phase: PHASES[0],
        journalSelections: {},
      });

      this.loggerService.logEvent("info", "Turn completed", {
        day: nextTurn.currentDay,
        turnNumber: stateAtEndPhase.turnNumber,
      });
      return nextTurn;
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

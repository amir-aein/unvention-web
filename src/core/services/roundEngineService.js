(function attachRoundEngineService(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  const PHASES = [
    "roll_and_group",
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
  const INVENTION_TEMPLATES = [
    {
      id: "I1",
      name: "The Integron Assembly",
      criterionKey: "intricacy",
      criterionLabel: "Intricacy",
      pattern: [
        "0001000",
        "0011100",
        "1111111",
        "1111111",
      ],
    },
    {
      id: "I2",
      name: "The Unison Motorworks",
      criterionKey: "synchrony",
      criterionLabel: "Synchrony",
      pattern: [
        "00110011",
        "11111111",
        "11111111",
        "11001100",
      ],
    },
    {
      id: "I3",
      name: "The Lateral Arc Engine",
      criterionKey: "modularity",
      criterionLabel: "Modularity",
      pattern: [
        "01000010",
        "11100111",
        "11111111",
        "11111111",
        "11100111",
        "01000010",
      ],
    },
  ];
  const INVENTION_COUNT = INVENTION_TEMPLATES.length;
  const BUILD_WRENCH_COST = 2;
  const VARIETY_BONUS_BY_TYPE_COUNT = {
    1: 0,
    2: 3,
    3: 7,
    4: 12,
  };
  const COMPLETION_BONUS_BY_INVENTION_AND_DAY = {
    I1: { Friday: 10, Saturday: 8, Sunday: 5 },
    I2: { Friday: 13, Saturday: 11, Sunday: 8 },
    I3: { Friday: 18, Saturday: 16, Sunday: 12 },
  };
  const TOOL_TEMPLATES = [
    {
      id: "T1",
      name: "Torque",
      firstUnlockPoints: 4,
      laterUnlockPoints: 2,
      abilityText: "You may rotate and/or mirror shapes.",
      // Plus shape.
      pattern: [
        "010",
        "111",
        "010",
      ],
    },
    {
      id: "T2",
      name: "Flywheel",
      firstUnlockPoints: 3,
      laterUnlockPoints: 1,
      abilityText: "Building mechanisms costs 1 wrench.",
      // Icon shape from sheet.
      pattern: [
        "0010",
        "1110",
        "0111",
        "0100",
      ],
    },
    {
      id: "T3",
      name: "Ball Bearing",
      firstUnlockPoints: 3,
      laterUnlockPoints: 1,
      abilityText: "Once per turn, you may modify a single die by ±1.",
      // Icon shape from sheet.
      pattern: [
        "1100",
        "1111",
        "0011",
      ],
    },
    {
      id: "T4",
      name: "Reamer",
      firstUnlockPoints: 5,
      laterUnlockPoints: 2,
      abilityText: "You may mark multiple workshops or journals in a single turn.",
      // Icon shape from sheet.
      pattern: [
        "101",
        "111",
        "101",
      ],
    },
  ];
  const FORCE_BUILD_CHEAT_FOR_TESTING = false;
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

  function normalizeCount(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
  }

  function normalizeGameConfig(input) {
    const candidate = input && typeof input === "object" ? input : {};
    const customRuleset = candidate.ruleset && typeof candidate.ruleset === "object"
      ? JSON.parse(JSON.stringify(candidate.ruleset))
      : null;
    const maxWorkshopCount = Array.isArray(customRuleset?.workshopLayouts) && customRuleset.workshopLayouts.length > 0
      ? customRuleset.workshopLayouts.length
      : WORKSHOP_LAYOUTS.length;
    return {
      journalCount: normalizeCount(candidate.journalCount, JOURNAL_COUNT, 1, 6),
      workshopCount: normalizeCount(candidate.workshopCount, WORKSHOP_COUNT, 1, maxWorkshopCount),
      ruleset: customRuleset,
    };
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

    getGameConfig(stateInput) {
      const state = stateInput || this.gameStateService.getState();
      return normalizeGameConfig(state.gameConfig);
    }

    getRuleset(stateInput) {
      const state = stateInput || this.gameStateService.getState();
      const config = this.getGameConfig(state);
      const globalDefault = typeof root.createDefaultRuleset === "function" ? root.createDefaultRuleset() : {};
      const custom = config.ruleset && typeof config.ruleset === "object" ? config.ruleset : null;
      const ruleset = custom
        ? {
            ...globalDefault,
            ...custom,
          }
        : globalDefault;
      return {
        inventionTemplates: Array.isArray(ruleset.inventionTemplates) && ruleset.inventionTemplates.length > 0
          ? ruleset.inventionTemplates
          : INVENTION_TEMPLATES,
        toolTemplates: Array.isArray(ruleset.toolTemplates) && ruleset.toolTemplates.length > 0
          ? ruleset.toolTemplates
          : TOOL_TEMPLATES,
        workshopLayouts: Array.isArray(ruleset.workshopLayouts) && ruleset.workshopLayouts.length > 0
          ? ruleset.workshopLayouts
          : WORKSHOP_LAYOUTS,
        workshopIdeaAnchors: ruleset.workshopIdeaAnchors && typeof ruleset.workshopIdeaAnchors === "object"
          ? ruleset.workshopIdeaAnchors
          : WORKSHOP_IDEA_ANCHORS,
        varietyBonusByTypeCount: ruleset.varietyBonusByTypeCount && typeof ruleset.varietyBonusByTypeCount === "object"
          ? ruleset.varietyBonusByTypeCount
          : VARIETY_BONUS_BY_TYPE_COUNT,
        completionBonusByInventionAndDay: ruleset.completionBonusByInventionAndDay &&
          typeof ruleset.completionBonusByInventionAndDay === "object"
          ? ruleset.completionBonusByInventionAndDay
          : COMPLETION_BONUS_BY_INVENTION_AND_DAY,
      };
    }

    getWorkshopLayoutsForSeed(_seed, stateInput) {
      // Intentionally fixed for now; later this can return a deterministic
      // permutation based on seed without changing workshop consumers.
      const ruleset = this.getRuleset(stateInput);
      return ruleset.workshopLayouts;
    }

    getWorkshopIds(stateInput) {
      const config = this.getGameConfig(stateInput);
      return Array.from({ length: config.workshopCount }, (_item, index) => "W" + String(index + 1));
    }

    getDefaultInventionCatalog() {
      const ruleset = this.getRuleset();
      const templates = Array.isArray(ruleset.inventionTemplates)
        ? ruleset.inventionTemplates
        : INVENTION_TEMPLATES;
      return templates.map((template) => ({
        id: template.id,
        name: template.name,
        criterionKey: template.criterionKey,
        criterionLabel: template.criterionLabel,
        pattern: template.pattern.map((row) => String(row)),
      }));
    }

    getDefaultToolCatalog() {
      const ruleset = this.getRuleset();
      const templates = Array.isArray(ruleset.toolTemplates) ? ruleset.toolTemplates : TOOL_TEMPLATES;
      return templates.map((template) => {
        const pattern = template.pattern.map((row) => String(row));
        const points = this.patternToPoints(pattern);
        return {
          id: template.id,
          name: template.name,
          abilityText: String(template.abilityText || ""),
          firstUnlockPoints: Number(template.firstUnlockPoints),
          laterUnlockPoints: Number(template.laterUnlockPoints),
          pattern,
          shapeSignature: this.getMechanismShapeSignature(points, true),
        };
      });
    }

    hasTool(playerId, toolRef) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return false;
      }
      const catalog = this.getDefaultToolCatalog();
      const byId = new Map(catalog.map((tool) => [tool.id, tool]));
      const byName = new Map(catalog.map((tool) => [String(tool.name).toLowerCase(), tool]));
      const tool =
        byId.get(String(toolRef || "")) ||
        byName.get(String(toolRef || "").toLowerCase()) ||
        null;
      if (!tool) {
        return false;
      }
      const unlocked = Array.isArray(player.unlockedTools) ? player.unlockedTools : [];
      return unlocked.some((item) => String(item.id) === String(tool.id));
    }

    isBuildCheatEnabled() {
      return FORCE_BUILD_CHEAT_FOR_TESTING;
    }

    getActiveTools(playerId) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      const unlockedById = new Map(
        (Array.isArray(player?.unlockedTools) ? player.unlockedTools : []).map((tool) => [String(tool.id), tool]),
      );
      return this.getDefaultToolCatalog().map((tool) => ({
        ...tool,
        active: this.hasTool(playerId, tool.id),
        unlock: unlockedById.get(String(tool.id)) || null,
      }));
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
        return [
          {
            key: "workshop-eureka-any",
            label: "Any part",
            values: [0],
          },
        ];
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

    getBuildCost(playerId) {
      if (this.isBuildCheatEnabled()) {
        return 0;
      }
      return this.hasTool(playerId, "T2") ? 1 : BUILD_WRENCH_COST;
    }

    getOrCreateTurnToolUsage(state, playerId) {
      const usage = state.turnToolUsage?.[playerId];
      if (usage && typeof usage === "object") {
        return {
          ballBearingUsed: Boolean(usage.ballBearingUsed),
        };
      }
      return {
        ballBearingUsed: false,
      };
    }

    getAdjustedNumberChoices(playerId, remainingNumbers) {
      if (!this.hasTool(playerId, "T3")) {
        return [];
      }
      const state = this.gameStateService.getState();
      const usage = this.getOrCreateTurnToolUsage(state, playerId);
      if (usage.ballBearingUsed) {
        return [];
      }
      const values = Array.isArray(remainingNumbers) ? remainingNumbers.map((value) => Number(value)) : [];
      const seenUsedValues = new Set(values.map((value) => String(value)));
      const choices = [];
      const seenAdjusted = new Set();
      values.forEach((sourceValue) => {
        [-1, 1].forEach((offset) => {
          const adjustedValue = sourceValue + offset;
          if (adjustedValue < 1 || adjustedValue > 6 || adjustedValue === sourceValue) {
            return;
          }
          if (seenUsedValues.has(String(adjustedValue))) {
            return;
          }
          if (seenAdjusted.has(String(adjustedValue))) {
            return;
          }
          seenAdjusted.add(String(adjustedValue));
          seenUsedValues.add(String(adjustedValue));
          choices.push({
            key: "adj-" + String(sourceValue) + "-" + String(adjustedValue),
            usedValue: adjustedValue,
            consumeValue: sourceValue,
            adjusted: true,
          });
        });
      });
      return choices;
    }

    getJournalNumberChoices(playerId) {
      const state = this.gameStateService.getState();
      const selection = state.journalSelections?.[playerId];
      const remaining = Array.isArray(selection?.remainingNumbers) ? selection.remainingNumbers : [];
      const direct = remaining.map((value, index) => ({
        key: "base-" + String(index) + "-" + String(value),
        usedValue: Number(value),
        consumeValue: Number(value),
        adjusted: false,
      }));
      return [...direct, ...this.getAdjustedNumberChoices(playerId, remaining)];
    }

    getWorkshopNumberChoices(playerId) {
      const state = this.gameStateService.getState();
      if (state.phase === "workshop" && state.rollAndGroup?.outcomeType === "eureka") {
        return [];
      }
      const selection = state.workshopSelections?.[playerId];
      const remaining = Array.isArray(selection?.remainingNumbers) ? selection.remainingNumbers : [];
      const direct = remaining.map((value, index) => ({
        key: "base-" + String(index) + "-" + String(value),
        usedValue: Number(value),
        consumeValue: Number(value),
        adjusted: false,
      }));
      return [...direct, ...this.getAdjustedNumberChoices(playerId, remaining)];
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
        activePick: {
          usedValue: selected.values[0] || null,
          consumeValue: selected.values[0] || null,
          adjusted: false,
        },
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

      if (
        !this.hasTool(playerId, "T4") &&
        playerSelection.selectedJournalId &&
        playerSelection.selectedJournalId !== journalId
      ) {
        this.loggerService.logEvent("warn", "Journal selection is locked for this turn", {
          playerId,
          selectedJournalId: playerSelection.selectedJournalId,
        });
        return state;
      }

      playerSelection.selectedJournalId = journalId;
      playerSelection.journalLocked = !this.hasTool(playerId, "T4");
      selections[playerId] = playerSelection;
      return this.gameStateService.update({ journalSelections: selections });
    }

    selectActiveJournalNumber(playerId, numberValue, consumeValue, adjustedFlag) {
      const state = this.gameStateService.getState();
      const selections = { ...(state.journalSelections || {}) };
      const playerSelection = selections[playerId];
      if (!playerSelection) {
        return state;
      }

      const value = Number(numberValue);
      const consume = Number.isInteger(Number(consumeValue)) ? Number(consumeValue) : value;
      const adjusted = String(adjustedFlag) === "true";
      const validChoice = this.getJournalNumberChoices(playerId).find(
        (choice) =>
          Number(choice.usedValue) === value &&
          Number(choice.consumeValue) === consume &&
          Boolean(choice.adjusted) === adjusted,
      );
      if (!validChoice) {
        return state;
      }

      playerSelection.activeNumber = value;
      playerSelection.activePick = {
        usedValue: value,
        consumeValue: consume,
        adjusted,
      };
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
        activePick: {
          usedValue: selected.values[0] || null,
          consumeValue: selected.values[0] || null,
          adjusted: false,
        },
        selectedWorkshopId: existing.selectedWorkshopId || null,
        workshopLocked: !this.hasTool(playerId, "T4") && Boolean(existing.selectedWorkshopId),
        placementsThisTurn: existing.placementsThisTurn || 0,
        wrenchPickPending: false,
      };
      const updated = this.gameStateService.update({ workshopSelections: selections });
      this.loggerService.logEvent("info", "Player X selected workshopping group " + selected.values.join(", "), {
        playerId,
        values: selected.values,
      });
      return updated;
    }

    selectActiveWorkshopNumber(playerId, numberValue, consumeValue, adjustedFlag) {
      const state = this.gameStateService.getState();
      const selections = { ...(state.workshopSelections || {}) };
      const playerSelection = selections[playerId];
      if (!playerSelection) {
        return state;
      }
      const value = Number(numberValue);
      const consume = Number.isInteger(Number(consumeValue)) ? Number(consumeValue) : value;
      const adjusted = String(adjustedFlag) === "true";
      const validChoice = this.getWorkshopNumberChoices(playerId).find(
        (choice) =>
          Number(choice.usedValue) === value &&
          Number(choice.consumeValue) === consume &&
          Boolean(choice.adjusted) === adjusted,
      );
      if (!validChoice) {
        return state;
      }
      playerSelection.activeNumber = value;
      playerSelection.activePick = {
        usedValue: value,
        consumeValue: consume,
        adjusted,
      };
      selections[playerId] = playerSelection;
      return this.gameStateService.update({ workshopSelections: selections });
    }

    activateWorkshopWrenchPick(playerId) {
      const state = this.gameStateService.getState();
      if (state.phase !== "workshop") {
        return state;
      }
      const available = this.getAvailableWrenches(playerId);
      if (available < 1) {
        this.loggerService.logEvent("warn", "Cannot use wrench for workshop part (no wrenches available)", {
          playerId,
        });
        return state;
      }
      const selections = { ...(state.workshopSelections || {}) };
      const existing = selections[playerId] || {};
      selections[playerId] = {
        ...existing,
        wrenchPickPending: true,
      };
      return this.gameStateService.update({ workshopSelections: selections });
    }

    placeWorkshopPartByWrench(playerId, workshopId, rowIndex, columnIndex) {
      const state = this.gameStateService.getState();
      if (state.phase !== "workshop") {
        return { ok: false, reason: "invalid_phase", state };
      }
      const available = this.getAvailableWrenches(playerId);
      if (available < 1) {
        return { ok: false, reason: "insufficient_wrenches", state };
      }
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return { ok: false, reason: "missing_player", state };
      }
      const workshop = player.workshops.find((item) => item.id === workshopId);
      if (!workshop) {
        return { ok: false, reason: "invalid_workshop", state };
      }
      const row = workshop.cells?.[rowIndex];
      const cell = row?.[columnIndex];
      if (!cell || cell.kind === "empty") {
        return { ok: false, reason: "out_of_bounds", state };
      }
      if (cell.circled) {
        return { ok: false, reason: "already_circled", state };
      }

      workshop.cells[rowIndex][columnIndex] = { ...cell, circled: true };
      workshop.partsByNumber = this.countWorkshopPartsByNumber(workshop.cells);
      workshop.lastWorkedAtTurn = state.turnNumber;
      workshop.lastWorkedAtDay = state.currentDay;
      player.spentWrenches = Number(player.spentWrenches || 0) + 1;

      const updatedPlayers = state.players.map((item) => (item.id === playerId ? player : item));
      const selections = { ...(state.workshopSelections || {}) };
      const existing = selections[playerId] || {};
      selections[playerId] = {
        ...existing,
        wrenchPickPending: false,
      };
      const updated = this.gameStateService.update({
        players: updatedPlayers,
        workshopSelections: selections,
      });
      this.loggerService.logEvent(
        "info",
        "Player X used 1 wrench to add part in " +
          String(workshop.id) +
          " at R" +
          String(rowIndex + 1) +
          "C" +
          String(columnIndex + 1),
        {
          playerId,
          workshopId,
          rowIndex,
          columnIndex,
          wrenchCost: 1,
        },
      );
      return { ok: true, reason: null, state: updated };
    }

    placeWorkshopPart(playerId, workshopId, rowIndex, columnIndex) {
      const state = this.gameStateService.getState();
      if (state.phase !== "workshop") {
        return { ok: false, reason: "invalid_phase", state };
      }
      const isEurekaWorkshop = state.rollAndGroup?.outcomeType === "eureka";
      const selection = state.workshopSelections?.[playerId];
      if (!isEurekaWorkshop && !selection?.selectedGroupValues?.length) {
        return { ok: false, reason: "missing_selection", state };
      }
      if (isEurekaWorkshop && Number(selection?.placementsThisTurn || 0) >= 1) {
        return { ok: false, reason: "missing_number", state };
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
        !isEurekaWorkshop &&
        !this.hasTool(playerId, "T4") &&
        selection.selectedWorkshopId &&
        selection.selectedWorkshopId !== workshopId
      ) {
        return { ok: false, reason: "workshop_locked", state };
      }

      const row = workshop.cells?.[rowIndex];
      const cell = row?.[columnIndex];
      if (!cell || cell.kind === "empty") {
        return { ok: false, reason: "out_of_bounds", state };
      }
      if (cell.circled) {
        return { ok: false, reason: "already_circled", state };
      }

      if (isEurekaWorkshop) {
        workshop.cells[rowIndex][columnIndex] = { ...cell, circled: true };
        workshop.partsByNumber = this.countWorkshopPartsByNumber(workshop.cells);
        workshop.lastWorkedAtTurn = state.turnNumber;
        workshop.lastWorkedAtDay = state.currentDay;

        const selections = { ...(state.workshopSelections || {}) };
        const existing = selection || {};
        selections[playerId] = {
          ...existing,
          selectedWorkshopId: null,
          workshopLocked: false,
          remainingNumbers: [],
          activeNumber: null,
          activePick: null,
          placementsThisTurn: Number(existing.placementsThisTurn || 0) + 1,
          wrenchPickPending: false,
        };
        const updatedPlayers = state.players.map((item) => (item.id === playerId ? player : item));
        const updated = this.gameStateService.update({
          players: updatedPlayers,
          workshopSelections: selections,
        });
        this.loggerService.logEvent(
          "info",
          "Player X added part in " +
            String(workshop.id) +
            " at R" +
            String(rowIndex + 1) +
            "C" +
            String(columnIndex + 1) +
            " (eureka)",
          {
            playerId,
            workshopId,
            rowIndex,
            columnIndex,
            outcomeType: "eureka",
          },
        );
        return { ok: true, reason: null, state: updated };
      }

      const activePick = selection?.activePick || {
        usedValue: Number(selection?.activeNumber),
        consumeValue: Number(selection?.activeNumber),
        adjusted: false,
      };
      const activeNumber = Number(activePick.usedValue);
      const remainingNumbers = Array.isArray(selection?.remainingNumbers) ? selection.remainingNumbers : [];
      if (remainingNumbers.length === 0) {
        return { ok: false, reason: "missing_number", state };
      }
      const valueUsed = cell.kind === "number"
        ? Number(cell.value)
        : Number.isInteger(activeNumber) && remainingNumbers.includes(Number(activePick.consumeValue))
          ? activeNumber
          : Number(remainingNumbers[0]);
      const consumeValue = cell.kind === "number"
        ? (activePick.adjusted ? Number(activePick.consumeValue) : Number(cell.value))
        : Number(activePick.consumeValue);
      if (activePick.adjusted && Number(valueUsed) !== Number(activePick.usedValue)) {
        return { ok: false, reason: "number_mismatch", state };
      }
      if (!Number.isInteger(valueUsed) || !remainingNumbers.includes(consumeValue)) {
        return { ok: false, reason: "number_mismatch", state };
      }

      workshop.cells[rowIndex][columnIndex] = { ...cell, circled: true };
      workshop.partsByNumber = this.countWorkshopPartsByNumber(workshop.cells);
      workshop.lastWorkedAtTurn = state.turnNumber;
      workshop.lastWorkedAtDay = state.currentDay;

      const turnToolUsage = { ...(state.turnToolUsage || {}) };
      const usage = this.getOrCreateTurnToolUsage(state, playerId);
      if (activePick.adjusted) {
        usage.ballBearingUsed = true;
      }
      turnToolUsage[playerId] = usage;

      const selections = { ...(state.workshopSelections || {}) };
      selections[playerId] = {
        ...selection,
        selectedWorkshopId: workshopId,
        workshopLocked: !this.hasTool(playerId, "T4"),
        remainingNumbers: this.removeSingleValue(remainingNumbers, consumeValue),
        placementsThisTurn: Number(selection.placementsThisTurn || 0) + 1,
        wrenchPickPending: false,
      };
      selections[playerId].activeNumber = selections[playerId].remainingNumbers[0] || null;
      selections[playerId].activePick = {
        usedValue: selections[playerId].activeNumber,
        consumeValue: selections[playerId].activeNumber,
        adjusted: false,
      };
      const updatedPlayers = state.players.map((item) => (item.id === playerId ? player : item));
      const updated = this.gameStateService.update({
        players: updatedPlayers,
        workshopSelections: selections,
        turnToolUsage,
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
      if (!cell.circled && !this.isBuildCheatEnabled()) {
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

      const workshop = player.workshops.find((item) => item.id === draft.workshopId);
      const unlockedIdeas = workshop
        ? this.updateUnlockedWorkshopIdeas(workshop, draft.path, state)
        : [];
      const mechanisms = Array.isArray(player.mechanisms) ? [...player.mechanisms] : [];
      mechanisms.push({
        id: "M" + String(mechanisms.length + 1),
        workshopId: draft.workshopId,
        path: draft.path.map((item) => ({ row: item.row, col: item.col })),
        edges: this.selectionToEdgeIds(draft.path),
        ideaCount: unlockedIdeas.length,
        usedInventionId: null,
        inventionPlacement: null,
        builtAtTurn: state.turnNumber,
        builtAtDay: state.currentDay,
      });
      player.mechanisms = mechanisms;
      const latestMechanism = mechanisms[mechanisms.length - 1];
      const toolUnlockResult = this.unlockToolsForMechanism(playerId, player, latestMechanism, state);
      player.spentWrenches = Number(player.spentWrenches || 0) + cost;
      player.lastBuildAtTurn = state.turnNumber;
      player.lastBuildAtDay = state.currentDay;

      const players = state.players.map((item) => (item.id === player.id ? player : item));
      const drafts = { ...(state.buildDrafts || {}) };
      delete drafts[playerId];
      const updated = this.gameStateService.update({
        players,
        buildDrafts: drafts,
        toolUnlockRegistry: toolUnlockResult.registry,
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
      toolUnlockResult.unlocked.forEach((unlock) => {
        this.loggerService.logEvent(
          "info",
          "You unlocked " + String(unlock.name) + " (+" + String(unlock.pointsAwarded) + ")",
          {
            playerId,
            toolId: unlock.id,
            pointsAwarded: unlock.pointsAwarded,
            unlockTier: unlock.unlockTier,
            mechanismId: latestMechanism.id,
          },
        );
      });
      return {
        ok: true,
        reason: null,
        state: updated,
        unlockedTools: toolUnlockResult.unlocked,
      };
    }

    unlockToolsForMechanism(playerId, player, mechanism, state) {
      const tools = this.getDefaultToolCatalog();
      const mechanismSignature = this.getMechanismShapeSignature(mechanism.path, true);
      const alreadyUnlocked = new Set(
        (Array.isArray(player.unlockedTools) ? player.unlockedTools : []).map((item) => String(item.id)),
      );
      const registry = {
        ...(state.toolUnlockRegistry || {}),
      };
      const unlocked = [];

      tools.forEach((tool) => {
        if (!tool.shapeSignature || tool.shapeSignature !== mechanismSignature) {
          return;
        }
        if (alreadyUnlocked.has(String(tool.id))) {
          return;
        }

        const existing = registry[tool.id];
        const sameTurnAsFirstUnlock =
          Boolean(existing) &&
          Number(existing.firstUnlockedTurn) === Number(state.turnNumber) &&
          String(existing.firstUnlockedDay) === String(state.currentDay);
        const isFirstUnlockTier = !existing || sameTurnAsFirstUnlock;
        const pointsAwarded = isFirstUnlockTier
          ? Number(tool.firstUnlockPoints)
          : Number(tool.laterUnlockPoints);

        const nextUnlock = {
          id: tool.id,
          name: tool.name,
          unlockTier: isFirstUnlockTier ? "first" : "later",
          pointsAwarded,
          firstUnlockPoints: Number(tool.firstUnlockPoints),
          laterUnlockPoints: Number(tool.laterUnlockPoints),
          unlockedAtTurn: Number(state.turnNumber),
          unlockedAtDay: String(state.currentDay),
          mechanismId: String(mechanism.id || ""),
        };
        player.unlockedTools = Array.isArray(player.unlockedTools)
          ? [...player.unlockedTools, nextUnlock]
          : [nextUnlock];
        player.toolScore = Number(player.toolScore || 0) + pointsAwarded;
        unlocked.push(nextUnlock);

        if (!existing) {
          registry[tool.id] = {
            firstUnlockedTurn: Number(state.turnNumber),
            firstUnlockedDay: String(state.currentDay),
            playerIds: [String(playerId)],
          };
          return;
        }
        if (sameTurnAsFirstUnlock) {
          const existingPlayers = Array.isArray(existing.playerIds) ? [...existing.playerIds] : [];
          if (!existingPlayers.includes(String(playerId))) {
            existingPlayers.push(String(playerId));
          }
          registry[tool.id] = {
            ...existing,
            playerIds: existingPlayers,
          };
        }
      });

      return { unlocked, registry };
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

    getPendingMechanismForInvent(playerId) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      if (!player || !Array.isArray(player.mechanisms)) {
        return null;
      }
      const pending = [...player.mechanisms]
        .filter(
          (item) =>
            item.builtAtTurn === state.turnNumber &&
            item.builtAtDay === state.currentDay &&
            !item.usedInventionId,
        )
        .sort((a, b) => String(b.id).localeCompare(String(a.id)))[0];
      return pending || null;
    }

    getOrCreateInventTransform(state, playerId) {
      const existing = state.inventTransforms?.[playerId];
      if (existing && typeof existing === "object") {
        return {
          rotation: ((Number(existing.rotation) % 4) + 4) % 4,
          mirrored: Boolean(existing.mirrored),
        };
      }
      return {
        rotation: 0,
        mirrored: false,
      };
    }

    setInventTransform(playerId, transform) {
      const state = this.gameStateService.getState();
      const transforms = { ...(state.inventTransforms || {}) };
      transforms[playerId] = {
        rotation: ((Number(transform?.rotation || 0) % 4) + 4) % 4,
        mirrored: Boolean(transform?.mirrored),
      };
      return this.gameStateService.update({ inventTransforms: transforms });
    }

    rotatePendingMechanismForInvent(playerId, direction) {
      const state = this.gameStateService.getState();
      if (state.phase !== "invent") {
        return state;
      }
      const delta = direction === "ccw" ? -1 : 1;
      const current = this.getOrCreateInventTransform(state, playerId);
      return this.setInventTransform(playerId, {
        ...current,
        rotation: current.rotation + delta,
      });
    }

    toggleMirrorPendingMechanismForInvent(playerId) {
      const state = this.gameStateService.getState();
      if (state.phase !== "invent") {
        return state;
      }
      const current = this.getOrCreateInventTransform(state, playerId);
      return this.setInventTransform(playerId, {
        ...current,
        mirrored: !current.mirrored,
      });
    }

    resetPendingMechanismTransform(playerId) {
      return this.setInventTransform(playerId, { rotation: 0, mirrored: false });
    }

    getMechanismNormalizedShape(path) {
      const points = Array.isArray(path) ? path : [];
      if (points.length === 0) {
        return [];
      }
      const minRow = Math.min(...points.map((point) => Number(point.row)));
      const minCol = Math.min(...points.map((point) => Number(point.col)));
      return points.map((point) => ({
        row: Number(point.row) - minRow,
        col: Number(point.col) - minCol,
      }));
    }

    transformMechanismShape(points, transform) {
      const normalized = this.getMechanismNormalizedShape(points);
      if (normalized.length === 0) {
        return [];
      }
      const safeRotation = ((Number(transform?.rotation || 0) % 4) + 4) % 4;
      const mirrored = Boolean(transform?.mirrored);
      const transformed = normalized.map((point) => {
        let row = Number(point.row);
        let col = Number(point.col);
        if (mirrored) {
          col = -col;
        }
        for (let i = 0; i < safeRotation; i += 1) {
          const nextRow = col;
          const nextCol = -row;
          row = nextRow;
          col = nextCol;
        }
        return { row, col };
      });
      return this.getMechanismNormalizedShape(transformed);
    }

    getPendingMechanismInventShape(playerId) {
      const state = this.gameStateService.getState();
      const mechanism = this.getPendingMechanismForInvent(playerId);
      if (!mechanism) {
        return {
          points: [],
          rotation: 0,
          mirrored: false,
          toolActive: false,
        };
      }
      const toolActive = this.hasTool(playerId, "T1");
      const transform = toolActive
        ? this.getOrCreateInventTransform(state, playerId)
        : { rotation: 0, mirrored: false };
      const points = this.transformMechanismShape(mechanism.path, transform);
      return {
        points,
        rotation: transform.rotation,
        mirrored: transform.mirrored,
        toolActive,
      };
    }

    isInventionPatternOpen(invention, row, col) {
      const rows = Array.isArray(invention?.pattern) ? invention.pattern.map((item) => String(item)) : [];
      if (row < 0 || col < 0 || row >= rows.length) {
        return false;
      }
      const rowText = rows[row] || "";
      if (col >= rowText.length) {
        return false;
      }
      return rowText[col] === "1";
    }

    computeInventionPlacementPreview(playerId, inventionId, anchorRow, anchorCol) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return { ok: false, reason: "missing_player", cells: [] };
      }
      const invention = (player.inventions || []).find((item) => item.id === inventionId);
      if (!invention) {
        return { ok: false, reason: "invalid_invention", cells: [] };
      }
      if (invention.presentedDay) {
        return { ok: false, reason: "invention_presented", cells: [] };
      }
      const mechanism = this.getPendingMechanismForInvent(playerId);
      if (!mechanism) {
        return { ok: false, reason: "missing_mechanism", cells: [] };
      }
      const shape = this.getPendingMechanismInventShape(playerId);
      const points = Array.isArray(shape.points) ? shape.points : [];
      if (points.length === 0) {
        return { ok: false, reason: "invalid_mechanism", cells: [] };
      }
      const baseRow = Number(anchorRow);
      const baseCol = Number(anchorCol);
      const placementCells = points.map((point) => ({
        row: baseRow + Number(point.row),
        col: baseCol + Number(point.col),
      }));
      const occupied = new Set(
        (Array.isArray(invention.placements) ? invention.placements : [])
          .flatMap((item) => (Array.isArray(item.cells) ? item.cells : []))
          .map((cell) => String(cell.row) + ":" + String(cell.col)),
      );
      const allOpen = placementCells.every((cell) => this.isInventionPatternOpen(invention, cell.row, cell.col));
      const noOverlap = placementCells.every((cell) => !occupied.has(String(cell.row) + ":" + String(cell.col)));
      return {
        ok: allOpen && noOverlap,
        reason: allOpen ? (noOverlap ? null : "overlap") : "out_of_pattern",
        cells: placementCells,
        inventionId: invention.id,
        mechanismId: mechanism.id,
        workshopId: mechanism.workshopId,
        ideaCount: Number(mechanism.ideaCount || 0),
        variantIndex: null,
      };
    }

    placeMechanismInInvention(playerId, inventionId, anchorRow, anchorCol) {
      const state = this.gameStateService.getState();
      if (state.phase !== "invent") {
        return { ok: false, reason: "invalid_phase", state };
      }
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return { ok: false, reason: "missing_player", state };
      }
      const preview = this.computeInventionPlacementPreview(playerId, inventionId, anchorRow, anchorCol);
      if (!preview.ok) {
        return { ok: false, reason: preview.reason || "invalid_placement", state };
      }
      const inventions = Array.isArray(player.inventions) ? player.inventions : [];
      const inventionIndex = inventions.findIndex((item) => item.id === inventionId);
      if (inventionIndex < 0) {
        return { ok: false, reason: "invalid_invention", state };
      }
      const invention = inventions[inventionIndex];
      if (invention.presentedDay) {
        return { ok: false, reason: "invention_presented", state };
      }
      const mechanismIndex = (Array.isArray(player.mechanisms) ? player.mechanisms : []).findIndex(
        (item) => item.id === preview.mechanismId,
      );
      if (mechanismIndex < 0) {
        return { ok: false, reason: "missing_mechanism", state };
      }
      const mechanism = player.mechanisms[mechanismIndex];
      mechanism.usedInventionId = invention.id;
      mechanism.inventionPlacement = {
        anchorRow: Number(anchorRow),
        anchorCol: Number(anchorCol),
        cells: preview.cells.map((cell) => ({ row: cell.row, col: cell.col })),
      };

      const placements = Array.isArray(invention.placements) ? [...invention.placements] : [];
      placements.push({
        mechanismId: mechanism.id,
        workshopId: mechanism.workshopId,
        cells: preview.cells.map((cell) => ({ row: cell.row, col: cell.col })),
      });
      invention.placements = placements;
      invention.usedMechanismIds = Array.isArray(invention.usedMechanismIds)
        ? [...new Set([...invention.usedMechanismIds, mechanism.id])]
        : [mechanism.id];
      invention.workshopTypeMarks = {
        ...(invention.workshopTypeMarks || {}),
        [mechanism.workshopId]: true,
      };
      const nextIdeas = Math.min(6, Math.max(1, Number(invention.uniqueIdeasMarked || 1) + Number(preview.ideaCount || 0)));
      invention.uniqueIdeasMarked = nextIdeas;
      invention.multiplier = nextIdeas;
      this.recalculateInventionScoring(player, invention, state.currentDay);

      const players = state.players.map((item) => (item.id === player.id ? player : item));
      let updated = this.gameStateService.update({ players });
      if (this.hasTool(playerId, "T1")) {
        updated = this.resetPendingMechanismTransform(playerId);
      }
      this.loggerService.logEvent(
        "info",
        "Player X placed mechanism " + String(mechanism.id) + " into " + String(invention.name),
        {
          playerId,
          inventionId: invention.id,
          mechanismId: mechanism.id,
          workshopId: mechanism.workshopId,
          ideaMarksAdded: Number(preview.ideaCount || 0),
        },
      );
      return { ok: true, reason: null, state: updated };
    }

    getPendingJournalIdeaJournals(playerId) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return [];
      }
      return (Array.isArray(player.journals) ? player.journals : []).filter(
        (journal) => journal.ideaStatus === "completed" && !journal.ideaAssignedToInventionId,
      );
    }

    assignJournalIdeaToInvention(playerId, journalId, inventionId) {
      const state = this.gameStateService.getState();
      const player = this.findPlayer(state, playerId);
      if (!player) {
        return { ok: false, reason: "missing_player", state };
      }
      const journal = (player.journals || []).find((item) => item.id === journalId);
      if (!journal) {
        return { ok: false, reason: "invalid_journal", state };
      }
      if (journal.ideaStatus !== "completed" || journal.ideaAssignedToInventionId) {
        return { ok: false, reason: "idea_not_assignable", state };
      }
      const invention = (player.inventions || []).find((item) => item.id === inventionId);
      if (!invention) {
        return { ok: false, reason: "invalid_invention", state };
      }
      if (invention.presentedDay) {
        return { ok: false, reason: "invention_presented", state };
      }
      journal.ideaAssignedToInventionId = invention.id;
      const nextIdeas = Math.min(6, Math.max(1, Number(invention.uniqueIdeasMarked || 1) + 1));
      invention.uniqueIdeasMarked = nextIdeas;
      invention.multiplier = nextIdeas;
      this.recalculateInventionScoring(player, invention, state.currentDay);
      const players = state.players.map((item) => (item.id === player.id ? player : item));
      const activePlayerId = this.getActivePlayerId({
        ...state,
        players,
      });
      const updated = this.gameStateService.update({
        players,
        activePlayerId,
      });
      this.loggerService.logEvent(
        "info",
        "Player X assigned journal idea " + String(journal.id) + " to " + String(invention.name),
        {
          playerId,
          journalId,
          inventionId,
        },
      );
      return { ok: true, reason: null, state: updated };
    }

    recalculateInventionScoring(player, invention, currentDay) {
      const mechanismsById = new Map(
        (Array.isArray(player.mechanisms) ? player.mechanisms : []).map((item) => [item.id, item]),
      );
      const placements = Array.isArray(invention.placements) ? invention.placements : [];
      const usedMechanisms = placements
        .map((placement) => mechanismsById.get(placement.mechanismId))
        .filter(Boolean);
      const uniqueMultiplier = Math.min(6, Math.max(1, Number(invention.uniqueIdeasMarked || invention.multiplier || 1)));
      invention.uniqueIdeasMarked = uniqueMultiplier;
      invention.multiplier = uniqueMultiplier;

      const usedWorkshopTypes = Object.entries(invention.workshopTypeMarks || {})
        .filter(([_workshopId, marked]) => Boolean(marked))
        .map(([workshopId]) => workshopId);
      const typeCount = usedWorkshopTypes.length;
      const ruleset = this.getRuleset();
      const varietyBonusByTypeCount = ruleset.varietyBonusByTypeCount || VARIETY_BONUS_BY_TYPE_COUNT;
      const maxVarietyTypeCount = Math.max(
        0,
        ...Object.keys(varietyBonusByTypeCount).map((value) => Number(value)),
      );
      const variety = typeCount > 0
        ? Number(varietyBonusByTypeCount[Math.min(maxVarietyTypeCount, typeCount)] || 0)
        : 0;

      const openCellCount = (Array.isArray(invention.pattern) ? invention.pattern : [])
        .map((row) => String(row))
        .reduce(
          (count, row) =>
            count +
            row
              .split("")
              .filter((cell) => cell === "1").length,
          0,
        );
      const filledCellCount = placements.reduce(
        (count, placement) => count + (Array.isArray(placement.cells) ? placement.cells.length : 0),
        0,
      );
      const isComplete = openCellCount > 0 && filledCellCount >= openCellCount;
      invention.completionStatus = isComplete ? "complete" : "incomplete";
      const completionBonusByInventionAndDay = ruleset.completionBonusByInventionAndDay || COMPLETION_BONUS_BY_INVENTION_AND_DAY;
      const completion = isComplete
        ? Number(completionBonusByInventionAndDay[invention.id]?.[currentDay] || 0)
        : 0;

      let unique = 0;
      if (invention.criterionKey === "intricacy") {
        unique = usedMechanisms.length * uniqueMultiplier;
      } else if (invention.criterionKey === "synchrony") {
        const frequencyByShape = new Map();
        usedMechanisms.forEach((mechanism) => {
          const signature = this.getMechanismShapeSignature(mechanism.path, true);
          frequencyByShape.set(signature, Number(frequencyByShape.get(signature) || 0) + 1);
        });
        const mostRepeated = Math.max(0, ...Array.from(frequencyByShape.values()));
        unique = mostRepeated * uniqueMultiplier;
      } else if (invention.criterionKey === "modularity") {
        const uniqueSizes = new Set(
          usedMechanisms.map((mechanism) =>
            Array.isArray(mechanism.path) ? mechanism.path.length : 0,
          ),
        );
        unique = uniqueSizes.size * uniqueMultiplier;
      }

      invention.scoring = {
        variety,
        completion,
        unique,
        total: variety + completion + unique,
      };
      invention.score = invention.scoring.total;
    }

    getMechanismShapeSignature(path, includeRotationsAndMirrors) {
      const normalized = this.getMechanismNormalizedShape(path);
      if (normalized.length === 0) {
        return "";
      }
      const toSignature = (points) =>
        points
          .slice()
          .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
          .map((point) => String(point.row) + ":" + String(point.col))
          .join("|");
      const normalizePoints = (points) => {
        const minRow = Math.min(...points.map((point) => point.row));
        const minCol = Math.min(...points.map((point) => point.col));
        return points.map((point) => ({ row: point.row - minRow, col: point.col - minCol }));
      };
      if (!includeRotationsAndMirrors) {
        return toSignature(normalized);
      }
      const variants = [];
      const base = normalized.map((point) => ({ row: point.row, col: point.col }));
      const transforms = [
        (p) => ({ row: p.row, col: p.col }),
        (p) => ({ row: p.col, col: -p.row }),
        (p) => ({ row: -p.row, col: -p.col }),
        (p) => ({ row: -p.col, col: p.row }),
        (p) => ({ row: p.row, col: -p.col }),
        (p) => ({ row: -p.row, col: p.col }),
        (p) => ({ row: p.col, col: p.row }),
        (p) => ({ row: -p.col, col: -p.row }),
      ];
      transforms.forEach((transform) => {
        const points = normalizePoints(base.map((point) => transform(point)));
        variants.push(toSignature(points));
      });
      return variants.sort()[0];
    }

    getMechanismShapeVariants(path, includeRotationsAndMirrors) {
      const normalized = this.getMechanismNormalizedShape(path);
      if (normalized.length === 0) {
        return [];
      }
      const toSignature = (points) =>
        points
          .slice()
          .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
          .map((point) => String(point.row) + ":" + String(point.col))
          .join("|");
      const normalizePoints = (points) => {
        const minRow = Math.min(...points.map((point) => point.row));
        const minCol = Math.min(...points.map((point) => point.col));
        return points.map((point) => ({ row: point.row - minRow, col: point.col - minCol }));
      };
      if (!includeRotationsAndMirrors) {
        return [normalized];
      }
      const base = normalized.map((point) => ({ row: point.row, col: point.col }));
      const transforms = [
        (p) => ({ row: p.row, col: p.col }),
        (p) => ({ row: p.col, col: -p.row }),
        (p) => ({ row: -p.row, col: -p.col }),
        (p) => ({ row: -p.col, col: p.row }),
        (p) => ({ row: p.row, col: -p.col }),
        (p) => ({ row: -p.row, col: p.col }),
        (p) => ({ row: p.col, col: p.row }),
        (p) => ({ row: -p.col, col: -p.row }),
      ];
      const variants = [];
      const seen = new Set();
      transforms.forEach((transform) => {
        const points = normalizePoints(base.map((point) => transform(point)));
        const signature = toSignature(points);
        if (seen.has(signature)) {
          return;
        }
        seen.add(signature);
        variants.push(points);
      });
      return variants;
    }

    patternToPoints(patternRows) {
      const rows = Array.isArray(patternRows) ? patternRows.map((row) => String(row)) : [];
      const points = [];
      rows.forEach((rowText, rowIndex) => {
        rowText.split("").forEach((cell, colIndex) => {
          if (cell === "1") {
            points.push({ row: rowIndex, col: colIndex });
          }
        });
      });
      return points;
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
        !this.hasTool(playerId, "T4") &&
        playerSelection.selectedJournalId &&
        playerSelection.selectedJournalId !== requestedJournalId
      ) {
        return { ok: false, reason: "journal_locked", state };
      }

      if (!playerSelection.selectedJournalId || this.hasTool(playerId, "T4")) {
        playerSelection.selectedJournalId = requestedJournalId;
        playerSelection.journalLocked = !this.hasTool(playerId, "T4");
      }

      const journal = player.journals.find((item) => item.id === requestedJournalId);
      if (!journal) {
        return { ok: false, reason: "invalid_journal", state };
      }

      const activePick = playerSelection.activePick || {
        usedValue: Number(playerSelection.activeNumber),
        consumeValue: Number(playerSelection.activeNumber),
        adjusted: false,
      };
      const value = Number(activePick.usedValue);
      const consumeValue = Number(activePick.consumeValue);
      const remainingNumbers = Array.isArray(playerSelection.remainingNumbers)
        ? playerSelection.remainingNumbers
        : [];

      if (!Number.isInteger(value) || value < 1 || value > 6) {
        return { ok: false, reason: "missing_number", state };
      }

      if (!remainingNumbers.includes(consumeValue)) {
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
      const turnToolUsage = { ...(state.turnToolUsage || {}) };
      const usage = this.getOrCreateTurnToolUsage(state, playerId);
      if (activePick.adjusted) {
        usage.ballBearingUsed = true;
      }
      turnToolUsage[playerId] = usage;
      this.updateWrenchesForJournal(journal);
      playerSelection.remainingNumbers = this.removeSingleValue(playerSelection.remainingNumbers, consumeValue);
      playerSelection.activeNumber = playerSelection.remainingNumbers[0] || null;
      playerSelection.activePick = {
        usedValue: playerSelection.activeNumber,
        consumeValue: playerSelection.activeNumber,
        adjusted: false,
      };
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
        turnToolUsage,
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
      const config = this.getGameConfig(state);
      const safeCompleted = Math.max(0, Math.min(config.journalCount, Number(completedJournals) || 0));
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
      const config = this.getGameConfig();
      return {
        id: playerId,
        completedJournals: 0,
        spentWrenches: 0,
        totalScore: 0,
        toolScore: 0,
        unlockedTools: [],
        mechanisms: [],
        inventions: this.getDefaultInventionCatalog().map((item) => this.createDefaultInvention(item.id, config)),
        lastBuildAtTurn: null,
        lastBuildAtDay: null,
        journals: Array.from({ length: config.journalCount }, (_item, index) =>
          this.createDefaultJournal(index + 1),
        ),
        workshops: Array.from({ length: config.workshopCount }, (_item, index) =>
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

    createDefaultInvention(inventionRef, gameConfigInput) {
      const template = this.resolveInventionTemplate(inventionRef);
      const workshopIds = this.getWorkshopIds({ gameConfig: gameConfigInput || this.getGameConfig() });
      const workshopTypeMarks = workshopIds.reduce((accumulator, workshopId) => {
        accumulator[workshopId] = false;
        return accumulator;
      }, {});
      return {
        id: template.id,
        name: template.name,
        criterionKey: template.criterionKey,
        criterionLabel: template.criterionLabel,
        pattern: template.pattern.map((row) => String(row)),
        usedMechanismIds: [],
        placements: [],
        workshopTypeMarks,
        scoring: {
          variety: 0,
          completion: 0,
          unique: 0,
          total: 0,
        },
        ideasCaptured: 0,
        uniqueIdeasMarked: 1,
        multiplier: 1,
        score: 0,
        presentedDay: null,
        completionStatus: "incomplete",
      };
    }

    resolveInventionTemplate(inventionRef) {
      const catalog = this.getDefaultInventionCatalog();
      if (typeof inventionRef === "string") {
        const byId = catalog.find((item) => item.id === inventionRef);
        if (byId) {
          return byId;
        }
      }
      if (Number.isInteger(inventionRef)) {
        const index = Math.max(0, Number(inventionRef) - 1);
        const byIndex = catalog[index];
        if (byIndex) {
          return byIndex;
        }
      }
      return catalog[0];
    }

    ensurePlayerInventions() {
      const state = this.gameStateService.getState();
      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length === 0) {
        return state;
      }
      const catalog = this.getDefaultInventionCatalog();
      const workshopIds = this.getWorkshopIds(state);
      let changed = false;
      const normalizedPlayers = players.map((player) => {
        const existing = Array.isArray(player.inventions) ? player.inventions : [];
        const byId = new Map(existing.map((item) => [item.id, item]));
        const normalizedInventions = catalog.map((template, index) => {
          const prior = byId.get(template.id) || existing[index] || {};
          const workshopMarks = prior.workshopTypeMarks || {};
          const normalizedWorkshopMarks = workshopIds.reduce((accumulator, workshopId) => {
            accumulator[workshopId] = Boolean(workshopMarks[workshopId]);
            return accumulator;
          }, {});
          const priorScoring = prior.scoring || {};
          return {
            id: template.id,
            name: template.name,
            criterionKey: template.criterionKey,
            criterionLabel: template.criterionLabel,
            pattern: template.pattern.map((row) => String(row)),
            usedMechanismIds: Array.isArray(prior.usedMechanismIds) ? [...prior.usedMechanismIds] : [],
            placements: Array.isArray(prior.placements)
              ? prior.placements.map((placement) => ({
                  mechanismId: placement?.mechanismId || "",
                  workshopId: placement?.workshopId || "",
                  cells: Array.isArray(placement?.cells)
                    ? placement.cells.map((cell) => ({
                        row: Number(cell?.row),
                        col: Number(cell?.col),
                      }))
                    : [],
                }))
              : [],
            workshopTypeMarks: normalizedWorkshopMarks,
            scoring: {
              variety: Number(priorScoring.variety || 0),
              completion: Number(priorScoring.completion || 0),
              unique: Number(priorScoring.unique || 0),
              total: Number(priorScoring.total || 0),
            },
            ideasCaptured: Number(prior.ideasCaptured || 0),
            uniqueIdeasMarked: Math.min(
              6,
              Math.max(1, Number(prior.uniqueIdeasMarked || prior.multiplier || 1)),
            ),
            multiplier: Math.min(
              6,
              Math.max(1, Number(prior.multiplier || prior.uniqueIdeasMarked || 1)),
            ),
            score: Number(prior.score || 0),
            presentedDay: typeof prior.presentedDay === "string" ? prior.presentedDay : null,
            completionStatus: prior.completionStatus === "complete" ? "complete" : "incomplete",
          };
        });
        const priorKeys = existing.map((item) => item && item.id).join("|");
        const nextKeys = normalizedInventions.map((item) => item.id).join("|");
        if (existing.length !== normalizedInventions.length || priorKeys !== nextKeys) {
          changed = true;
        }
        if (!Array.isArray(player.inventions)) {
          changed = true;
        }
        if (!Number.isFinite(Number(player.totalScore))) {
          changed = true;
        }
        if (!Number.isFinite(Number(player.toolScore))) {
          changed = true;
        }
        if (!Array.isArray(player.unlockedTools)) {
          changed = true;
        }
        if (!changed) {
          const schemaMismatch = normalizedInventions.some((item, index) => {
            const previous = existing[index] || {};
            if (previous.name !== item.name) {
              return true;
            }
            if (previous.criterionLabel !== item.criterionLabel) {
              return true;
            }
            if (!Array.isArray(previous.pattern) || previous.pattern.length === 0) {
              return true;
            }
            if (previous.pattern.map((row) => String(row)).join("|") !== item.pattern.join("|")) {
              return true;
            }
            if (!previous.scoring || typeof previous.scoring !== "object") {
              return true;
            }
            if (!Array.isArray(previous.placements)) {
              return true;
            }
            if (!Number.isInteger(previous.uniqueIdeasMarked) || previous.uniqueIdeasMarked < 1) {
              return true;
            }
            if (typeof previous.presentedDay !== "string" && previous.presentedDay !== null) {
              return true;
            }
            return false;
          });
          if (schemaMismatch) {
            changed = true;
          }
        }
        return {
          ...player,
          totalScore: Number(player.totalScore || 0),
          toolScore: Number(player.toolScore || 0),
          unlockedTools: Array.isArray(player.unlockedTools)
            ? player.unlockedTools
                .map((tool) => ({
                  id: String(tool?.id || ""),
                  name: String(tool?.name || ""),
                  unlockTier: tool?.unlockTier === "first" ? "first" : "later",
                  pointsAwarded: Number(tool?.pointsAwarded || 0),
                  firstUnlockPoints: Number(tool?.firstUnlockPoints || 0),
                  laterUnlockPoints: Number(tool?.laterUnlockPoints || 0),
                  unlockedAtTurn: Number(tool?.unlockedAtTurn || 0),
                  unlockedAtDay: String(tool?.unlockedAtDay || ""),
                  mechanismId: String(tool?.mechanismId || ""),
                }))
                .filter((tool) => tool.id)
            : [],
          inventions: normalizedInventions,
        };
      });
      if (!changed) {
        return state;
      }
      const normalizedRegistry = this.normalizeToolUnlockRegistry(state.toolUnlockRegistry || {});
      return this.gameStateService.update({
        players: normalizedPlayers,
        toolUnlockRegistry: normalizedRegistry,
      });
    }

    normalizeToolUnlockRegistry(registry) {
      const safeRegistry = registry && typeof registry === "object" ? registry : {};
      const normalized = {};
      Object.entries(safeRegistry).forEach(([toolId, entry]) => {
        if (!toolId || !entry || typeof entry !== "object") {
          return;
        }
        normalized[String(toolId)] = {
          firstUnlockedTurn: Number(entry.firstUnlockedTurn || 0),
          firstUnlockedDay: String(entry.firstUnlockedDay || ""),
          playerIds: Array.isArray(entry.playerIds)
            ? entry.playerIds.map((id) => String(id || "")).filter(Boolean)
            : [],
        };
      });
      return normalized;
    }

    createDefaultWorkshop(workshopNumber) {
      const state = this.gameStateService.getState();
      const layouts = this.getWorkshopLayoutsForSeed(state.rngSeed, state);
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
      const anchors = this.getRuleset().workshopIdeaAnchors?.[workshopId] || [];
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
      const anchors = this.getRuleset().workshopIdeaAnchors?.[workshopId] || [];
      return anchors.map((anchor) => ({
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

    getOrderedPlayerIds(stateInput) {
      const state = stateInput || this.gameStateService.getState();
      return (Array.isArray(state.players) ? state.players : [])
        .map((player) => String(player?.id || "").trim())
        .filter(Boolean);
    }

    getActivePlayerId(stateInput) {
      const state = stateInput || this.gameStateService.getState();
      const ids = this.getOrderedPlayerIds(state);
      if (ids.length === 0) {
        return "P1";
      }
      const configured = String(state.activePlayerId || "").trim();
      if (configured && ids.includes(configured)) {
        return configured;
      }
      return ids[0];
    }

    getNextPlayerId(stateInput, playerId) {
      const state = stateInput || this.gameStateService.getState();
      const ids = this.getOrderedPlayerIds(state);
      if (ids.length === 0) {
        return String(playerId || "P1");
      }
      const current = String(playerId || this.getActivePlayerId(state));
      const currentIndex = ids.indexOf(current);
      if (currentIndex < 0) {
        return ids[0];
      }
      return ids[(currentIndex + 1) % ids.length];
    }

    isLastPlayerInRound(stateInput, playerId) {
      const state = stateInput || this.gameStateService.getState();
      const ids = this.getOrderedPlayerIds(state);
      if (ids.length <= 1) {
        return true;
      }
      const current = String(playerId || this.getActivePlayerId(state));
      return ids.indexOf(current) === ids.length - 1;
    }

    clearPlayerTurnArtifacts(stateInput, playerId) {
      const state = stateInput || this.gameStateService.getState();
      const key = String(playerId || this.getActivePlayerId(state));
      const nextJournalSelections = { ...(state.journalSelections || {}) };
      const nextWorkshopSelections = { ...(state.workshopSelections || {}) };
      const nextWorkshopContext = { ...(state.workshopPhaseContext || {}) };
      const nextBuildDrafts = { ...(state.buildDrafts || {}) };
      const nextBuildDecisions = { ...(state.buildDecisions || {}) };
      const nextTurnToolUsage = { ...(state.turnToolUsage || {}) };
      const nextInventTransforms = { ...(state.inventTransforms || {}) };
      delete nextJournalSelections[key];
      delete nextWorkshopSelections[key];
      delete nextWorkshopContext[key];
      delete nextBuildDrafts[key];
      delete nextBuildDecisions[key];
      delete nextTurnToolUsage[key];
      delete nextInventTransforms[key];
      return {
        journalSelections: nextJournalSelections,
        workshopSelections: nextWorkshopSelections,
        workshopPhaseContext: nextWorkshopContext,
        buildDrafts: nextBuildDrafts,
        buildDecisions: nextBuildDecisions,
        turnToolUsage: nextTurnToolUsage,
        inventTransforms: nextInventTransforms,
      };
    }

    advancePhase() {
      const state = this.gameStateService.getState();
      const activePlayerId = this.getActivePlayerId(state);

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
        if (state.phase === "roll_and_group") {
          this.rollForJournalPhase(state);
          const updated = this.gameStateService.update({ phase: "journal" });
          this.loggerService.logEvent("info", "Phase advanced", {
            day: updated.currentDay,
            turnNumber: updated.turnNumber,
            from: state.phase,
            to: "journal",
          });
          return updated;
        }

        if (state.phase === "journal") {
          const preparedState = this.ensureJournalRoll(state);
          return this.completeJournalPhase(preparedState, activePlayerId);
        }

        if (state.phase === "workshop") {
          const canBuild = this.canBuildThisTurn(state, activePlayerId);
          if (!canBuild) {
            this.loggerService.logEvent("info", "Build phase skipped (not enough wrenches)", {
              playerId: activePlayerId,
              required: this.getBuildCost(activePlayerId),
              available: this.getAvailableWrenches(activePlayerId),
            });
            if (!this.hasBuiltThisTurn(state, activePlayerId)) {
              this.loggerService.logEvent("info", "Invent phase skipped (no mechanism built this turn)", {
                playerId: activePlayerId,
              });
              return this.completeTurn(state, activePlayerId);
            }
            const inventState = this.gameStateService.update({ phase: "invent" });
            return inventState;
          }
        }

        if (state.phase === "build") {
          if (!this.hasBuiltThisTurn(state, activePlayerId)) {
            this.loggerService.logEvent("info", "Invent phase skipped (no mechanism built this turn)", {
              playerId: activePlayerId,
            });
            return this.completeTurn(state, activePlayerId);
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

      if (state.phase === "invent" && !this.hasBuiltThisTurn(state, activePlayerId)) {
        this.loggerService.logEvent("info", "Invent phase skipped (no mechanism built this turn)", {
          playerId: activePlayerId,
        });
      }

      return this.completeTurn(state, activePlayerId);
    }

    completeJournalPhase(stateAtJournalPhase, playerIdInput) {
      const playerId = String(playerIdInput || this.getActivePlayerId(stateAtJournalPhase));
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
      const pendingIdeas = this.getPendingJournalIdeaJournals(playerId);
      if (pendingIdeas.length > 0) {
        this.loggerService.logEvent("warn", "Assign completed journal idea before ending Journal phase", {
          playerId,
          pendingJournalIds: pendingIdeas.map((item) => item.id),
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

    completeTurn(stateAtEndPhase, activePlayerIdInput) {
      const activePlayerId = String(activePlayerIdInput || this.getActivePlayerId(stateAtEndPhase));
      if (!this.isLastPlayerInRound(stateAtEndPhase, activePlayerId)) {
        const nextPlayerId = this.getNextPlayerId(stateAtEndPhase, activePlayerId);
        const cleared = this.clearPlayerTurnArtifacts(stateAtEndPhase, activePlayerId);
        const rotated = this.gameStateService.update({
          ...cleared,
          activePlayerId: nextPlayerId,
          phase: PHASES[0],
        });
        this.loggerService.logEvent("info", "Player turn completed", {
          day: rotated.currentDay,
          turnNumber: rotated.turnNumber,
          playerId: activePlayerId,
          nextPlayerId,
        });
        return rotated;
      }

      const resetForRound = this.clearPlayerTurnArtifacts(stateAtEndPhase, activePlayerId);
      const normalizedState = {
        ...stateAtEndPhase,
        ...resetForRound,
      };
      const dayResolution = this.resolveDayTransition(stateAtEndPhase);
      const stateWithScoring = dayResolution.endedDay
        ? this.applyEndOfDayScoring(normalizedState, dayResolution.endedDay)
        : normalizedState;
      const firstPlayerId = this.getOrderedPlayerIds(stateWithScoring)[0] || activePlayerId;

      if (dayResolution.gameCompleted) {
        const completed = this.gameStateService.update({
          gameStatus: "completed",
          phase: PHASES[PHASES.length - 1],
          currentDay: dayResolution.finalDay,
          players: stateWithScoring.players,
          activePlayerId: firstPlayerId,
          inventTransforms: {},
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
          players: stateWithScoring.players,
          activePlayerId: firstPlayerId,
          journalSelections: {},
          workshopSelections: {},
          workshopPhaseContext: {},
          buildDrafts: {},
          buildDecisions: {},
          turnToolUsage: {},
          inventTransforms: {},
        });
        const prepared = progressed;

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
        activePlayerId: firstPlayerId,
        journalSelections: {},
        workshopSelections: {},
        workshopPhaseContext: {},
        buildDrafts: {},
        buildDecisions: {},
        turnToolUsage: {},
        inventTransforms: {},
      });
      const prepared = nextTurn;

      this.loggerService.logEvent("info", "Turn completed", {
        day: prepared.currentDay,
        turnNumber: stateAtEndPhase.turnNumber,
      });
      return prepared;
    }

    applyEndOfDayScoring(state, dayLabel) {
      const players = Array.isArray(state.players) ? state.players : [];
      const scoredPlayers = players.map((player) => {
        const inventions = Array.isArray(player.inventions) ? [...player.inventions] : [];
        let gained = 0;
        inventions.forEach((invention) => {
          if (invention.presentedDay) {
            return;
          }
          const hasAnyPlacement = Array.isArray(invention.placements) && invention.placements.length > 0;
          const canPresentToday = invention.completionStatus === "complete" || dayLabel === "Sunday";
          if (!hasAnyPlacement || !canPresentToday) {
            return;
          }
          gained += Number(invention.scoring?.total || 0);
          invention.presentedDay = dayLabel;
        });
        return {
          ...player,
          totalScore: Number(player.totalScore || 0) + gained,
          inventions,
        };
      });
      return {
        ...state,
        players: scoredPlayers,
      };
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
      if (this.isBuildCheatEnabled()) {
        return true;
      }
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

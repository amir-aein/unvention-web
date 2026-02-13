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
        players.push({
          id: playerId,
          completedJournals: safeCompleted,
        });
      }

      const updated = this.gameStateService.update({ players });
      this.loggerService.logEvent("debug", "Journal completion updated", {
        playerId,
        completedJournals: safeCompleted,
      });
      return updated;
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
  }

  root.RoundEngineService = RoundEngineService;
})(typeof window !== "undefined" ? window : globalThis);

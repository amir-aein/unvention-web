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
    constructor(gameStateService, loggerService) {
      this.gameStateService = gameStateService;
      this.loggerService = loggerService;
    }

    getState() {
      return this.gameStateService.getState();
    }

    getPhases() {
      return [...PHASES];
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

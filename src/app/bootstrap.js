(function bootstrap(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});
  const container = root.createContainer();
  const loggerService = container.loggerService;
  const gameStateService = container.gameStateService;
  const roundEngineService = container.roundEngineService;
  const loadedState = gameStateService.load();
  const undoStack = [];

  if (loadedState.logs.length > 0) {
    loggerService.replaceEntries(loadedState.logs);
  }

  roundEngineService.initializePlayers(["P1"]);

  loggerService.subscribe(function persistLogs() {
    gameStateService.update({
      logs: loggerService.toSerializableEntries(),
    });
  });

  root.createLogSidebar(loggerService);
  const activePlayerId = "P1";

  function createSnapshot() {
    return {
      state: gameStateService.getState(),
      logs: loggerService.toSerializableEntries(),
    };
  }

  function pushUndoSnapshot() {
    undoStack.push(createSnapshot());
    if (undoStack.length > 100) {
      undoStack.shift();
    }
  }

  function runWithUndo(action) {
    pushUndoSnapshot();
    action();
  }

  function canAdvancePhase(state) {
    if (state.gameStatus === "completed") {
      return false;
    }
    if (state.phase !== "journal") {
      return true;
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

  function getFooterHint(state) {
    if (state.gameStatus === "completed") {
      return "Game completed.";
    }

    if (state.phase === "roll_and_group_dice") {
      return "Roll and group dice.";
    }

    if (state.phase === "journal") {
      if (state.rollAndGroup?.outcomeType === "quantum_leap") {
        return "Quantum Leap: journaling skipped; continue.";
      }
      const selection = state.journalSelections?.[activePlayerId];
      if (!selection?.selectedGroupKey) {
        return "Choose journaling group.";
      }
      if (!selection?.selectedJournalId) {
        return "Choose one journal for this turn.";
      }
      if (Number(selection.placementsThisTurn || 0) < 1) {
        return "Place at least one number in the selected journal.";
      }
      return "You can place more numbers or continue.";
    }

    if (state.phase === "workshop") {
      return "Workshop phase.";
    }

    if (state.phase === "build") {
      return "Build phase.";
    }

    return "Invent phase.";
  }

  function getNextPhaseLabel(state) {
    if (state.gameStatus === "completed") {
      return "Game Completed";
    }
    const phaseLabels = {
      roll_and_group_dice: "Roll & Go to Journaling",
      journal: "Go to Workshopping",
      workshop: "Go to Build",
      build: "Go to Invent",
      invent: "End Turn",
    };
    return phaseLabels[state.phase] || "Next Phase";
  }

  function renderPhaseBreadcrumb(currentPhase) {
    const breadcrumb = document.getElementById("footer-breadcrumb");
    if (!breadcrumb) {
      return;
    }
    const phases = roundEngineService.getPhases();
    const state = roundEngineService.getState();
    const currentDay = state.currentDay || "Friday";
    const text = [currentDay]
      .concat(
        phases.map((phase) => (phase === currentPhase ? "[" + phase.replaceAll("_", " ") + "]" : phase.replaceAll("_", " "))),
      )
      .join(" > ");
    breadcrumb.textContent = text;
  }

  function generateRandomSeed() {
    return "seed-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function renderState() {
    const state = roundEngineService.getState();
    const p1 = (state.players || []).find((player) => player.id === activePlayerId);
    const rollState = state.rollAndGroup || {};
    const rollDisplay = Array.isArray(rollState.dice) && rollState.dice.length > 0
      ? rollState.dice.join(", ")
      : "-";
    const groupDisplay = Array.isArray(rollState.groups) && rollState.groups.length > 0
      ? rollState.groups.map((group) => "[" + group.join(", ") + "]").join(" ")
      : "-";

    document.getElementById("state-seed").textContent = state.rngSeed || "default-seed";
    document.getElementById("footer-hint").textContent = getFooterHint(state);
    renderPhaseBreadcrumb(state.phase);
    const seedInput = document.getElementById("seed-input");
    if (seedInput && globalScope.document.activeElement !== seedInput) {
      seedInput.value = state.rngSeed || "default-seed";
    }
    const advanceButton = document.getElementById("advance-phase");
    advanceButton.textContent = getNextPhaseLabel(state);
    advanceButton.disabled = !canAdvancePhase(state);
    const undoButton = document.getElementById("undo-action");
    if (undoButton) {
      undoButton.disabled = undoStack.length === 0;
    }
    renderJournalControls(state, p1);
    renderJournals(state, p1);
  }

  function renderJournalControls(state, player) {
    const controls = document.getElementById("journal-controls");
    if (!controls) {
      return;
    }

    if (state.phase !== "journal") {
      controls.innerHTML = "";
      if (controls.style) {
        controls.style.display = "none";
      }
      return;
    }

    const selection = state.journalSelections?.[activePlayerId];
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

    const numberButtons = selection?.remainingNumbers?.length
      ? selection.remainingNumbers
          .map(
            (numberValue, index) =>
              '<button type="button" class="journal-chip journal-chip--number' +
              (numberValue === activeNumber && index === selection.remainingNumbers.indexOf(activeNumber)
                ? " journal-chip--active"
                : "") +
              '" data-action="select-number" data-number="' +
              String(numberValue) +
              '">' +
              String(numberValue) +
              "</button>",
          )
          .join("")
      : "<span class='journal-muted'>No numbers remaining.</span>";

    if (state.rollAndGroup?.outcomeType === "quantum_leap") {
      controls.innerHTML =
        '<div class="journal-control-row"><strong>Journaling:</strong> ' +
        "<span class='journal-muted'>Quantum Leap skips journaling.</span></div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    let controlsHtml = "";
    if (!selectedGroupKey) {
      controlsHtml =
        '<div class="journal-control-row"><strong>Journaling Group</strong> ' + groupButtons + "</div>";
    } else if (!selectedJournalId) {
      controlsHtml =
        '<div class="journal-control-row"><strong>Selected Group</strong> ' +
        '<span class="journal-chip journal-chip--active">' +
        (options.find((option) => option.key === selectedGroupKey)?.label || selectedGroupKey) +
        "</span></div>" +
        '<div class="journal-control-row"><strong>Number</strong> ' +
        numberButtons +
        "</div>" +
        "<div class='journal-control-row'><span class='journal-muted'>Click a cell in the journal you want to use.</span></div>";
    } else {
      controlsHtml =
        '<div class="journal-control-row"><strong>Selected</strong> ' +
        '<span class="journal-chip journal-chip--active">' +
        (options.find((option) => option.key === selectedGroupKey)?.label || selectedGroupKey) +
        "</span>" +
        '<span class="journal-chip journal-chip--active">' +
        selectedJournalId +
        "</span></div>" +
        '<div class="journal-control-row"><strong>Number</strong> ' +
        numberButtons +
        "</div>";
    }

    controls.innerHTML = controlsHtml;
    if (controls.style) {
      controls.style.display = "grid";
    }

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

      return (
        '<article class="journal-card' +
        (isJournalLockedOut ? " journal-card--disabled" : "") +
        '">' +
        "<h3>" +
        journal.id +
        "</h3>" +
        '<div class="journal-meta">Idea: ' +
        journal.ideaStatus +
        " | Completion: " +
        journal.completionStatus +
        "</div>" +
        '<div class="journal-layout">' +
        '<div class="journal-column-wrenches">' +
        columnWrenchesHtml +
        "</div>" +
        '<div class="journal-grid-row">' +
        '<div class="journal-grid" data-journal-id="' +
        journal.id +
        '">' +
        cellsHtml +
        "</div>" +
        '<div class="journal-row-wrenches">' +
        rowWrenchesHtml +
        "</div>" +
        "</div>" +
        "</div>" +
        "</article>"
      );
    });

    container.innerHTML = journalsHtml.join("");
  }

  document.getElementById("advance-phase").addEventListener("click", function onAdvancePhase() {
    runWithUndo(() => {
      roundEngineService.advancePhase();
    });
    renderState();
  });

  document.getElementById("set-seed").addEventListener("click", function onSetSeed() {
    runWithUndo(() => {
      const seedInput = document.getElementById("seed-input");
      const seedValue = seedInput.value;
      roundEngineService.setSeed(seedValue);
    });
    renderState();
  });

  document.getElementById("reset-game").addEventListener("click", function onResetGame() {
    runWithUndo(() => {
      gameStateService.reset();
      roundEngineService.initializePlayers(["P1"]);
      roundEngineService.setSeed(generateRandomSeed());
      loggerService.replaceEntries([]);
      loggerService.logEvent("warn", "Game reset to default state", { source: "ui" });
    });
    renderState();
  });

  document.getElementById("undo-action").addEventListener("click", function onUndoAction() {
    if (undoStack.length === 0) {
      return;
    }
    const snapshot = undoStack.pop();
    gameStateService.setState(snapshot.state);
    loggerService.replaceEntries(snapshot.logs);
    renderState();
  });

  document.getElementById("journal-controls").addEventListener("click", function onControlClick(event) {
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }

    const action = target.getAttribute("data-action");
    if (action === "select-group") {
      runWithUndo(() => {
        roundEngineService.selectJournalingGroup(activePlayerId, target.getAttribute("data-group-key"));
      });
      renderState();
      return;
    }

    if (action === "select-number") {
      runWithUndo(() => {
        roundEngineService.selectActiveJournalNumber(
          activePlayerId,
          Number(target.getAttribute("data-number")),
        );
      });
      renderState();
    }
  });

  document.getElementById("journals-container").addEventListener("click", function onJournalClick(event) {
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
    });
    renderState();
  });

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

  renderState();
})(typeof window !== "undefined" ? window : globalThis);

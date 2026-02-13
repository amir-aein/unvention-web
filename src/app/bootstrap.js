(function bootstrap(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});
  const container = root.createContainer();
  const loggerService = container.loggerService;
  const gameStateService = container.gameStateService;
  const roundEngineService = container.roundEngineService;
  const loadedState = gameStateService.load();
  const undoStack = Array.isArray(loadedState.undoHistory)
    ? loadedState.undoHistory.map((snapshot) => ({
        state: snapshot?.state || {},
        logs: Array.isArray(snapshot?.logs) ? snapshot.logs : [],
      }))
    : [];

  if (loadedState.logs.length > 0) {
    loggerService.replaceEntries(loadedState.logs);
  }

  loggerService.subscribe(function persistLogs() {
    gameStateService.update({
      logs: loggerService.toSerializableEntries(),
    });
  });

  root.createLogSidebar(loggerService);
  const activePlayerId = "P1";

  function isGameStarted(state) {
    return Boolean(state && state.gameStarted);
  }

  function setGameSurfaceVisibility(started) {
    const newGameScreen = document.getElementById("new-game-screen");
    const appShell = document.getElementById("app-shell");
    const footer = document.getElementById("action-footer");
    if (newGameScreen && newGameScreen.style) {
      newGameScreen.style.display = started ? "none" : "grid";
    }
    if (appShell && appShell.style) {
      appShell.style.display = started ? "grid" : "none";
    }
    if (footer && footer.style) {
      footer.style.display = started ? "grid" : "none";
    }
  }

  function createSnapshot() {
    const snapshotState = gameStateService.getState();
    delete snapshotState.undoHistory;
    return {
      state: snapshotState,
      logs: loggerService.toSerializableEntries(),
    };
  }

  function persistUndoHistory() {
    gameStateService.update({
      undoHistory: undoStack.map((snapshot) => ({
        state: snapshot.state,
        logs: snapshot.logs,
      })),
    });
  }

  function pushUndoSnapshot() {
    undoStack.push(createSnapshot());
    if (undoStack.length > 100) {
      undoStack.shift();
    }
    persistUndoHistory();
  }

  function runWithUndo(action) {
    pushUndoSnapshot();
    action();
  }

  function canAdvancePhase(state) {
    if (state.gameStatus === "completed") {
      return false;
    }
    if (state.phase === "build") {
      return true;
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
    const currentSeed = state.rngSeed || "default-seed";
    const crumbs = [currentSeed, currentDay]
      .concat(phases.map((phase) => phase.replaceAll("_", " ")))
      .map(function toCrumb(label, index) {
        const isActive = index > 1 && phases[index - 2] === currentPhase;
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
      roundEngineService.advancePhase();
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
      roundEngineService.advancePhase();
    }
  }

  function renderState() {
    const state = roundEngineService.getState();
    const started = isGameStarted(state);
    setGameSurfaceVisibility(started);
    if (!started) {
      return;
    }
    if (typeof roundEngineService.ensureJournalRoll === "function") {
      roundEngineService.ensureJournalRoll(state);
    }
    const refreshedState = roundEngineService.getState();
    maybeAutoSelectSingleWorkshopGroup();
    const withAutoWorkshopState = roundEngineService.getState();
    const p1 = (withAutoWorkshopState.players || []).find((player) => player.id === activePlayerId);
    const footerHint = document.getElementById("footer-hint");
    if (footerHint) {
      const hintText = getFooterHint(withAutoWorkshopState);
      footerHint.textContent = hintText;
      if (footerHint.style) {
        footerHint.style.display = hintText ? "inline" : "none";
      }
    }
    renderPhaseBreadcrumb(withAutoWorkshopState.phase);
    renderFooterWrenchCount(withAutoWorkshopState);
    const advanceButton = document.getElementById("advance-phase");
    advanceButton.textContent = getNextPhaseLabel(withAutoWorkshopState);
    advanceButton.disabled = !canAdvancePhase(withAutoWorkshopState);
    const undoButton = document.getElementById("undo-action");
    if (undoButton) {
      undoButton.disabled = undoStack.length === 0;
    }
    renderPhaseControls(withAutoWorkshopState);
    renderJournals(withAutoWorkshopState, p1);
    renderWorkshops(withAutoWorkshopState, p1);
  }

  function renderPhaseControls(state) {
    const controls = document.getElementById("journal-controls");
    if (!controls) {
      return;
    }

    if (state.phase !== "journal" && state.phase !== "workshop" && state.phase !== "build") {
      controls.innerHTML = "";
      if (controls.style) {
        controls.style.display = "none";
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
        "</div>" +
        "<div class='journal-control-row'><span class='journal-muted'>Click circled parts to draw an orthogonal mechanism path.</span></div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    if (state.phase === "workshop") {
      const selection = state.workshopSelections?.[activePlayerId];
      const options = roundEngineService.getWorkshoppingOptions(activePlayerId);
      const selectedGroupKey = selection?.selectedGroupKey || "";
      const selectedGroupLabel = options.find((option) => option.key === selectedGroupKey)?.label || selectedGroupKey;
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
      const numberButtons = selection?.remainingNumbers?.length
        ? selection.remainingNumbers
            .map(
              (numberValue, index) =>
                '<button type="button" class="journal-chip journal-chip--number' +
                (numberValue === selection?.activeNumber && index === selection.remainingNumbers.indexOf(selection?.activeNumber)
                  ? " journal-chip--active"
                  : "") +
                '" data-action="workshop-select-number" data-number="' +
                String(numberValue) +
                '">' +
                String(numberValue) +
                "</button>",
            )
            .join("")
        : "<span class='journal-muted'>No numbers remaining.</span>";

      let html = "";
      if (!selectedGroupKey) {
        html = '<div class="journal-control-row journal-control-row--prominent">' + groupButtons + "</div>";
      } else {
        html =
          '<div class="journal-control-row"><span class="journal-chip journal-chip--active">' +
          selectedGroupLabel +
          "</span></div>" +
          '<div class="journal-control-row">' +
          numberButtons +
          "</div>";
      }
      if (selectedGroupKey) {
        html += "<div class='journal-control-row'><span class='journal-muted'>Click a matching part to place it.</span></div>";
      }
      controls.innerHTML = html;
      if (controls.style) {
        controls.style.display = "grid";
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
      const quantumRoll = Array.isArray(state.rollAndGroup?.dice) && state.rollAndGroup.dice.length > 0
        ? state.rollAndGroup.dice.join(", ")
        : "";
      controls.innerHTML =
        (quantumRoll
          ? "<div class='journal-control-row'><span class='journal-roll-banner'>New turn roll: " + quantumRoll + "</span></div>"
          : "") +
        "<div class='journal-control-row'><span class='journal-muted'>Quantum Leap skips journaling.</span></div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    let controlsHtml = "";
    const showTurnRoll =
      !selectedGroupKey &&
      Number(selection?.placementsThisTurn || 0) === 0 &&
      Array.isArray(state.rollAndGroup?.dice) &&
      state.rollAndGroup.dice.length > 0;
    const turnRollHtml = showTurnRoll
      ? "<div class='journal-control-row'><span class='journal-roll-banner'>New turn roll: " +
        state.rollAndGroup.dice.join(", ") +
        "</span></div>"
      : "";
    if (!selectedGroupKey) {
      controlsHtml =
        turnRollHtml +
        '<div class="journal-control-row journal-control-row--prominent">' + groupButtons + "</div>";
    } else if (!selectedJournalId) {
      controlsHtml =
        turnRollHtml +
        '<div class="journal-control-row">' +
        '<span class="journal-chip journal-chip--active">' +
        (options.find((option) => option.key === selectedGroupKey)?.label || selectedGroupKey) +
        "</span></div>" +
        '<div class="journal-control-row">' +
        numberButtons +
        "</div>" +
        "<div class='journal-control-row'><span class='journal-muted'>Click a journal cell.</span></div>";
    } else {
      controlsHtml =
        turnRollHtml +
        '<div class="journal-control-row">' +
        '<span class="journal-chip journal-chip--active">' +
        (options.find((option) => option.key === selectedGroupKey)?.label || selectedGroupKey) +
        "</span>" +
        '<span class="journal-chip journal-chip--active">' +
        selectedJournalId +
        "</span></div>" +
        '<div class="journal-control-row">' +
        numberButtons +
        "</div>";
    }

    controls.innerHTML = controlsHtml;
    if (controls.style) {
      controls.style.display = "grid";
    }
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
    const cardsHtml = workshopOrder
      .map((workshopId) => {
        const workshop = byId.get(workshopId);
        if (!workshop) {
          return "";
        }
        const cells = Array.isArray(workshop.cells) ? workshop.cells : [];
        const selection = state.workshopSelections?.[activePlayerId];
        const selectedWorkshopId = selection?.selectedWorkshopId || "";
        const workshopLockedOut = Boolean(selectedWorkshopId) && selectedWorkshopId !== workshop.id;
        const activeNumber = Number(selection?.activeNumber);
        const buildDraft = state.buildDrafts?.[activePlayerId];
        const isBuildPhase = state.phase === "build";
        const draftWorkshopId = buildDraft?.workshopId || "";
        const buildLockedOut = Boolean(draftWorkshopId) && draftWorkshopId !== workshop.id;
        const draftPath = Array.isArray(buildDraft?.path) ? buildDraft.path : [];
        const builtThisTurn =
          Boolean(player) &&
          player.lastBuildAtTurn === state.turnNumber &&
          player.lastBuildAtDay === state.currentDay;
        const committedCells = new Set(
          (Array.isArray(player.mechanisms) ? player.mechanisms : [])
            .filter((item) => item.workshopId === workshop.id)
            .flatMap((item) => (Array.isArray(item.path) ? item.path : []))
            .map((item) => String(item.row) + ":" + String(item.col)),
        );
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
                const allowedWorkshopValues = Array.isArray(selection?.remainingNumbers)
                  ? selection.remainingNumbers.map((item) => Number(item))
                  : [];
                const canMatchActive =
                  state.phase === "workshop" &&
                  selection?.selectedGroupKey &&
                  !workshopLockedOut &&
                  !cell.circled &&
                  (
                    cell.kind === "wild" ||
                    (cell.kind === "number" && allowedWorkshopValues.includes(Number(cell.value)))
                  );
                const isDraftWorkshop = isBuildPhase && draftWorkshopId === workshop.id;
                const onDraftPath = isDraftWorkshop && Array.isArray(buildDraft?.path)
                  ? buildDraft.path.some((item) => item.row === rowIndex && item.col === columnIndex)
                  : false;
                const cellKey = String(rowIndex) + ":" + String(columnIndex);
                const inCommittedMechanism = committedCells.has(cellKey);
                const adjacentToDraft = isDraftWorkshop
                  ? draftPath.some(
                      (item) => Math.abs(item.row - rowIndex) + Math.abs(item.col - columnIndex) === 1,
                    )
                  : false;
                const canBuildSelect =
                  isBuildPhase &&
                  !builtThisTurn &&
                  cell.circled &&
                  !buildLockedOut &&
                  !inCommittedMechanism &&
                  (
                    (draftWorkshopId === "" && draftPath.length === 0) ||
                    (isDraftWorkshop && (onDraftPath || adjacentToDraft))
                  );
                const isDisabled = isBuildPhase ? !canBuildSelect : (!cell.circled && !canMatchActive);
                const shouldVisuallyDim = isBuildPhase
                  ? (!canBuildSelect && !cell.circled && !onDraftPath && !inCommittedMechanism)
                  : (!cell.circled && !canMatchActive);
                return (
                  '<button type="button" class="workshop-cell' +
                  valueClass +
                  (onDraftPath ? " workshop-cell--path" : "") +
                  (inCommittedMechanism ? " workshop-cell--mechanism" : "") +
                  (state.phase === "workshop" && canMatchActive ? " workshop-cell--clickable" : "") +
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

  document.getElementById("advance-phase").addEventListener("click", function onAdvancePhase() {
    runWithUndo(() => {
      roundEngineService.advancePhase();
    });
    renderState();
  });

  document.getElementById("start-new-game").addEventListener("click", function onStartNewGame() {
    const input = document.getElementById("new-game-seed");
    const desiredSeed = String(input?.value || "").trim() || generateRandomSeed();
    undoStack.length = 0;
    gameStateService.reset();
    persistUndoHistory();
    loggerService.replaceEntries([]);
    roundEngineService.initializePlayers(["P1"]);
    roundEngineService.setSeed(desiredSeed);
    gameStateService.update({ gameStarted: true });
    if (typeof roundEngineService.ensureJournalRoll === "function") {
      roundEngineService.ensureJournalRoll();
    }
    loggerService.logEvent("info", "New game started", { seed: desiredSeed, source: "ui" });
    renderState();
  });

  document.getElementById("reset-game").addEventListener("click", function onResetGame() {
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
        roundEngineService.selectActiveWorkshopNumber(activePlayerId, Number(target.getAttribute("data-number")));
      });
      renderState();
      return;
    }

    if (action === "finish-building") {
      runWithUndo(() => {
        roundEngineService.finishBuildingMechanism(activePlayerId);
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
      maybeAutoAdvanceAfterJournalProgress();
    });
    renderState();
  });

  document.getElementById("workshops-container").addEventListener("click", function onWorkshopClick(event) {
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
        roundEngineService.placeWorkshopPart(activePlayerId, workshopId, rowIndex, columnIndex);
        maybeAutoAdvanceAfterWorkshopProgress();
        return;
      }
      if (state.phase === "build") {
        roundEngineService.updateMechanismDraft(activePlayerId, workshopId, rowIndex, columnIndex);
      }
    });
    renderState();
  });

  const startupState = roundEngineService.getState();
  if (isGameStarted(startupState)) {
    roundEngineService.initializePlayers(["P1"]);
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

  renderState();
})(typeof window !== "undefined" ? window : globalThis);

(function attachHomeModeFlow(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  root.createHomeModeFlow = function createHomeModeFlow(deps) {
    const documentRef = deps.documentRef;
    const globalRef = deps.globalRef || globalScope;
    const multiplayerState = deps.multiplayerState;
    const multiplayerClient = deps.multiplayerClient;
    const ensureMultiplayerConnection = deps.ensureMultiplayerConnection;
    const clearMultiplayerSessionIdentity = deps.clearMultiplayerSessionIdentity;
    const resetMultiplayerForHomeAction =
      deps.resetMultiplayerForHomeAction ||
      function fallbackResetMultiplayerForHomeAction(options) {
        clearMultiplayerSessionIdentity(options);
      };
    const gameStateService = deps.gameStateService;
    const persistMultiplayerState = deps.persistMultiplayerState;
    const renderMultiplayerUi = deps.renderMultiplayerUi;
    const refreshRoomDirectory = deps.refreshRoomDirectory;
    const refreshPlayerHub = deps.refreshPlayerHub || refreshRoomDirectory;
    const resetLocalMultiplayerMemory =
      typeof deps.resetLocalMultiplayerMemory === "function"
        ? deps.resetLocalMultiplayerMemory
        : null;
    const setHomeStep = deps.setHomeStep;
    const getDefaultPlayerName = typeof deps.getDefaultPlayerName === "function"
      ? deps.getDefaultPlayerName
      : function fallbackGetDefaultPlayerName() {
        return "Player";
      };
    const persistHomeUiState = deps.persistHomeUiState;
    const getVariableSetupSelection = deps.getVariableSetupSelection || function fallbackGetVariableSetupSelection() {
      return { order: true, idea: true, parts: true };
    };
    const setVariableSetupSelection = deps.setVariableSetupSelection || function fallbackSetVariableSetupSelection() {};

    async function joinMultiplayerRoomByCode(requestedRoomCodeInput) {
      const requestedRoomCode = String(requestedRoomCodeInput || "").trim().toUpperCase();
      multiplayerState.name = getDefaultPlayerName();
      multiplayerState.lastError = "";
      if (!requestedRoomCode) {
        multiplayerState.lastError = "Enter a room code like ABC123";
        renderMultiplayerUi();
        return;
      }
      resetMultiplayerForHomeAction({ preserveHomeStep: true });
      gameStateService.update({ gameStarted: false });
      multiplayerState.roomCode = requestedRoomCode;
      persistMultiplayerState();
      setHomeStep("room-list");
      renderMultiplayerUi();
      await ensureMultiplayerConnection();
      const payload = {
        roomCode: multiplayerState.roomCode,
        name: multiplayerState.name || getDefaultPlayerName(),
        profileToken: multiplayerState.profileToken || "",
      };
      const sent = multiplayerClient.send("join_room", payload);
      if (!sent) {
        multiplayerState.lastError = "not_connected";
        setHomeStep("mode");
        renderMultiplayerUi();
      }
      refreshPlayerHub(true);
    }

    function bindHomeControls() {
      const homeCreateRoomButton = documentRef?.getElementById("home-create-room");
      if (homeCreateRoomButton) {
        homeCreateRoomButton.addEventListener("click", async function onCreateMultiplayerRoom() {
          persistHomeUiState();
          const seedInput = documentRef?.getElementById("mp-seed");
          multiplayerState.name = getDefaultPlayerName();
          const desiredSeed = String(seedInput?.value || "").trim();
          multiplayerState.lastError = "";
          resetMultiplayerForHomeAction({ preserveHomeStep: true });
          gameStateService.update({ gameStarted: false });
          persistMultiplayerState();
          setHomeStep("room-list");
          renderMultiplayerUi();
          await ensureMultiplayerConnection();
          const payload = {
            name: multiplayerState.name || getDefaultPlayerName(),
            profileToken: multiplayerState.profileToken || "",
          };
          if (desiredSeed) {
            payload.seed = desiredSeed;
          }
          const sent = multiplayerClient.send("create_room", payload);
          if (!sent) {
            multiplayerState.lastError = "not_connected";
            setHomeStep("mode");
          }
          renderMultiplayerUi();
          refreshPlayerHub(true);
        });
      }

      const homeSidebarHomeButton = documentRef?.getElementById("home-sidebar-home");
      if (homeSidebarHomeButton) {
        const goHome = function goHome(event) {
          if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
          }
          setHomeStep("mode");
        };
        homeSidebarHomeButton.addEventListener("click", goHome);
        homeSidebarHomeButton.addEventListener("keydown", function onSidebarHomeKeydown(event) {
          const key = String(event?.key || "").toLowerCase();
          if (key === "enter" || key === " ") {
            goHome(event);
          }
        });
      }

      const homeRefreshRoomsButton = documentRef?.getElementById("home-refresh-rooms");
      if (homeRefreshRoomsButton) {
        homeRefreshRoomsButton.addEventListener("click", function onRefreshRooms() {
          refreshPlayerHub(true);
        });
      }

      const homeResetLocalSessionButton = documentRef?.getElementById("home-reset-local-session");
      if (homeResetLocalSessionButton) {
        homeResetLocalSessionButton.addEventListener("click", async function onResetLocalSession() {
          const confirmed = typeof globalRef.confirm === "function"
            ? globalRef.confirm("Reset local multiplayer state and remove your active rooms from this server?")
            : true;
          if (!confirmed) {
            return;
          }
          if (resetLocalMultiplayerMemory) {
            await resetLocalMultiplayerMemory();
          }
        });
      }

      const mpRoomDirectory = documentRef?.getElementById("mp-room-directory");
      if (mpRoomDirectory) {
        mpRoomDirectory.addEventListener("click", function onRoomDirectoryClick(event) {
          const target = event.target;
          if (typeof globalRef.HTMLElement !== "undefined" && !(target instanceof globalRef.HTMLElement)) {
            return;
          }
          const button = target.closest("button[data-action='join-listed-room']");
          if (!button) {
            return;
          }
          const roomCode = String(button.getAttribute("data-room-code") || "").trim().toUpperCase();
          if (!roomCode) {
            return;
          }
          joinMultiplayerRoomByCode(roomCode);
        });
      }

      const variableSetupInputIds = [
        "var-setup-order-multiplayer",
        "var-setup-idea-multiplayer",
        "var-setup-parts-multiplayer",
      ];
      variableSetupInputIds.forEach((id) => {
        const input = documentRef?.getElementById(id);
        if (!input) {
          return;
        }
        input.addEventListener("change", function onVariableSetupChange() {
          const option = String(input.getAttribute("data-variable-setup-option") || "").trim();
          if (!option) {
            return;
          }
          const current = getVariableSetupSelection();
          setVariableSetupSelection({
            ...current,
            [option]: Boolean(input.checked),
          });
          persistHomeUiState();
          renderMultiplayerUi();
        });
      });
    }

    return {
      joinMultiplayerRoomByCode,
      bindHomeControls,
    };
  };
})(typeof window !== "undefined" ? window : globalThis);

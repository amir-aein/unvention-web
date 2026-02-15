(function attachHomeModeFlow(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  root.createHomeModeFlow = function createHomeModeFlow(deps) {
    const documentRef = deps.documentRef;
    const globalRef = deps.globalRef || globalScope;
    const multiplayerState = deps.multiplayerState;
    const multiplayerClient = deps.multiplayerClient;
    const ensureMultiplayerConnection = deps.ensureMultiplayerConnection;
    const clearMultiplayerSessionIdentity = deps.clearMultiplayerSessionIdentity;
    const gameStateService = deps.gameStateService;
    const persistMultiplayerState = deps.persistMultiplayerState;
    const renderMultiplayerUi = deps.renderMultiplayerUi;
    const refreshRoomDirectory = deps.refreshRoomDirectory;
    const setHomeStep = deps.setHomeStep;
    const startSoloGame = deps.startSoloGame;
    const getSelectedGameMode = deps.getSelectedGameMode;
    const setSelectedGameMode = deps.setSelectedGameMode;
    const persistHomeUiState = deps.persistHomeUiState;
    const getVariableSetupSelection = deps.getVariableSetupSelection || function fallbackGetVariableSetupSelection() {
      return { order: true, idea: true, parts: true };
    };
    const setVariableSetupSelection = deps.setVariableSetupSelection || function fallbackSetVariableSetupSelection() {};

    async function joinMultiplayerRoomByCode(requestedRoomCodeInput) {
      const nameInput = documentRef?.getElementById("mp-name");
      const requestedRoomCode = String(requestedRoomCodeInput || "").trim().toUpperCase();
      multiplayerState.name = String(nameInput?.value || "").trim();
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
      refreshRoomDirectory(true);
    }

    function bindHomeControls() {
      const modeContinueButton = documentRef?.getElementById("home-mode-continue");
      if (modeContinueButton) {
        modeContinueButton.addEventListener("click", function onModeContinue() {
          const selectedGameMode = getSelectedGameMode();
          if (selectedGameMode === "first") {
            return;
          }
          if (selectedGameMode === "solo") {
            startSoloGame();
            return;
          }
          setHomeStep("multiplayer");
        });
      }

      const modeToggle = documentRef?.getElementById("game-mode-toggle");
      if (modeToggle) {
        modeToggle.addEventListener("click", function onModeToggleClick(event) {
          const target = event.target;
          if (typeof globalRef.HTMLElement !== "undefined" && !(target instanceof globalRef.HTMLElement)) {
            return;
          }
          const button = target.closest("button[data-mode]");
          if (!button || button.hasAttribute("disabled")) {
            return;
          }
          setSelectedGameMode(String(button.getAttribute("data-mode") || "solo"));
          persistHomeUiState();
          renderMultiplayerUi();
        });
      }

      const homeCreateRoomButton = documentRef?.getElementById("home-create-room");
      if (homeCreateRoomButton) {
        homeCreateRoomButton.addEventListener("click", async function onCreateMultiplayerRoom() {
          const nameInput = documentRef?.getElementById("mp-name");
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
          }
          renderMultiplayerUi();
          refreshRoomDirectory(true);
        });
      }

      const homeJoinRoomStepButton = documentRef?.getElementById("home-join-room-step");
      if (homeJoinRoomStepButton) {
        homeJoinRoomStepButton.addEventListener("click", async function onJoinRoomStep() {
          const nameInput = documentRef?.getElementById("mp-name");
          multiplayerState.name = String(nameInput?.value || "").trim();
          persistMultiplayerState();
          await ensureMultiplayerConnection();
          setHomeStep("room-list");
          refreshRoomDirectory(true);
        });
      }

      const homeBackToModeButton = documentRef?.getElementById("home-back-to-mode");
      if (homeBackToModeButton) {
        homeBackToModeButton.addEventListener("click", function onBackToMode() {
          setHomeStep("mode");
        });
      }

      const homeBackToMultiplayerButton = documentRef?.getElementById("home-back-to-multiplayer");
      if (homeBackToMultiplayerButton) {
        homeBackToMultiplayerButton.addEventListener("click", function onBackToMultiplayer() {
          setHomeStep("multiplayer");
        });
      }

      const homeRefreshRoomsButton = documentRef?.getElementById("home-refresh-rooms");
      if (homeRefreshRoomsButton) {
        homeRefreshRoomsButton.addEventListener("click", function onRefreshRooms() {
          refreshRoomDirectory(true);
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
        "var-setup-order-mode",
        "var-setup-idea-mode",
        "var-setup-parts-mode",
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

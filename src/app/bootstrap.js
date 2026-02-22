(function bootstrap(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});
  if (typeof root.createHomeModeFlow !== "function" && typeof require === "function") {
    try {
      delete require.cache[require.resolve("./flows/homeModeFlow.js")];
      require("./flows/homeModeFlow.js");
    } catch (_error) {}
  }
  const container = root.createContainer();
  const MAX_PERSISTED_LOG_ENTRIES = 300;
  const MAX_UNDO_SNAPSHOTS = 20;
  const MAX_PERSISTED_UNDO_SNAPSHOTS = 6;
  const MAX_SNAPSHOT_LOG_ENTRIES = 80;
  const DISPLAY_NAME_MAX_LENGTH = 24;
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
  const HOME_UI_STORAGE_KEY = "unvention.homeUi.v1";
  const AUTH_UI_STORAGE_KEY = "unvention.auth.ui.v1";
  const ROOM_CITY_POOL = [
    { city: "London", flag: "🇬🇧" }, { city: "Paris", flag: "🇫🇷" }, { city: "Berlin", flag: "🇩🇪" }, { city: "Vienna", flag: "🇦🇹" },
    { city: "Zurich", flag: "🇨🇭" }, { city: "Geneva", flag: "🇨🇭" }, { city: "Basel", flag: "🇨🇭" }, { city: "Milan", flag: "🇮🇹" },
    { city: "Turin", flag: "🇮🇹" }, { city: "Bologna", flag: "🇮🇹" }, { city: "Florence", flag: "🇮🇹" }, { city: "Rome", flag: "🇮🇹" },
    { city: "Naples", flag: "🇮🇹" }, { city: "Barcelona", flag: "🇪🇸" }, { city: "Madrid", flag: "🇪🇸" }, { city: "Valencia", flag: "🇪🇸" },
    { city: "Lisbon", flag: "🇵🇹" }, { city: "Porto", flag: "🇵🇹" }, { city: "Amsterdam", flag: "🇳🇱" }, { city: "Rotterdam", flag: "🇳🇱" },
    { city: "The Hague", flag: "🇳🇱" }, { city: "Utrecht", flag: "🇳🇱" }, { city: "Brussels", flag: "🇧🇪" }, { city: "Antwerp", flag: "🇧🇪" },
    { city: "Leuven", flag: "🇧🇪" }, { city: "Ghent", flag: "🇧🇪" }, { city: "Copenhagen", flag: "🇩🇰" }, { city: "Stockholm", flag: "🇸🇪" },
    { city: "Gothenburg", flag: "🇸🇪" }, { city: "Oslo", flag: "🇳🇴" }, { city: "Helsinki", flag: "🇫🇮" }, { city: "Tallinn", flag: "🇪🇪" },
    { city: "Riga", flag: "🇱🇻" }, { city: "Vilnius", flag: "🇱🇹" }, { city: "Warsaw", flag: "🇵🇱" }, { city: "Krakow", flag: "🇵🇱" },
    { city: "Prague", flag: "🇨🇿" }, { city: "Brno", flag: "🇨🇿" }, { city: "Budapest", flag: "🇭🇺" }, { city: "Belgrade", flag: "🇷🇸" },
    { city: "Ljubljana", flag: "🇸🇮" }, { city: "Zagreb", flag: "🇭🇷" }, { city: "Athens", flag: "🇬🇷" }, { city: "Istanbul", flag: "🇹🇷" },
    { city: "Ankara", flag: "🇹🇷" }, { city: "Bursa", flag: "🇹🇷" }, { city: "Sofia", flag: "🇧🇬" }, { city: "Bucharest", flag: "🇷🇴" },
    { city: "Cluj", flag: "🇷🇴" }, { city: "Kyiv", flag: "🇺🇦" }, { city: "Lviv", flag: "🇺🇦" }, { city: "Dublin", flag: "🇮🇪" },
    { city: "Edinburgh", flag: "🇬🇧" }, { city: "Glasgow", flag: "🇬🇧" }, { city: "Manchester", flag: "🇬🇧" }, { city: "Birmingham", flag: "🇬🇧" },
    { city: "Liverpool", flag: "🇬🇧" }, { city: "Cambridge", flag: "🇬🇧" }, { city: "Oxford", flag: "🇬🇧" }, { city: "Bristol", flag: "🇬🇧" },
    { city: "Bordeaux", flag: "🇫🇷" }, { city: "Lyon", flag: "🇫🇷" }, { city: "Grenoble", flag: "🇫🇷" }, { city: "Toulouse", flag: "🇫🇷" },
    { city: "Marseille", flag: "🇫🇷" }, { city: "Munich", flag: "🇩🇪" }, { city: "Frankfurt", flag: "🇩🇪" }, { city: "Hamburg", flag: "🇩🇪" },
    { city: "Cologne", flag: "🇩🇪" }, { city: "Stuttgart", flag: "🇩🇪" }, { city: "Dresden", flag: "🇩🇪" }, { city: "Leipzig", flag: "🇩🇪" },
    { city: "Nuremberg", flag: "🇩🇪" }, { city: "Hanover", flag: "🇩🇪" }, { city: "Eindhoven", flag: "🇳🇱" }, { city: "Maastricht", flag: "🇳🇱" },
    { city: "Aarhus", flag: "🇩🇰" }, { city: "Reykjavik", flag: "🇮🇸" }, { city: "Boston", flag: "🇺🇸" }, { city: "New York", flag: "🇺🇸" },
    { city: "Philadelphia", flag: "🇺🇸" }, { city: "Chicago", flag: "🇺🇸" }, { city: "Pittsburgh", flag: "🇺🇸" }, { city: "Detroit", flag: "🇺🇸" },
    { city: "San Francisco", flag: "🇺🇸" }, { city: "San Jose", flag: "🇺🇸" }, { city: "Seattle", flag: "🇺🇸" }, { city: "Los Angeles", flag: "🇺🇸" },
    { city: "Montreal", flag: "🇨🇦" }, { city: "Toronto", flag: "🇨🇦" }, { city: "Ottawa", flag: "🇨🇦" }, { city: "Vancouver", flag: "🇨🇦" },
    { city: "Tokyo", flag: "🇯🇵" }, { city: "Osaka", flag: "🇯🇵" }, { city: "Kyoto", flag: "🇯🇵" }, { city: "Nagoya", flag: "🇯🇵" },
    { city: "Seoul", flag: "🇰🇷" },
  ];
  const VARIABLE_SETUP_STEP_IDS_BY_OPTION = {
    order: ["workshop_layout_order"],
    idea: ["random_invention_multiplier", "random_workshop_ideas"],
    parts: ["remove_parts_by_value"],
  };
  const VARIABLE_SETUP_OPTION_KEYS = Object.keys(VARIABLE_SETUP_STEP_IDS_BY_OPTION);
  const SECTION_VIEW_KEYS = ["journals", "workshops", "inventions", "tools"];
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
  let lastHudState = null;
  let multiplayerState = loadMultiplayerState();
  let waitingForRoomTurnAdvance = false;
  let appliedServerTurnKey = "";
  let localTurnActionCursor = 0;
  let localTurnActionBuffer = [];
  let localPublishedActionCursor = 0;
  let awaitingRoomStateRecovery = false;
  let lastSyncedStateSignature = "";
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let skipAutoReconnectOnNextClose = false;
  let inventionHover = null;
  let inventionVarietyHover = null;
  let lastAutoScrollTarget = "";
  let lastAutoScrollPhaseKey = "";
  let rollPhaseRevealTimeout = null;
  let rollPhaseAdvanceTimeout = null;
  let rollPhaseKey = "";
  let rollRevealVisibleKey = "";
  let pendingToolUnlocks = [];
  let workspaceScrollBound = false;
  let renderRecoveryInProgress = false;
  let roomDirectoryRows = [];
  let roomDirectoryLoading = false;
  let roomDirectoryLastFetchAt = 0;
  let roomDirectoryError = "";
  let hubProfileSummary = null;
  let hubProfileLoading = false;
  let hubProfileLastFetchAt = 0;
  let hubProfileError = "";
  let hubSelectedRoomCode = "";
  let gameSurfaceRoomCode = "";
  let hubAutoRefreshTimer = null;
  let selectedVariableSetup = getDefaultVariableSetupSelection();
  let sectionPlayerViews = SECTION_VIEW_KEYS.reduce((accumulator, key) => {
    accumulator[key] = "";
    return accumulator;
  }, {});
  let sectionViewTransitionPending = false;
  let homeStep = "mode";
  let forceHomeSurface = true;
  let supabaseAuth = createAuthController();
  let authProfileSyncTimer = null;
  loadHomeUiState();
  loadAuthUiState();
  homeStep = "mode";
  const originalLogEvent = loggerService.logEvent.bind(loggerService);
  loggerService.logEvent = function logEventWithTurnCapture(level, message, context) {
    const entry = originalLogEvent(level, message, context);
    const localPlayerId = String(multiplayerState.playerId || "").trim();
    const localPlayerName = String(
      (Array.isArray(multiplayerState.room?.players) ? multiplayerState.room.players : [])
        .find((item) => String(item?.playerId || "") === localPlayerId)?.name || "",
    ).trim();
    const hasOriginalContext = Boolean(context && typeof context === "object");
    const originalContext = hasOriginalContext ? context : {};
    const normalizedPlayerId = String(
      (entry?.context && entry.context.playerId) || originalContext.playerId || localPlayerId || "",
    );
    const normalizedContext = {
      ...(entry?.context && typeof entry.context === "object" ? entry.context : {}),
      playerId: normalizedPlayerId,
      playerName: String(
        (entry?.context && entry.context.playerName) ||
          originalContext.playerName ||
          localPlayerName ||
          resolvePlayerName(normalizedPlayerId) ||
          "",
      ),
    };
    const payload = {
      level: String(entry?.level || "info"),
      message: String(entry?.message || ""),
      timestamp: entry?.timestamp instanceof Date ? entry.timestamp.toISOString() : entry?.timestamp || new Date().toISOString(),
      context: normalizedContext,
      clientActionId: String(entry?.id || ""),
    };
    const source = String(normalizedContext.source || "").trim().toLowerCase();
    const hasExplicitPlayerContext = hasOriginalContext && String(originalContext.playerId || "").trim().length > 0;
    const shouldForwardToRoomSharedLog =
      source !== "network" &&
      source !== "ui" &&
      source !== "system" &&
      hasExplicitPlayerContext;
    if (
      isMultiplayerGameActive() &&
      localPlayerId &&
      !payload.context.shared &&
      String(payload.context.playerId || "") === localPlayerId &&
      shouldForwardToRoomSharedLog
    ) {
      localTurnActionBuffer.push(payload);
      if (multiplayerState.connected) {
        multiplayerClient.send("player_log_event", {
          entry: payload,
        });
      }
    }
    return entry;
  };

  function isGameStarted(state) {
    return Boolean(state && state.gameStarted);
  }

  function resolveHomeStep() {
    const normalized = String(homeStep || "mode");
    if (normalized === "waitroom") {
      return "room-list";
    }
    if (normalized === "multiplayer") {
      return "mode";
    }
    return normalized;
  }

  function setHomeStep(nextStep) {
    homeStep = String(nextStep || "mode");
    persistHomeUiState();
    renderMultiplayerUi();
  }

  function getDefaultVariableSetupSelection() {
    return {
      order: true,
      idea: true,
      parts: true,
    };
  }

  function normalizeVariableSetupSelection(input) {
    const defaults = getDefaultVariableSetupSelection();
    const candidate = input && typeof input === "object" ? input : {};
    return VARIABLE_SETUP_OPTION_KEYS.reduce((accumulator, key) => {
      accumulator[key] = Object.prototype.hasOwnProperty.call(candidate, key)
        ? Boolean(candidate[key])
        : defaults[key];
      return accumulator;
    }, {});
  }

  function getVariableSetupSelection() {
    return {
      ...selectedVariableSetup,
    };
  }

  function setVariableSetupSelection(nextSelection) {
    selectedVariableSetup = normalizeVariableSetupSelection(nextSelection);
  }

  function resolveHomeNewGameConfig() {
    const state = gameStateService.getState();
    const base = state.gameConfig && typeof state.gameConfig === "object"
      ? JSON.parse(JSON.stringify(state.gameConfig))
      : {};
    const enabledOptions = VARIABLE_SETUP_OPTION_KEYS.filter((key) => Boolean(selectedVariableSetup[key]));
    if (enabledOptions.length === 0) {
      return {
        ...base,
        modId: "classic",
        setupSteps: [],
      };
    }
    const disabledSteps = VARIABLE_SETUP_OPTION_KEYS
      .filter((key) => !selectedVariableSetup[key])
      .flatMap((key) => {
        const stepIds = Array.isArray(VARIABLE_SETUP_STEP_IDS_BY_OPTION[key])
          ? VARIABLE_SETUP_STEP_IDS_BY_OPTION[key]
          : [];
        return stepIds.map((stepId) => ({
          id: stepId,
          enabled: false,
        }));
      });
    return {
      ...base,
      modId: "variable_setup",
      setupSteps: disabledSteps,
    };
  }

  function loadHomeUiState() {
    const localStorageRef = typeof globalScope.localStorage !== "undefined" ? globalScope.localStorage : null;
    if (!localStorageRef) {
      return;
    }
    try {
      const raw = localStorageRef.getItem(HOME_UI_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      setVariableSetupSelection(parsed.variableSetup);
    } catch (_error) {}
  }

  function persistHomeUiState() {
    const localStorageRef = typeof globalScope.localStorage !== "undefined" ? globalScope.localStorage : null;
    if (!localStorageRef) {
      return;
    }
    try {
      localStorageRef.setItem(HOME_UI_STORAGE_KEY, JSON.stringify({
        variableSetup: selectedVariableSetup,
        homeStep,
      }));
    } catch (_error) {}
  }

  function createAuthController() {
    return {
      enabled: false,
      loading: true,
      initializing: false,
      statusMessage: "Checking authentication...",
      feedbackMessage: "",
      feedbackLevel: "info",
      email: "",
      session: null,
      user: null,
      profile: null,
      client: null,
      unsubscribe: null,
      profileSyncInFlight: false,
      displayNameModalOpen: false,
      displayNameModalSaving: false,
      displayNameModalMode: "create",
      displayNameModalFeedback: "",
      displayNameModalFeedbackLevel: "info",
      displayNameDraft: "",
    };
  }

  function loadAuthUiState() {
    const localStorageRef = typeof globalScope.localStorage !== "undefined" ? globalScope.localStorage : null;
    if (!localStorageRef) {
      return;
    }
    try {
      const raw = localStorageRef.getItem(AUTH_UI_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      supabaseAuth.email = String(parsed.email || "").trim();
    } catch (_error) {}
  }

  function persistAuthUiState() {
    const localStorageRef = typeof globalScope.localStorage !== "undefined" ? globalScope.localStorage : null;
    if (!localStorageRef) {
      return;
    }
    try {
      localStorageRef.setItem(
        AUTH_UI_STORAGE_KEY,
        JSON.stringify({
          email: String(supabaseAuth.email || "").trim(),
        }),
      );
    } catch (_error) {}
  }

  function isAuthenticated() {
    return Boolean(supabaseAuth.enabled && supabaseAuth.user);
  }

  function sanitizeDisplayName(nameInput) {
    return String(nameInput || "").trim().slice(0, DISPLAY_NAME_MAX_LENGTH);
  }

  function getAssignedDisplayName() {
    return sanitizeDisplayName(supabaseAuth.profile?.display_name || "");
  }

  function getAuthProfileLegacyToken() {
    return String(supabaseAuth.profile?.legacy_profile_token || "").trim();
  }

  function getLocalLegacyProfileToken() {
    return String(multiplayerState.profileToken || "").trim();
  }

  function getLegacyProfileTokenForAuthPatch() {
    const localToken = getLocalLegacyProfileToken();
    const profileToken = getAuthProfileLegacyToken();
    if (!localToken) {
      return "";
    }
    if (!profileToken || profileToken === localToken) {
      return localToken;
    }
    return "";
  }

  function isDisplayNameRequired() {
    return isAuthenticated() && Boolean(supabaseAuth.profile) && !getAssignedDisplayName();
  }

  function canAccessMultiplayerFeature() {
    if (!isAuthenticated()) {
      return false;
    }
    if (isDisplayNameRequired()) {
      openDisplayNameModal("create");
      return false;
    }
    return true;
  }

  function getMultiplayerAccessError() {
    if (!isAuthenticated()) {
      return "Sign in required";
    }
    if (isDisplayNameRequired()) {
      return "Set your display name to continue.";
    }
    return "";
  }

  function getPlayerSeatFallbackLabel(playerIdInput) {
    const playerId = String(playerIdInput || "").trim().toUpperCase();
    const match = /^P(\d+)$/.exec(playerId);
    if (match) {
      return "Player " + String(match[1]);
    }
    return playerId ? "Player " + playerId : "Player";
  }

  function openDisplayNameModal(modeInput) {
    if (!isAuthenticated()) {
      return;
    }
    const mode = String(modeInput || "create").toLowerCase() === "change" ? "change" : "create";
    const wasOpen = Boolean(supabaseAuth.displayNameModalOpen);
    const currentMode = String(supabaseAuth.displayNameModalMode || "create");
    if (wasOpen && currentMode === mode && mode === "create") {
      return;
    }
    supabaseAuth.displayNameModalOpen = true;
    supabaseAuth.displayNameModalMode = mode;
    supabaseAuth.displayNameModalFeedback = "";
    supabaseAuth.displayNameModalFeedbackLevel = "info";
    const fallbackName = mode === "create"
      ? ""
      : getAssignedDisplayName();
    if (!wasOpen || mode === "change") {
      supabaseAuth.displayNameDraft = sanitizeDisplayName(supabaseAuth.displayNameDraft || fallbackName);
    }
    renderMultiplayerUi();
    if (typeof globalScope.setTimeout === "function") {
      globalScope.setTimeout(() => {
        if (typeof document === "undefined") {
          return;
        }
        const input = document.getElementById("auth-display-name-input");
        if (input && typeof input.focus === "function") {
          input.focus();
          if (typeof input.select === "function") {
            input.select();
          }
        }
      }, 0);
    }
  }

  function closeDisplayNameModal() {
    supabaseAuth.displayNameModalOpen = false;
    supabaseAuth.displayNameModalSaving = false;
    supabaseAuth.displayNameModalFeedback = "";
    supabaseAuth.displayNameModalFeedbackLevel = "info";
  }

  function syncDisplayNameRequirement() {
    if (!isAuthenticated()) {
      closeDisplayNameModal();
      supabaseAuth.displayNameDraft = "";
      return;
    }
    if (!supabaseAuth.profile) {
      return;
    }
    if (isDisplayNameRequired()) {
      openDisplayNameModal("create");
      return;
    }
    if (supabaseAuth.displayNameModalOpen && supabaseAuth.displayNameModalMode === "create") {
      closeDisplayNameModal();
      renderMultiplayerUi();
    }
    if (!supabaseAuth.displayNameDraft) {
      supabaseAuth.displayNameDraft = getAssignedDisplayName();
    }
  }

  function requireAuthenticatedUser(messageInput) {
    if (isAuthenticated()) {
      if (isDisplayNameRequired()) {
        openDisplayNameModal("create");
        multiplayerState.lastError = "Set your display name to continue.";
        setAuthFeedback("Set your display name to continue.", "error");
        return false;
      }
      return true;
    }
    multiplayerState.lastError = String(messageInput || "Sign in required");
    setAuthFeedback(String(messageInput || "Sign in required"), "error");
    return false;
  }

  function getAuthDisplayNameFallback() {
    const profileName = getAssignedDisplayName();
    if (profileName) {
      return profileName;
    }
    return "";
  }

  function setAuthFeedback(messageInput, levelInput) {
    supabaseAuth.feedbackMessage = String(messageInput || "");
    supabaseAuth.feedbackLevel = String(levelInput || "info");
    renderMultiplayerUi();
  }

  function sanitizeAuthEmail(emailInput) {
    return String(emailInput || "").trim().toLowerCase();
  }

  async function initializeSupabaseAuth() {
    if (supabaseAuth.initializing || supabaseAuth.client) {
      return;
    }
    supabaseAuth.initializing = true;
    supabaseAuth.loading = true;
    supabaseAuth.statusMessage = "Loading auth...";
    renderMultiplayerUi();

    const createClient =
      globalScope?.supabase && typeof globalScope.supabase.createClient === "function"
        ? globalScope.supabase.createClient
        : null;
    if (!createClient) {
      supabaseAuth.enabled = false;
      supabaseAuth.loading = false;
      supabaseAuth.initializing = false;
      supabaseAuth.statusMessage = "Auth unavailable";
      renderMultiplayerUi();
      return;
    }

    const configResult = await fetchFirstJsonFromCandidates(
      buildApiCandidates(multiplayerState.url, "/api/auth/config"),
    );
    const config = configResult?.ok ? configResult.payload : null;
    const configEnabled = Boolean(config?.enabled && config?.url && config?.publishableKey);
    if (!configEnabled || !createClient) {
      supabaseAuth.enabled = false;
      supabaseAuth.loading = false;
      supabaseAuth.initializing = false;
      supabaseAuth.statusMessage = configEnabled
        ? "Supabase client unavailable"
        : "Auth unavailable";
      renderMultiplayerUi();
      return;
    }

    try {
      supabaseAuth.client = createClient(String(config.url), String(config.publishableKey), {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      supabaseAuth.enabled = true;
      const authSubscription = supabaseAuth.client.auth.onAuthStateChange((_event, session) => {
        applyAuthSession(session).catch(() => {});
      });
      const unsubscribe = authSubscription?.data?.subscription?.unsubscribe;
      supabaseAuth.unsubscribe = typeof unsubscribe === "function" ? unsubscribe : null;
      const sessionResult = await supabaseAuth.client.auth.getSession();
      await applyAuthSession(sessionResult?.data?.session || null);
    } catch (error) {
      supabaseAuth.enabled = false;
      supabaseAuth.statusMessage = "Auth initialization failed";
      setAuthFeedback("Could not initialize auth: " + String(error?.message || "unknown_error"), "error");
    } finally {
      supabaseAuth.loading = false;
      supabaseAuth.initializing = false;
      renderMultiplayerUi();
    }
  }

  async function applyAuthSession(sessionInput) {
    const session = sessionInput || null;
    supabaseAuth.session = session;
    supabaseAuth.user = session?.user || null;
    supabaseAuth.profile = null;
    if (session?.user) {
      supabaseAuth.statusMessage = "Logged in as " + String(session.user.email || "user");
      if (!supabaseAuth.email && session.user.email) {
        supabaseAuth.email = sanitizeAuthEmail(session.user.email);
      }
      supabaseAuth.feedbackMessage = "";
      persistAuthUiState();
      await refreshAuthProfile();
      queueAuthProfileSync("session");
      await refreshPlayerHub(true);
    } else {
      supabaseAuth.statusMessage = supabaseAuth.enabled ? "Not signed in" : "Auth unavailable";
      closeDisplayNameModal();
      supabaseAuth.displayNameDraft = "";
      roomDirectoryRows = [];
      stopHubAutoRefresh();
    }
    syncDisplayNameRequirement();
    renderMultiplayerUi();
    renderState();
  }

  async function refreshAuthProfile() {
    if (!supabaseAuth.client || !supabaseAuth.user?.id) {
      return;
    }
    const { data, error } = await supabaseAuth.client
      .from("app_users")
      .select("user_id,email,display_name,legacy_profile_token,last_seen_at")
      .eq("user_id", String(supabaseAuth.user.id))
      .maybeSingle();
    if (error) {
      setAuthFeedback("Could not load profile: " + String(error.message || "unknown_error"), "error");
      return;
    }
    supabaseAuth.profile = data || null;
    const profileName = getAssignedDisplayName();
    const profileLegacyToken = getAuthProfileLegacyToken();
    multiplayerState.name = profileName || "";
    multiplayerState.profileToken = profileLegacyToken || "";
    persistMultiplayerState();
    syncDisplayNameRequirement();
  }

  function queueAuthProfileSync(reasonInput) {
    if (!supabaseAuth.client || !supabaseAuth.user?.id) {
      return;
    }
    if (authProfileSyncTimer) {
      globalScope.clearTimeout(authProfileSyncTimer);
    }
    authProfileSyncTimer = globalScope.setTimeout(() => {
      authProfileSyncTimer = null;
      syncAuthProfile(reasonInput).catch(() => {});
    }, 120);
  }

  async function syncAuthProfile(reasonInput) {
    if (!supabaseAuth.client || !supabaseAuth.user?.id || supabaseAuth.profileSyncInFlight) {
      return;
    }
    supabaseAuth.profileSyncInFlight = true;
    try {
      const legacyProfileToken = getLegacyProfileTokenForAuthPatch();
      const patch = {
        last_seen_at: new Date().toISOString(),
      };
      if (legacyProfileToken) {
        patch.legacy_profile_token = legacyProfileToken;
      }
      let { error } = await supabaseAuth.client
        .from("app_users")
        .update(patch)
        .eq("user_id", String(supabaseAuth.user.id));
      if (
        error &&
        String(error.code || "") === "23505" &&
        /legacy_profile_token/i.test(String(error.message || ""))
      ) {
        delete patch.legacy_profile_token;
        multiplayerState.profileToken = "";
        persistMultiplayerState();
        const retry = await supabaseAuth.client
          .from("app_users")
          .update(patch)
          .eq("user_id", String(supabaseAuth.user.id));
        error = retry.error || null;
      }
      if (error) {
        setAuthFeedback(
          "Profile sync failed (" + String(reasonInput || "update") + "): " + String(error.message || "unknown_error"),
          "error",
        );
        return;
      }
      await refreshAuthProfile();
    } finally {
      supabaseAuth.profileSyncInFlight = false;
      renderMultiplayerUi();
    }
  }

  async function saveAuthDisplayName(nameInput) {
    if (!supabaseAuth.client || !supabaseAuth.user?.id) {
      return false;
    }
    const nextDisplayName = sanitizeDisplayName(nameInput);
    if (!nextDisplayName) {
      supabaseAuth.displayNameModalFeedback = "Please enter a display name.";
      supabaseAuth.displayNameModalFeedbackLevel = "error";
      renderMultiplayerUi();
      return false;
    }
    supabaseAuth.displayNameModalSaving = true;
    supabaseAuth.displayNameModalFeedback = "";
    renderMultiplayerUi();
    const legacyProfileToken = getLegacyProfileTokenForAuthPatch();
    const patch = {
      display_name: nextDisplayName,
      last_seen_at: new Date().toISOString(),
    };
    if (legacyProfileToken) {
      patch.legacy_profile_token = legacyProfileToken;
    }
    let { error } = await supabaseAuth.client
      .from("app_users")
      .update(patch)
      .eq("user_id", String(supabaseAuth.user.id));
    if (
      error &&
      String(error.code || "") === "23505" &&
      /legacy_profile_token/i.test(String(error.message || ""))
    ) {
      delete patch.legacy_profile_token;
      multiplayerState.profileToken = "";
      persistMultiplayerState();
      const retry = await supabaseAuth.client
        .from("app_users")
        .update(patch)
        .eq("user_id", String(supabaseAuth.user.id));
      error = retry.error || null;
    }
    if (error) {
      supabaseAuth.displayNameModalSaving = false;
      supabaseAuth.displayNameModalFeedback = "Could not save name: " + String(error.message || "unknown_error");
      supabaseAuth.displayNameModalFeedbackLevel = "error";
      renderMultiplayerUi();
      return false;
    }
    supabaseAuth.profile = {
      ...(supabaseAuth.profile && typeof supabaseAuth.profile === "object" ? supabaseAuth.profile : {}),
      user_id: String(supabaseAuth.user.id),
      email: String(supabaseAuth.user.email || supabaseAuth.profile?.email || ""),
      display_name: nextDisplayName,
      legacy_profile_token: legacyProfileToken || null,
      last_seen_at: patch.last_seen_at,
    };
    multiplayerState.name = nextDisplayName;
    persistMultiplayerState();
    closeDisplayNameModal();
    supabaseAuth.displayNameDraft = nextDisplayName;
    queueAuthProfileSync("display_name_saved");
    renderMultiplayerUi();
    renderState();
    if (hasActiveMultiplayerRoom()) {
      await sendMultiplayerCommand("rename_player", { name: nextDisplayName }, {
        errorMessage: "Could not update room display name.",
      });
    }
    return true;
  }

  async function submitDisplayNameModal() {
    const input = typeof document !== "undefined"
      ? document.getElementById("auth-display-name-input")
      : null;
    const candidate = sanitizeDisplayName(input ? input.value : supabaseAuth.displayNameDraft);
    supabaseAuth.displayNameDraft = candidate;
    await saveAuthDisplayName(candidate);
  }

  async function sendAuthMagicLink() {
    const email = sanitizeAuthEmail(supabaseAuth.email);
    if (!email || !supabaseAuth.client || !supabaseAuth.enabled) {
      return;
    }
    supabaseAuth.loading = true;
    renderMultiplayerUi();
    const emailRedirectTo =
      typeof globalScope.location !== "undefined"
        ? String(globalScope.location.origin || "").replace(/\/$/, "") + "/"
        : undefined;
    const { error } = await supabaseAuth.client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo,
      },
    });
    supabaseAuth.loading = false;
    if (error) {
      setAuthFeedback("Could not send link: " + String(error.message || "unknown_error"), "error");
      return;
    }
    persistAuthUiState();
    setAuthFeedback("Magic link sent to " + email + ". Check inbox/spam.", "info");
  }

  async function logoutAuth() {
    if (!supabaseAuth.client || !supabaseAuth.enabled) {
      return;
    }
    supabaseAuth.loading = true;
    renderMultiplayerUi();
    const { error } = await supabaseAuth.client.auth.signOut();
    supabaseAuth.loading = false;
    if (error) {
      setAuthFeedback("Could not log out: " + String(error.message || "unknown_error"), "error");
      return;
    }
    supabaseAuth.session = null;
    supabaseAuth.user = null;
    supabaseAuth.profile = null;
    supabaseAuth.statusMessage = "Signed out";
    closeDisplayNameModal();
    supabaseAuth.displayNameDraft = "";
    resetMultiplayerForHomeAction({ preserveHomeStep: true, preserveRoomSessions: false });
    multiplayerState.profileId = "";
    multiplayerState.profileToken = "";
    roomDirectoryRows = [];
    hubProfileSummary = null;
    hubProfileError = "";
    roomDirectoryError = "";
    homeStep = "mode";
    persistAuthUiState();
    setAuthFeedback("Signed out", "info");
    renderMultiplayerUi();
    renderState();
  }

  function renderAuthUi() {
    if (typeof document === "undefined") {
      return;
    }
    const loginStatusLine = document.getElementById("auth-login-status-line");
    const loginFeedbackLine = document.getElementById("auth-login-feedback-line");
    const emailInput = document.getElementById("auth-login-email-input");
    const sendButton = document.getElementById("auth-send-link");
    const homeDisplayNameRow = document.getElementById("auth-home-display-name-row");
    const homeDisplayNameLine = document.getElementById("auth-home-display-name-line");
    const changeDisplayNameButton = document.getElementById("auth-change-display-name");
    const homeStatusLine = document.getElementById("auth-home-status-line");
    const logoutButton = document.getElementById("auth-logout");
    const assignedDisplayName = getAssignedDisplayName();
    const statusText = String(
      supabaseAuth.loading
        ? "Checking authentication..."
        : supabaseAuth.statusMessage || (supabaseAuth.enabled ? "Not signed in" : "Auth unavailable"),
    );
    if (loginStatusLine) {
      loginStatusLine.textContent = statusText;
    }
    if (loginFeedbackLine) {
      loginFeedbackLine.textContent = String(supabaseAuth.feedbackMessage || "");
      loginFeedbackLine.style.color = supabaseAuth.feedbackLevel === "error" ? "#b91c1c" : "";
    }
    if (homeStatusLine) {
      homeStatusLine.textContent = isAuthenticated()
        ? "Logged in as " + String(supabaseAuth.user?.email || "user")
        : "Not signed in";
    }
    if (homeDisplayNameRow && homeDisplayNameRow.style) {
      homeDisplayNameRow.style.display = isAuthenticated() ? "flex" : "none";
    }
    if (homeDisplayNameLine) {
      homeDisplayNameLine.textContent = isAuthenticated()
        ? "Display name: " + (assignedDisplayName || "Not set")
        : "Display name: Not set";
    }
    if (changeDisplayNameButton) {
      changeDisplayNameButton.textContent = assignedDisplayName ? "Change" : "Set";
      changeDisplayNameButton.disabled = !isAuthenticated() || supabaseAuth.loading || supabaseAuth.displayNameModalSaving;
    }
    if (emailInput) {
      if (String(emailInput.value || "") !== String(supabaseAuth.email || "")) {
        emailInput.value = String(supabaseAuth.email || "");
      }
      emailInput.disabled = !supabaseAuth.enabled || supabaseAuth.loading || isAuthenticated();
    }
    if (sendButton) {
      sendButton.disabled =
        !supabaseAuth.enabled || supabaseAuth.loading || isAuthenticated() || !sanitizeAuthEmail(supabaseAuth.email);
    }
    if (logoutButton) {
      logoutButton.disabled = !supabaseAuth.enabled || supabaseAuth.loading || !isAuthenticated();
    }
    renderDisplayNameModal();
  }

  function renderDisplayNameModal() {
    if (typeof document === "undefined") {
      return;
    }
    const modal = document.getElementById("auth-display-name-modal");
    const title = document.getElementById("auth-display-name-modal-title");
    const input = document.getElementById("auth-display-name-input");
    const saveButton = document.getElementById("auth-display-name-save");
    const feedbackLine = document.getElementById("auth-display-name-feedback");
    if (!modal || !title || !input || !saveButton || !feedbackLine) {
      return;
    }
    const shouldShow = Boolean(supabaseAuth.displayNameModalOpen && isAuthenticated());
    modal.style.display = shouldShow ? "flex" : "none";
    if (!shouldShow) {
      return;
    }
    const isCreateMode = String(supabaseAuth.displayNameModalMode || "create") !== "change";
    title.textContent = isCreateMode ? "Set your display name" : "Change your display name";
    if (String(input.value || "") !== String(supabaseAuth.displayNameDraft || "")) {
      input.value = String(supabaseAuth.displayNameDraft || "");
    }
    const normalizedValue = sanitizeDisplayName(input.value);
    const disabled = supabaseAuth.displayNameModalSaving || !normalizedValue;
    input.disabled = Boolean(supabaseAuth.displayNameModalSaving);
    saveButton.disabled = disabled;
    saveButton.textContent = supabaseAuth.displayNameModalSaving ? "Saving..." : "Save";
    feedbackLine.textContent = String(supabaseAuth.displayNameModalFeedback || "");
    feedbackLine.style.color = supabaseAuth.displayNameModalFeedbackLevel === "error" ? "#b91c1c" : "";
  }

  function bindAuthControls() {
    if (typeof document === "undefined") {
      return;
    }
    const emailInput = document.getElementById("auth-login-email-input");
    if (emailInput && typeof emailInput.addEventListener === "function") {
      emailInput.addEventListener("input", function onAuthEmailInput() {
        supabaseAuth.email = sanitizeAuthEmail(emailInput.value);
        persistAuthUiState();
        renderMultiplayerUi();
      });
      emailInput.addEventListener("keydown", function onAuthEmailKeydown(event) {
        if (String(event?.key || "").toLowerCase() !== "enter") {
          return;
        }
        event.preventDefault();
        sendAuthMagicLink();
      });
    }
    const sendButton = document.getElementById("auth-send-link");
    if (sendButton && typeof sendButton.addEventListener === "function") {
      sendButton.addEventListener("click", function onAuthSendLinkClick() {
        sendAuthMagicLink();
      });
    }
    const logoutButton = document.getElementById("auth-logout");
    if (logoutButton && typeof logoutButton.addEventListener === "function") {
      logoutButton.addEventListener("click", function onAuthLogoutClick() {
        logoutAuth();
      });
    }
    const changeDisplayNameButton = document.getElementById("auth-change-display-name");
    if (changeDisplayNameButton && typeof changeDisplayNameButton.addEventListener === "function") {
      changeDisplayNameButton.addEventListener("click", function onChangeDisplayNameClick() {
        openDisplayNameModal("change");
      });
    }
    const displayNameInput = document.getElementById("auth-display-name-input");
    if (displayNameInput && typeof displayNameInput.addEventListener === "function") {
      displayNameInput.addEventListener("input", function onDisplayNameInput() {
        supabaseAuth.displayNameDraft = sanitizeDisplayName(displayNameInput.value);
        supabaseAuth.displayNameModalFeedback = "";
        supabaseAuth.displayNameModalFeedbackLevel = "info";
        renderMultiplayerUi();
      });
      displayNameInput.addEventListener("keydown", function onDisplayNameKeydown(event) {
        if (String(event?.key || "").toLowerCase() !== "enter") {
          return;
        }
        event.preventDefault();
        submitDisplayNameModal();
      });
    }
    const displayNameSaveButton = document.getElementById("auth-display-name-save");
    if (displayNameSaveButton && typeof displayNameSaveButton.addEventListener === "function") {
      displayNameSaveButton.addEventListener("click", function onDisplayNameSaveClick() {
        submitDisplayNameModal();
      });
    }
  }

  function getRoomCityInfo(roomCodeInput) {
    const roomCode = normalizeRoomCode(roomCodeInput);
    if (!roomCode) {
      return { city: "Workshop", flag: "🏳️" };
    }
    const poolSize = ROOM_CITY_POOL.length;
    if (poolSize <= 0) {
      return { city: "Workshop", flag: "🏳️" };
    }
    let hash = 2166136261;
    for (let index = 0; index < roomCode.length; index += 1) {
      hash ^= roomCode.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    const normalizedHash = (hash >>> 0);
    const candidate = ROOM_CITY_POOL[normalizedHash % poolSize] || {};
    return {
      city: String(candidate.city || "Workshop"),
      flag: String(candidate.flag || "🏳️"),
    };
  }

  function formatRoomDisplayName(roomCodeInput) {
    const roomCode = normalizeRoomCode(roomCodeInput);
    if (!roomCode) {
      return "🏳️ Workshop";
    }
    const cityInfo = getRoomCityInfo(roomCode);
    return cityInfo.flag + " " + cityInfo.city + " (" + roomCode + ")";
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
              profileId: String(parsed.profileId || ""),
              profileToken: String(parsed.profileToken || ""),
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
            const roomSessionsByCode = normalizeRoomSessionMap(parsed.roomSessionsByCode);
            const legacyRoomCode = normalizeRoomCode(parsed.roomCode || "");
            const legacyPlayerId = String(parsed.playerId || "");
            const legacyReconnectToken = String(parsed.reconnectToken || "");
            if (legacyRoomCode && legacyReconnectToken) {
              roomSessionsByCode[legacyRoomCode] = {
                roomCode: legacyRoomCode,
                playerId: legacyPlayerId,
                reconnectToken: legacyReconnectToken,
                updatedAt: Date.now(),
                lastKnownStatus: String(parsed.lastKnownStatus || "unknown"),
              };
            }
            sessionPart = {
              roomCode: legacyRoomCode,
              playerId: legacyPlayerId,
              reconnectToken: legacyReconnectToken,
              roomSessionsByCode,
            };
          }
        }
      } catch (_error) {}
    }
    const merged = {
      ...defaults,
      ...localPart,
      ...sessionPart,
    };
    if (shouldNormalizeLocalDevMultiplayerUrl(merged.url)) {
      merged.url = inferLocalNodeMultiplayerUrl();
    }
    return merged;
  }

  function getDefaultMultiplayerState() {
    return {
      url: inferDefaultMultiplayerUrl(),
      name: "",
      roomCode: "",
      playerId: "",
      profileId: "",
      profileToken: "",
      reconnectToken: "",
      roomSessionsByCode: {},
      connected: false,
      connecting: false,
      room: null,
      lastError: "",
      connectionId: "",
    };
  }

  function isLocalHostname(hostnameInput) {
    const hostname = String(hostnameInput || "").trim().toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  }

  function formatHostnameWithPort(hostnameInput, portInput) {
    const hostname = String(hostnameInput || "").trim();
    const port = String(portInput || "").trim();
    if (!hostname) {
      return "";
    }
    const needsBrackets = hostname.includes(":") && !hostname.startsWith("[");
    const normalizedHost = needsBrackets ? "[" + hostname + "]" : hostname;
    return port ? normalizedHost + ":" + port : normalizedHost;
  }

  function inferLocalNodeMultiplayerUrl() {
    if (typeof globalScope.location === "undefined") {
      return "ws://localhost:8080";
    }
    const protocol = String(globalScope.location.protocol || "").toLowerCase();
    const hostname = String(globalScope.location.hostname || "").trim();
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    const host = formatHostnameWithPort(hostname || "localhost", "8080");
    return wsProtocol + "//" + host;
  }

  function inferDefaultMultiplayerUrl() {
    if (typeof globalScope.location !== "undefined") {
      const protocol = String(globalScope.location.protocol || "").toLowerCase();
      const host = String(globalScope.location.host || "").trim();
      const hostname = String(globalScope.location.hostname || "").trim();
      const port = String(globalScope.location.port || "").trim();
      if (host && (protocol === "http:" || protocol === "https:")) {
        if (isLocalHostname(hostname) && port && port !== "8080") {
          return inferLocalNodeMultiplayerUrl();
        }
        const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
        return wsProtocol + "//" + host;
      }
    }
    return "ws://localhost:8080";
  }

  function shouldNormalizeLocalDevMultiplayerUrl(currentUrlInput) {
    if (typeof globalScope.location === "undefined") {
      return false;
    }
    const locationHostname = String(globalScope.location.hostname || "").trim();
    const locationPort = String(globalScope.location.port || "").trim();
    if (!isLocalHostname(locationHostname) || !locationPort || locationPort === "8080") {
      return false;
    }
    try {
      const parsed = new URL(String(currentUrlInput || ""));
      const currentHostname = String(parsed.hostname || "").trim();
      const currentPort = String(parsed.port || "").trim();
      return isLocalHostname(currentHostname) && (currentPort === locationPort || !currentPort);
    } catch (_error) {
      return false;
    }
  }

  function persistMultiplayerState() {
    const localStorageRef = typeof globalScope.localStorage !== "undefined" ? globalScope.localStorage : null;
    const sessionStorageRef = typeof globalScope.sessionStorage !== "undefined" ? globalScope.sessionStorage : null;
    if (localStorageRef) {
      const localPayload = {
        url: multiplayerState.url,
        name: multiplayerState.name,
        profileId: multiplayerState.profileId,
        profileToken: multiplayerState.profileToken,
      };
      localStorageRef.setItem(MULTIPLAYER_STORAGE_KEY, JSON.stringify(localPayload));
    }
    if (sessionStorageRef) {
      const sessionPayload = {
        roomCode: multiplayerState.roomCode,
        playerId: multiplayerState.playerId,
        reconnectToken: multiplayerState.reconnectToken,
        roomSessionsByCode: normalizeRoomSessionMap(multiplayerState.roomSessionsByCode),
      };
      sessionStorageRef.setItem(MULTIPLAYER_SESSION_KEY, JSON.stringify(sessionPayload));
    }
  }

  function normalizeRoomSessionMap(input) {
    const source = input && typeof input === "object" ? input : {};
    const normalized = {};
    Object.keys(source).forEach((key) => {
      const entry = source[key];
      if (!entry || typeof entry !== "object") {
        return;
      }
      const roomCode = normalizeRoomCode(entry.roomCode || key);
      const reconnectToken = String(entry.reconnectToken || "").trim();
      if (!roomCode || !reconnectToken) {
        return;
      }
      normalized[roomCode] = {
        roomCode,
        playerId: String(entry.playerId || ""),
        reconnectToken,
        updatedAt: Number(entry.updatedAt || Date.now()),
        lastKnownStatus: String(entry.lastKnownStatus || "unknown"),
      };
    });
    return normalized;
  }

  function upsertRoomSession(roomCodeInput, patchInput) {
    const roomCode = normalizeRoomCode(roomCodeInput);
    if (!roomCode) {
      return null;
    }
    const patch = patchInput && typeof patchInput === "object" ? patchInput : {};
    const sessions = normalizeRoomSessionMap(multiplayerState.roomSessionsByCode);
    const previous = sessions[roomCode] || {
      roomCode,
      playerId: "",
      reconnectToken: "",
      updatedAt: 0,
      lastKnownStatus: "unknown",
    };
    const next = {
      ...previous,
      ...patch,
      roomCode,
      playerId: String(patch.playerId || previous.playerId || ""),
      reconnectToken: String(patch.reconnectToken || previous.reconnectToken || ""),
      updatedAt: Number(patch.updatedAt || Date.now()),
      lastKnownStatus: String(patch.lastKnownStatus || previous.lastKnownStatus || "unknown"),
    };
    if (!next.reconnectToken) {
      return null;
    }
    sessions[roomCode] = next;
    multiplayerState.roomSessionsByCode = sessions;
    persistMultiplayerState();
    return next;
  }

  function removeRoomSession(roomCodeInput) {
    const roomCode = normalizeRoomCode(roomCodeInput);
    if (!roomCode) {
      return;
    }
    const sessions = normalizeRoomSessionMap(multiplayerState.roomSessionsByCode);
    if (!Object.prototype.hasOwnProperty.call(sessions, roomCode)) {
      return;
    }
    delete sessions[roomCode];
    multiplayerState.roomSessionsByCode = sessions;
    persistMultiplayerState();
  }

  function getRoomSession(roomCodeInput) {
    const roomCode = normalizeRoomCode(roomCodeInput);
    if (!roomCode) {
      return null;
    }
    const sessions = normalizeRoomSessionMap(multiplayerState.roomSessionsByCode);
    return sessions[roomCode] || null;
  }

  function getReconnectTokenForRoom(roomCodeInput) {
    const session = getRoomSession(roomCodeInput);
    return String(session?.reconnectToken || "");
  }

  function clearMultiplayerSessionIdentity(optionsInput) {
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const preserveHomeStep = Boolean(options.preserveHomeStep);
    const preserveRoomSessions = options.preserveRoomSessions !== false;
    const removeCurrentRoomSession = Boolean(options.removeCurrentRoomSession);
    const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    multiplayerState.roomCode = "";
    multiplayerState.playerId = "";
    multiplayerState.reconnectToken = "";
    multiplayerState.room = null;
    waitingForRoomTurnAdvance = false;
    appliedServerTurnKey = "";
    localTurnActionCursor = loggerService.toSerializableEntries().length;
    localTurnActionBuffer = [];
    localPublishedActionCursor = 0;
    awaitingRoomStateRecovery = false;
    lastSyncedStateSignature = "";
    activePlayerId = "P1";
    sectionPlayerViews = SECTION_VIEW_KEYS.reduce((accumulator, key) => {
      accumulator[key] = "";
      return accumulator;
    }, {});
    gameSurfaceRoomCode = "";
    if (reconnectTimer) {
      globalScope.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!preserveRoomSessions) {
      multiplayerState.roomSessionsByCode = {};
    } else if (removeCurrentRoomSession && currentRoomCode) {
      const sessions = normalizeRoomSessionMap(multiplayerState.roomSessionsByCode);
      if (Object.prototype.hasOwnProperty.call(sessions, currentRoomCode)) {
        delete sessions[currentRoomCode];
        multiplayerState.roomSessionsByCode = sessions;
      }
    }
    reconnectAttempts = 0;
    persistMultiplayerState();
    if (!preserveHomeStep) {
      homeStep = "mode";
      persistHomeUiState();
    }
  }

  function resetMultiplayerForHomeAction(optionsInput) {
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    clearReconnectTimer();
    reconnectAttempts = 0;
    clearMultiplayerSessionIdentity(options);
    multiplayerState.connecting = false;
    multiplayerState.connected = false;
    multiplayerState.connectionId = "";
    multiplayerState.lastError = "";
    multiplayerClient.disconnect();
    persistMultiplayerState();
    forceHomeSurface = true;
    renderMultiplayerUi();
  }

  async function resetLocalMultiplayerMemory() {
    const profileTokenToReset = String(multiplayerState.profileToken || "").trim();
    await resetProfileRoomsOnServer(profileTokenToReset);
    resetMultiplayerForHomeAction({ preserveHomeStep: true, preserveRoomSessions: false });
    multiplayerState.name = "";
    multiplayerState.profileId = "";
    multiplayerState.profileToken = "";
    roomDirectoryRows = [];
    roomDirectoryLoading = false;
    roomDirectoryLastFetchAt = 0;
    roomDirectoryError = "";
    hubProfileSummary = null;
    hubProfileLoading = false;
    hubProfileLastFetchAt = 0;
    hubProfileError = "";
    hubSelectedRoomCode = "";
    gameSurfaceRoomCode = "";
    persistMultiplayerState();
    queueAuthProfileSync("reset_local_multiplayer");
    setHomeStep("mode");
    renderMultiplayerUi();
    await refreshRoomDirectory(true);
    loggerService.logEvent("info", "Reset local multiplayer memory", { source: "ui" });
  }

  function isInteractionBlocked() {
    return isOnlineInteractionLocked();
  }

  function teardownMultiplayerSession(resetReason) {
    clearMultiplayerSessionIdentity({ removeCurrentRoomSession: true });
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
        profileToken: multiplayerState.profileToken || "",
      });
    }, Math.min(1500 * reconnectAttempts, 5000));
  }

  function summarizeMultiplayerStatus() {
    if (multiplayerState.connecting) {
      return "Connecting...";
    }
    if (multiplayerState.connected) {
      return "Connected";
    }
    if (multiplayerState.lastError) {
      return "Offline";
    }
    return "Offline";
  }

  function normalizeHttpProtocol(protocolInput) {
    const protocol = String(protocolInput || "").toLowerCase();
    if (protocol === "wss:" || protocol === "https:") {
      return "https:";
    }
    if (protocol === "ws:" || protocol === "http:") {
      return "http:";
    }
    return "http:";
  }

  function buildApiCandidates(inputUrl, pathInput) {
    const path = String(pathInput || "/").startsWith("/")
      ? String(pathInput || "/")
      : "/" + String(pathInput || "");
    const candidates = [];
    const seen = new Set();
    const pushUnique = (urlInput) => {
      const url = String(urlInput || "").trim();
      if (!url || seen.has(url)) {
        return;
      }
      seen.add(url);
      candidates.push(url);
    };

    if (typeof globalScope.location !== "undefined") {
      const origin = String(globalScope.location.origin || "").trim();
      const locationHostname = String(globalScope.location.hostname || "").trim();
      const locationPort = String(globalScope.location.port || "").trim();
      const localDevWithSeparateApiPort = isLocalHostname(locationHostname) && locationPort && locationPort !== "8080";
      if (localDevWithSeparateApiPort) {
        const localNodeHttpBase = inferLocalNodeMultiplayerUrl()
          .replace(/^wss:/, "https:")
          .replace(/^ws:/, "http:");
        pushUnique(localNodeHttpBase + path);
      }
      if (origin && !localDevWithSeparateApiPort) {
        pushUnique(origin + path);
      }
    }

    try {
      let raw = String(inputUrl || "").trim() || "ws://localhost:8080";
      if (shouldNormalizeLocalDevMultiplayerUrl(raw)) {
        raw = inferLocalNodeMultiplayerUrl();
      }
      const parsed = new URL(raw);
      const origin = normalizeHttpProtocol(parsed.protocol) + "//" + parsed.host;
      const rawPath = String(parsed.pathname || "/");
      const trimmedPath = rawPath.replace(/\/+$/, "");
      if (trimmedPath && trimmedPath !== "/") {
        let basePath = trimmedPath;
        if (basePath.endsWith("/ws")) {
          basePath = basePath.slice(0, -3);
        }
        pushUnique(origin + basePath + path);
      }
      pushUnique(origin + path);
    } catch (_error) {}

    pushUnique("http://localhost:8080" + path);
    return candidates;
  }

  function buildRoomDirectoryCandidates(inputUrl) {
    return buildApiCandidates(inputUrl, "/api/rooms");
  }

  async function fetchFirstJsonFromCandidates(urls) {
    const candidates = Array.isArray(urls) ? urls : [];
    let lastErrorMessage = "Could not load data";
    for (const url of candidates) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          lastErrorMessage = "Request failed (" + String(response.status) + ")";
          continue;
        }
        const payload = await response.json();
        return {
          ok: true,
          payload,
        };
      } catch (error) {
        lastErrorMessage = String(error?.message || "Could not load data");
      }
    }
    return {
      ok: false,
      error: lastErrorMessage,
    };
  }

  function renderRoomDirectory() {
    if (typeof document === "undefined") {
      return;
    }
    const body = document.getElementById("mp-room-directory-body");
    if (!body) {
      return;
    }
    if (roomDirectoryLoading && roomDirectoryRows.length === 0) {
      body.innerHTML = "<tr><td colspan='4'>Loading...</td></tr>";
      return;
    }
    if (roomDirectoryError && roomDirectoryRows.length === 0) {
      body.innerHTML = "<tr><td colspan='4'>" + String(roomDirectoryError) + "</td></tr>";
      return;
    }
    const openRooms = Array.isArray(roomDirectoryRows)
      ? roomDirectoryRows.filter((room) => {
        const status = String(room?.status || "").toLowerCase();
        return status === "lobby" && Boolean(room?.joinable);
      })
      : [];
    if (openRooms.length === 0) {
      body.innerHTML = "<tr><td colspan='4'>No open rooms</td></tr>";
      return;
    }
    body.innerHTML = openRooms.map((room) => {
      const roomCode = normalizeRoomCode(room.code);
      const roomDisplayName = escapeHtml(formatRoomDisplayName(roomCode));
      const pill = resolveSidebarStatusPill({
        roomCode,
        status: room.status,
      });
      return "<tr>" +
        "<td><strong>" + roomDisplayName + "</strong></td>" +
        "<td>" + String(room.playerCount || 0) + "/" + String(room.maxPlayers || 5) + "</td>" +
        "<td><span class='mp-room-status-pill mp-room-status-pill--" +
        escapeHtml(pill.key) +
        "'>" +
        escapeHtml(pill.label) +
        "</span></td>" +
        "<td><button type='button' data-action='join-listed-room' data-room-code='" + String(room.code || "") + "'>Join</button></td>" +
        "</tr>";
    }).join("");
  }

  async function refreshRoomDirectory(force) {
    if (!isAuthenticated()) {
      roomDirectoryRows = [];
      roomDirectoryLoading = false;
      roomDirectoryError = "";
      renderRoomDirectory();
      return;
    }
    if (typeof fetch !== "function") {
      roomDirectoryRows = [];
      roomDirectoryError = "Room list unavailable";
      renderRoomDirectory();
      return;
    }
    const now = Date.now();
    if (roomDirectoryLoading) {
      return;
    }
    if (!force && now - roomDirectoryLastFetchAt < 4000) {
      return;
    }
    roomDirectoryLoading = true;
    roomDirectoryError = "";
    renderRoomDirectory();
    const candidates = buildRoomDirectoryCandidates(multiplayerState.url).map((baseUrl) => {
      return baseUrl + "?t=" + String(now);
    });
    try {
      const result = await fetchFirstJsonFromCandidates(candidates);
      if (!result.ok) {
        roomDirectoryError = String(result.error || "Could not load rooms");
      } else {
        const payload = result.payload || {};
        roomDirectoryRows = (Array.isArray(payload.roomList) ? payload.roomList : []).filter((room) => {
          const status = String(room?.status || "").toLowerCase();
          return status === "lobby" && Boolean(room?.joinable);
        });
        roomDirectoryLastFetchAt = Date.now();
        roomDirectoryError = "";
      }
    } catch (error) {
      roomDirectoryError = String(error?.message || "Could not load rooms");
    } finally {
      roomDirectoryLoading = false;
      renderRoomDirectory();
    }
  }

  function stopHubAutoRefresh() {
    if (hubAutoRefreshTimer && typeof globalScope.clearInterval === "function") {
      globalScope.clearInterval(hubAutoRefreshTimer);
    }
    hubAutoRefreshTimer = null;
  }

  function ensureHubAutoRefresh() {
    if (typeof window === "undefined" || globalScope !== window) {
      return;
    }
    if (hubAutoRefreshTimer || typeof globalScope.setInterval !== "function") {
      return;
    }
    hubAutoRefreshTimer = globalScope.setInterval(() => {
      if (!isAuthenticated() || hasActiveMultiplayerRoom()) {
        return;
      }
      refreshPlayerHub(false);
    }, 5000);
  }

  function pruneStaleRoomSessions(optionsInput) {
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const authoritative = Boolean(options.authoritative);
    const authoritativeActiveCodes = new Set(
      Array.isArray(options.activeRoomCodes)
        ? options.activeRoomCodes.map((code) => normalizeRoomCode(code)).filter(Boolean)
        : [],
    );
    const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    const sessions = normalizeRoomSessionMap(multiplayerState.roomSessionsByCode);
    let changed = false;
    Object.keys(sessions).forEach((roomCode) => {
      const normalizedCode = normalizeRoomCode(roomCode);
      const session = sessions[roomCode] || {};
      const status = String(session.lastKnownStatus || "").trim().toLowerCase();
      const keepByStatus = isActiveRoomStatus(status);
      const keepByCurrentRoom = Boolean(currentRoomCode && normalizedCode === currentRoomCode);
      const keepByAuthoritative = authoritative && authoritativeActiveCodes.has(normalizedCode);
      if (keepByCurrentRoom || keepByAuthoritative || (!authoritative && keepByStatus)) {
        return;
      }
      delete sessions[roomCode];
      changed = true;
    });
    if (!changed) {
      return;
    }
    multiplayerState.roomSessionsByCode = sessions;
    persistMultiplayerState();
  }

  async function resetProfileRoomsOnServer(profileTokenInput) {
    const profileToken = String(profileTokenInput || "").trim();
    if (!profileToken || typeof fetch !== "function") {
      return false;
    }
    const now = Date.now();
    const encodedToken = encodeURIComponent(profileToken);
    const candidates = buildApiCandidates(
      multiplayerState.url,
      "/api/profile/reset?profileToken=" + encodedToken + "&t=" + String(now),
    );
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          cache: "no-store",
        });
        if (!response.ok) {
          continue;
        }
        return true;
      } catch (_error) {}
    }
    return false;
  }

  function normalizeRoomCode(roomCodeInput) {
    return String(roomCodeInput || "").trim().toUpperCase();
  }

  function isActiveRoomStatus(statusInput) {
    const status = String(statusInput || "").trim().toLowerCase();
    return status === "lobby" || status === "in_game";
  }

  function isFinishedRoomStatus(statusInput) {
    const status = String(statusInput || "").trim().toLowerCase();
    return status === "completed" || status === "abandoned" || status === "terminated" || status === "archived";
  }

  function toRoomStatusLabel(statusInput) {
    const status = String(statusInput || "").trim().toLowerCase();
    if (!status) {
      return "Unknown";
    }
    const labels = {
      lobby: "Lobby",
      in_game: "In Progress",
      completed: "Finished",
      abandoned: "Abandoned",
      terminated: "Terminated",
      archived: "Archived",
    };
    return labels[status] || status.replace(/_/g, " ");
  }

  function formatHubTimestamp(timestampInput) {
    const value = Number(timestampInput);
    if (!Number.isFinite(value) || value <= 0) {
      return "Unknown";
    }
    try {
      return new Date(value).toLocaleString();
    } catch (_error) {
      return "Unknown";
    }
  }

  function setSectionViewsToPlayer(playerIdInput) {
    const playerId = String(playerIdInput || activePlayerId || multiplayerState.playerId || "P1").trim() || "P1";
    SECTION_VIEW_KEYS.forEach((key) => {
      sectionPlayerViews[key] = playerId;
    });
  }

  function getPreferredSectionViewPlayerId() {
    return String(activePlayerId || multiplayerState.playerId || "P1").trim() || "P1";
  }

  function resolveSidebarStatusPill(roomInput) {
    const room = roomInput && typeof roomInput === "object" ? roomInput : {};
    const status = String(room.status || "").toLowerCase();
    if (status === "lobby") {
      return { key: "pending-start", label: "Pending start" };
    }
    if (isFinishedRoomStatus(status)) {
      return { key: "finished", label: "Finished" };
    }
    if (status === "in_game") {
      if (typeof room.myEndedTurn === "boolean") {
        return room.myEndedTurn
          ? { key: "waiting-others", label: "Waiting for others" }
          : { key: "waiting-you", label: "Waiting for you" };
      }
      const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
      const isCurrentRoom = normalizeRoomCode(room.roomCode) === currentRoomCode;
      if (isCurrentRoom && Array.isArray(multiplayerState.room?.players)) {
        const me = multiplayerState.room.players.find((player) => {
          return String(player?.playerId || "") === String(multiplayerState.playerId || "");
        });
        if (me && me.endedTurn) {
          return { key: "waiting-others", label: "Waiting for others" };
        }
        return { key: "waiting-you", label: "Waiting for you" };
      }
      return { key: "waiting-others", label: "Waiting for others" };
    }
    return { key: "pending-start", label: "Pending start" };
  }

  function isRoomHostedByCurrentPlayer(roomInput) {
    const room = roomInput && typeof roomInput === "object" ? roomInput : {};
    const hostPlayerId = String(room.hostPlayerId || "");
    const myPlayerId = String(room.myPlayerId || "");
    return Boolean(hostPlayerId && myPlayerId && hostPlayerId === myPlayerId);
  }

  function getHubRoomSortPriority(roomInput) {
    const room = roomInput && typeof roomInput === "object" ? roomInput : {};
    const primary = resolveSidebarStatusPill(room);
    const hosting = isRoomHostedByCurrentPlayer(room);
    if (hosting && primary.key === "pending-start") {
      return 0;
    }
    if (primary.key === "waiting-you") {
      return 1;
    }
    if (primary.key === "waiting-others" || primary.key === "pending-start") {
      return 2;
    }
    if (primary.key === "finished") {
      return 3;
    }
    return 4;
  }

  function createHubRoomList() {
    const roomsByCode = new Map();
    const upsertRoom = (roomCodeInput, patchInput) => {
      const roomCode = normalizeRoomCode(roomCodeInput);
      if (!roomCode) {
        return;
      }
      const patch = patchInput && typeof patchInput === "object" ? patchInput : {};
      const previous = roomsByCode.get(roomCode) || {
        roomCode,
        status: "unknown",
        playerCount: null,
        maxPlayers: null,
        hostPlayerId: "",
        hostName: "",
        joinable: false,
        listed: false,
        inProfileRecent: false,
        inProfileActive: false,
        currentJoined: false,
        hasReconnectSession: false,
        connected: null,
        myEndedTurn: null,
        myPlayerId: "",
        myPlayerName: "",
        removedByAction: "",
        activityAt: 0,
        createdAt: 0,
      };
      const nextActivityAt = Math.max(
        Number(previous.activityAt || 0),
        Number(patch.activityAt || 0),
        Number(patch.updatedAt || 0),
        Number(patch.lastSeenAt || 0),
      );
      const nextCreatedAt = Math.max(Number(previous.createdAt || 0), Number(patch.createdAt || 0));
      const readBooleanPatch = (key) => {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          return Boolean(patch[key]);
        }
        return Boolean(previous[key]);
      };
      roomsByCode.set(roomCode, {
        ...previous,
        ...patch,
        roomCode,
        status: String(patch.status || previous.status || "unknown"),
        joinable: readBooleanPatch("joinable"),
        hasReconnectSession: readBooleanPatch("hasReconnectSession"),
        listed: readBooleanPatch("listed"),
        inProfileRecent: readBooleanPatch("inProfileRecent"),
        inProfileActive: readBooleanPatch("inProfileActive"),
        currentJoined: readBooleanPatch("currentJoined"),
        activityAt: nextActivityAt,
        createdAt: nextCreatedAt,
      });
    };

    const knownSessions = normalizeRoomSessionMap(multiplayerState.roomSessionsByCode);
    const getKnownSession = (roomCodeInput) => {
      const roomCode = normalizeRoomCode(roomCodeInput);
      if (!roomCode) {
        return null;
      }
      return knownSessions[roomCode] || null;
    };

    const activeRooms = Array.isArray(hubProfileSummary?.activeRooms) ? hubProfileSummary.activeRooms : [];
    activeRooms.forEach((room) => {
      const knownSession = getKnownSession(room?.roomCode);
      const playerId = String(room?.playerId || "");
      const playerName = sanitizeDisplayName(room?.playerName || "");
      upsertRoom(room?.roomCode, {
        status: String(room?.roomStatus || "in_game"),
        inProfileActive: true,
        hasReconnectSession: Boolean(knownSession?.reconnectToken),
        connected: Object.prototype.hasOwnProperty.call(room || {}, "connected")
          ? Boolean(room.connected)
          : null,
        myEndedTurn: typeof room?.endedTurn === "boolean" ? Boolean(room.endedTurn) : null,
        myPlayerId: playerId || String(knownSession?.playerId || ""),
        myPlayerName: playerName || toPlayerSeatLabel(playerId || String(knownSession?.playerId || "")),
        activityAt: Number(room?.updatedAt || room?.joinedAt || knownSession?.updatedAt || 0),
      });
    });

    const directoryRooms = Array.isArray(roomDirectoryRows) ? roomDirectoryRows : [];
    directoryRooms.forEach((room) => {
      const knownSession = getKnownSession(room?.code);
      const hostPlayerId = String(room?.hostPlayerId || "");
      const hostName = sanitizeDisplayName(room?.hostName || "");
      upsertRoom(room?.code, {
        status: String(room?.status || "unknown"),
        playerCount: Number.isFinite(Number(room?.playerCount)) ? Number(room.playerCount) : null,
        maxPlayers: Number.isFinite(Number(room?.maxPlayers)) ? Number(room.maxPlayers) : null,
        hostPlayerId,
        hostName: hostName || (hostPlayerId ? toPlayerSeatLabel(hostPlayerId) : ""),
        hasReconnectSession: Boolean(knownSession?.reconnectToken),
        joinable: Boolean(room?.joinable),
        listed: true,
        activityAt: Number(room?.updatedAt || 0),
        createdAt: Number(room?.createdAt || 0),
      });
    });

    if (multiplayerState.room && multiplayerState.room.code) {
      const room = multiplayerState.room;
      const players = Array.isArray(room.players) ? room.players : [];
      const hostPlayer = players.find((player) => String(player?.playerId || "") === String(room.hostPlayerId || ""));
      const myPlayer = players.find((player) => String(player?.playerId || "") === String(multiplayerState.playerId || ""));
      upsertRoom(room.code, {
        status: String(room.status || "unknown"),
        playerCount: players.length,
        maxPlayers: Number.isFinite(Number(room.maxPlayers)) ? Number(room.maxPlayers) : null,
        hostPlayerId: String(room.hostPlayerId || ""),
        hostName: sanitizeDisplayName(hostPlayer?.name || "") || toPlayerSeatLabel(room.hostPlayerId),
        currentJoined: true,
        joinable: String(room.status || "").toLowerCase() === "lobby",
        hasReconnectSession: Boolean(multiplayerState.reconnectToken),
        connected: true,
        myEndedTurn: (() => {
          const me = players.find((player) => String(player?.playerId || "") === String(multiplayerState.playerId || ""));
          return me ? Boolean(me.endedTurn) : null;
        })(),
        myPlayerId: String(multiplayerState.playerId || ""),
        myPlayerName: sanitizeDisplayName(myPlayer?.name || "") || toPlayerSeatLabel(multiplayerState.playerId),
        activityAt: Number(room.updatedAt || Date.now()),
        createdAt: Number(room.createdAt || 0),
      });
    }

    const list = Array.from(roomsByCode.values()).map((room) => {
      const status = String(room.status || "unknown").toLowerCase();
      const profileKnown = Boolean(room.inProfileActive || room.inProfileRecent || room.currentJoined);
      const sortGroup = getHubRoomSortPriority({
        ...room,
        status,
      });
      return {
        ...room,
        status,
        profileKnown,
        sortGroup,
        isHosting: isRoomHostedByCurrentPlayer(room),
      };
    });
    list.sort((a, b) => {
      if (a.sortGroup !== b.sortGroup) {
        return a.sortGroup - b.sortGroup;
      }
      return Number(b.activityAt || 0) - Number(a.activityAt || 0);
    });
    return list;
  }

  function ensureHubSelection(hubRooms) {
    const rooms = Array.isArray(hubRooms) ? hubRooms : [];
    if (rooms.length === 0) {
      const changed = Boolean(hubSelectedRoomCode);
      hubSelectedRoomCode = "";
      return { selectedCode: "", changed };
    }
    const existing = rooms.find((room) => room.roomCode === hubSelectedRoomCode);
    if (existing) {
      return { selectedCode: existing.roomCode, changed: false };
    }
    const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    const preferred = rooms.find((room) => room.roomCode === currentRoomCode) || rooms[0];
    const nextCode = String(preferred?.roomCode || "");
    const changed = nextCode !== hubSelectedRoomCode;
    hubSelectedRoomCode = nextCode;
    return { selectedCode: nextCode, changed };
  }

  async function refreshHubProfileSummary(force) {
    if (!isAuthenticated()) {
      hubProfileSummary = null;
      hubProfileError = "";
      hubProfileLoading = false;
      renderMultiplayerUi();
      return;
    }
    if (!multiplayerState.profileToken) {
      hubProfileSummary = null;
      hubProfileError = "";
      renderMultiplayerUi();
      return;
    }
    if (typeof fetch !== "function") {
      hubProfileError = "Profile history unavailable";
      renderMultiplayerUi();
      return;
    }
    const now = Date.now();
    if (hubProfileLoading) {
      return;
    }
    if (!force && now - hubProfileLastFetchAt < 4000) {
      return;
    }
    hubProfileLoading = true;
    hubProfileError = "";
    renderMultiplayerUi();
    const encodedToken = encodeURIComponent(String(multiplayerState.profileToken || ""));
    const candidates = buildApiCandidates(
      multiplayerState.url,
      "/api/profile?profileToken=" + encodedToken + "&t=" + String(now),
    );
    try {
      const result = await fetchFirstJsonFromCandidates(candidates);
      const payloadOk = result.ok && Boolean(result.payload?.ok);
      if (!payloadOk) {
        const errorCode = result.ok
          ? String(result.payload?.error || "")
          : result.error;
        if (errorCode === "profile_not_found") {
          hubProfileSummary = null;
          hubProfileError = "";
        } else {
          hubProfileError = String(errorCode || "Could not load profile");
        }
      } else {
        const payload = result.payload || {};
        hubProfileSummary = {
          profile: payload.profile || null,
          activeRooms: Array.isArray(payload.activeRooms) ? payload.activeRooms : [],
          recentRooms: Array.isArray(payload.recentRooms) ? payload.recentRooms : [],
          serverTime: Number(payload.serverTime || now),
        };
        hubProfileLastFetchAt = Date.now();
        hubProfileError = "";
      }
    } catch (error) {
      hubProfileError = String(error?.message || "Could not load profile");
    } finally {
      hubProfileLoading = false;
      renderMultiplayerUi();
    }
  }


  async function refreshPlayerHub(force) {
    if (!isAuthenticated()) {
      roomDirectoryRows = [];
      roomDirectoryError = "";
      hubProfileSummary = null;
      hubProfileError = "";
      renderMultiplayerUi();
      return;
    }
    await Promise.all([
      refreshRoomDirectory(force),
      refreshHubProfileSummary(force),
    ]);
    pruneStaleRoomSessions({
      authoritative: Boolean(hubProfileSummary && !hubProfileError),
      activeRoomCodes: Array.isArray(hubProfileSummary?.activeRooms)
        ? hubProfileSummary.activeRooms.map((room) => room?.roomCode)
        : [],
    });
    const rooms = createHubRoomList();
    ensureHubSelection(rooms);
    renderMultiplayerUi();
  }

  function animateHubRoomListReorder(containerInput, previousTopByCodeInput) {
    const container = containerInput || null;
    const previousTopByCode = previousTopByCodeInput instanceof Map
      ? previousTopByCodeInput
      : new Map();
    if (!container || previousTopByCode.size === 0) {
      return;
    }
    const nodes = Array.from(container.querySelectorAll("a[data-room-code]"));
    const moves = [];
    nodes.forEach((node) => {
      const roomCode = normalizeRoomCode(node.getAttribute("data-room-code") || "");
      if (!roomCode || !previousTopByCode.has(roomCode)) {
        return;
      }
      const previousTop = Number(previousTopByCode.get(roomCode));
      const nextTop = Number(node.getBoundingClientRect().top);
      const deltaY = previousTop - nextTop;
      if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 1) {
        return;
      }
      moves.push({ node, deltaY });
    });
    if (moves.length === 0) {
      return;
    }
    moves.forEach((move) => {
      move.node.style.transition = "none";
      move.node.style.transform = "translateY(" + String(move.deltaY) + "px)";
    });
    const play = () => {
      moves.forEach((move) => {
        move.node.style.transition = "transform 240ms ease";
        move.node.style.transform = "";
      });
    };
    if (typeof globalScope.requestAnimationFrame === "function") {
      globalScope.requestAnimationFrame(play);
      return;
    }
    play();
  }

  function renderHubUi() {
    if (typeof document === "undefined") {
      return;
    }
    const profileLine = document.getElementById("hub-profile-line");
    const roomListNode = document.getElementById("mp-hub-room-list");
    const homeNavNode = document.getElementById("home-sidebar-home");
    const roomTitleNode = document.getElementById("mp-hub-room-title");
    const roomMetaNode = document.getElementById("mp-hub-room-meta");
    const roomOpenButton = document.getElementById("home-room-open");
    const roomAbandonButton = document.getElementById("home-room-abandon");
    const roomActionHintNode = document.getElementById("home-room-action-hint");
    const roomSummaryNode = document.getElementById("mp-hub-room-summary");
    const roomPlayersBodyNode = document.getElementById("mp-hub-room-player-table-body");
    const effectiveStep = resolveHomeStep();
    if (
      !profileLine ||
      !roomListNode ||
      !homeNavNode ||
      !roomTitleNode ||
      !roomMetaNode ||
      !roomOpenButton ||
      !roomAbandonButton ||
      !roomActionHintNode ||
      !roomSummaryNode ||
      !roomPlayersBodyNode
    ) {
      return;
    }

    if (homeNavNode.classList && typeof homeNavNode.classList.toggle === "function") {
      homeNavNode.classList.toggle("home-sidebar__nav-item--active", effectiveStep === "mode");
    }

    if (!multiplayerState.profileToken) {
      profileLine.textContent = "Rooms you started or joined appear here.";
    } else if (hubProfileLoading && !hubProfileSummary) {
      profileLine.textContent = "Loading profile summary...";
    } else if (hubProfileError && !hubProfileSummary) {
      profileLine.textContent = hubProfileError;
    } else if (hubProfileSummary?.profile) {
      const activeCount = Array.isArray(hubProfileSummary.activeRooms) ? hubProfileSummary.activeRooms.length : 0;
      const recentCount = Array.isArray(hubProfileSummary.recentRooms) ? hubProfileSummary.recentRooms.length : 0;
      profileLine.textContent =
        "Profile " +
        String(hubProfileSummary.profile.displayName || "Player") +
        " | Active " +
        String(activeCount) +
        " | Recent " +
        String(recentCount);
    } else {
      profileLine.textContent = "Rooms you started or joined appear here.";
    }

    const rooms = createHubRoomList();
    const selection = ensureHubSelection(rooms);
    const selectedCode = selection.selectedCode;
    const selectedRoom = rooms.find((room) => room.roomCode === selectedCode) || null;

    const renderRoomButtons = (collection) => {
      if (!Array.isArray(collection) || collection.length === 0) {
        return "<div class='mp-hub-room-list__empty'>None</div>";
      }
      return collection.map((room) => {
        const isSelected = room.roomCode === selectedCode;
        const code = escapeHtml(room.roomCode);
        const roomDisplayName = escapeHtml(formatRoomDisplayName(room.roomCode));
        const primaryPill = resolveSidebarStatusPill(room);
        const hostingPill = room.isHosting
          ? "<span class='mp-room-status-pill mp-room-status-pill--hosting'>Hosting</span>"
          : "";
        const players = room.playerCount === null || room.maxPlayers === null
          ? "-"
          : String(room.playerCount) + "/" + String(room.maxPlayers);
        const updatedAt = Number(room.activityAt || 0) > 0
          ? "Updated " + escapeHtml(formatHubTimestamp(room.activityAt))
          : "Updated recently";
        return "<a class='mp-hub-room-item' role='button' tabindex='0'" +
          (isSelected ? " mp-hub-room-item--selected" : "") +
          "' data-action='hub-select-room' data-room-code='" + code + "'>" +
          "<span class='mp-hub-room-item__title'>" + roomDisplayName + "</span>" +
          "<span class='mp-hub-room-item__line'>" +
          "<span class='mp-hub-room-item__pill-row'>" +
          "<span class='mp-room-status-pill mp-room-status-pill--" + escapeHtml(primaryPill.key) + "'>" + escapeHtml(primaryPill.label) + "</span>" +
          hostingPill +
          "</span>" +
          "</span>" +
          "</a>";
      }).join("");
    };

    const previousTopByCode = new Map();
    Array.from(roomListNode.querySelectorAll("a[data-room-code]")).forEach((node) => {
      const roomCode = normalizeRoomCode(node.getAttribute("data-room-code") || "");
      if (!roomCode) {
        return;
      }
      previousTopByCode.set(roomCode, Number(node.getBoundingClientRect().top));
    });
    roomListNode.innerHTML = renderRoomButtons(
      rooms.filter((room) => room.currentJoined || room.inProfileActive),
    );
    animateHubRoomListReorder(roomListNode, previousTopByCode);

    if (!selectedRoom) {
      roomTitleNode.textContent = "Select a room";
      roomMetaNode.textContent = "Pick a room from the sidebar to review details.";
      roomOpenButton.disabled = true;
      roomOpenButton.textContent = "Primary Action";
      roomAbandonButton.disabled = true;
      roomAbandonButton.textContent = "Abandon Game";
      roomActionHintNode.textContent = "Select a room to open or abandon.";
      roomSummaryNode.innerHTML = "<p class='mp-status-line'>No room selected.</p>";
      roomPlayersBodyNode.innerHTML = "<tr><td colspan='6'>No player data available.</td></tr>";
      return;
    }

    const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    const isCurrentRoom = selectedRoom.roomCode === currentRoomCode;
    const actions = resolveHubRoomActions(selectedRoom);
    const statusLabel = toRoomStatusLabel(selectedRoom.status);
    const summaryPlayerCount = selectedRoom.playerCount;
    const summaryMaxPlayers = selectedRoom.maxPlayers;
    const summaryHostPlayerId = String(selectedRoom.hostPlayerId || "");
    const summaryHostLabel = sanitizeDisplayName(selectedRoom.hostName || "") || toPlayerSeatLabel(summaryHostPlayerId);
    const summaryMyLabel = sanitizeDisplayName(selectedRoom.myPlayerName || "") ||
      (selectedRoom.myPlayerId ? toPlayerSeatLabel(selectedRoom.myPlayerId) : "-");

    roomTitleNode.textContent = "Room " + formatRoomDisplayName(selectedRoom.roomCode);
    roomMetaNode.textContent =
      statusLabel +
      (isCurrentRoom ? " | Currently joined" : "") +
      " | Manage room";
    roomOpenButton.disabled = !actions.canOpen;
    roomOpenButton.textContent = actions.openLabel;
    roomAbandonButton.disabled = !actions.canAbandon;
    roomAbandonButton.textContent = actions.abandonLabel;
    roomActionHintNode.textContent = actions.hint;
    const currentRoomTurn = multiplayerState.room?.turn || null;
    const waitingOn = Array.isArray(multiplayerState.room?.players)
      ? multiplayerState.room.players
          .filter((player) => !player.endedTurn)
          .map((player) => toPlayerSeatLabel(player.playerId))
      : [];
    roomSummaryNode.innerHTML =
      "<div class='mp-hub-room-summary__row'><strong>Status</strong><span>" + escapeHtml(statusLabel) + "</span></div>" +
      "<div class='mp-hub-room-summary__row'><strong>Players</strong><span>" +
      escapeHtml(
        summaryPlayerCount === null || summaryMaxPlayers === null
          ? "Unknown"
          : String(summaryPlayerCount) + "/" + String(summaryMaxPlayers),
      ) +
      "</span></div>" +
      "<div class='mp-hub-room-summary__row'><strong>Host</strong><span>" +
      escapeHtml(summaryHostLabel || "Unknown") +
      "</span></div>" +
      "<div class='mp-hub-room-summary__row'><strong>Your seat</strong><span>" +
      escapeHtml(summaryMyLabel) +
      "</span></div>" +
      "<div class='mp-hub-room-summary__row'><strong>Turn</strong><span>" +
      escapeHtml(
        isCurrentRoom && String(multiplayerState.room?.status || "") === "in_game"
          ? String(currentRoomTurn?.day || "Friday") + " #" + String(currentRoomTurn?.number || 1)
          : "-",
      ) +
      "</span></div>" +
      "<div class='mp-hub-room-summary__row'><strong>Waiting On</strong><span>" +
      escapeHtml(
        isCurrentRoom && String(multiplayerState.room?.status || "") === "in_game"
          ? (waitingOn.length > 0 ? waitingOn.join(", ") : "No one")
          : "-",
      ) +
      "</span></div>" +
      "<div class='mp-hub-room-summary__row'><strong>Last seen</strong><span>" +
      escapeHtml(formatHubTimestamp(selectedRoom.activityAt || selectedRoom.createdAt)) +
      "</span></div>" +
      (selectedRoom.removedByAction
        ? "<div class='mp-hub-room-summary__row'><strong>Last action</strong><span>" +
          escapeHtml(selectedRoom.removedByAction) +
          "</span></div>"
        : "");

    if (isCurrentRoom && Array.isArray(multiplayerState.room?.players)) {
      const roomPlayers = multiplayerState.room.players;
      const canKick = isLocalPlayerHost() &&
        (String(multiplayerState.room?.status || "") === "lobby" || String(multiplayerState.room?.status || "") === "in_game");
      roomPlayersBodyNode.innerHTML = roomPlayers.map((player) => {
        const isMe = String(player?.playerId || "") === String(multiplayerState.playerId || "");
        const presence = player.connected ? "online" : "offline";
        const turnState = player.endedTurn ? "ended turn" : "playing";
        const liveSnapshot = getLiveStateSnapshotForRoomPlayer(player);
        const liveScore = Number(liveSnapshot?.player?.totalScore);
        const summaryScore = Number(player?.turnSummary?.totalScore);
        const resolvedScore = Number.isFinite(liveScore)
          ? liveScore
          : (Number.isFinite(summaryScore) ? summaryScore : null);
        const waiting = String(multiplayerState.room?.status || "") === "in_game"
          ? (player.endedTurn ? "No" : "Yes")
          : "-";
        const label = toPlayerSeatLabel(player.playerId) +
          (isMe ? " (you)" : "") +
          (String(player.playerId || "") === String(multiplayerState.room?.hostPlayerId || "") ? " [host]" : "");
        const kickButton = canKick && !isMe
          ? "<button type='button' class='button-destructive' data-action='hub-kick-player' data-player-id='" + String(player.playerId || "") + "'>Kick</button>"
          : "";
        return "<tr>" +
          "<td>" + escapeHtml(label) + "</td>" +
          "<td>" + escapeHtml(presence) + "</td>" +
          "<td>" + escapeHtml(turnState) + "</td>" +
          "<td>" + (resolvedScore === null ? "-" : String(resolvedScore)) + "</td>" +
          "<td>" + escapeHtml(waiting) + "</td>" +
          "<td>" + kickButton + "</td>" +
          "</tr>";
      }).join("");
    } else {
      roomPlayersBodyNode.innerHTML = "<tr><td colspan='6'>Enter this room to view players.</td></tr>";
    }
  }

  function resolveHubRoomActions(selectedRoomInput) {
    const selectedRoom = selectedRoomInput && typeof selectedRoomInput === "object"
      ? selectedRoomInput
      : null;
    if (!selectedRoom) {
      return {
        canOpen: false,
        openLabel: "Primary Action",
        openIntent: "none",
        canAbandon: false,
        abandonLabel: "Abandon Game",
        hint: "Select a room.",
      };
    }
    const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    const reconnectToken = getReconnectTokenForRoom(selectedRoom.roomCode);
    const hasReconnectSession = Boolean(reconnectToken || selectedRoom.hasReconnectSession);
    const status = String(selectedRoom.status || "").toLowerCase();
    const isCurrentRoom = hasActiveMultiplayerRoom() && selectedRoom.roomCode === currentRoomCode;
    const hostPlayerId = String(
      selectedRoom.hostPlayerId ||
      (isCurrentRoom ? String(multiplayerState.room?.hostPlayerId || "") : ""),
    );
    const myPlayerId = String(
      selectedRoom.myPlayerId ||
      (isCurrentRoom ? String(multiplayerState.playerId || "") : ""),
    );
    const isHostMember = Boolean(hostPlayerId && myPlayerId && hostPlayerId === myPlayerId);
    const canSwitchContext = Boolean(
      isCurrentRoom ||
      hasReconnectSession ||
      selectedRoom.inProfileActive ||
      (status === "lobby" && selectedRoom.joinable),
    );
    const canAbandon = Boolean((status === "lobby" || status === "in_game") && canSwitchContext);

    if (status === "lobby") {
      if (isHostMember) {
        return {
          canOpen: canSwitchContext,
          openLabel: "Start Game",
          openIntent: "start_game",
          canAbandon,
          abandonLabel: "Abandon Game",
          hint: "Host abandon deletes the room for all players.",
        };
      }
      return {
        canOpen: false,
        openLabel: "Start Game",
        openIntent: "none",
        canAbandon,
        abandonLabel: "Abandon Game",
        hint: canAbandon
          ? "Only the host can start this game."
          : "Join this room first to manage it.",
      };
    }

    if (status === "in_game") {
      return {
        canOpen: canSwitchContext,
        openLabel: "Go to Game",
        openIntent: "go_to_game",
        canAbandon,
        abandonLabel: "Abandon Game",
        hint: canSwitchContext
          ? "Open game or abandon from this summary."
          : "You can only open this in-progress room after joining it.",
      };
    }

    return {
      canOpen: false,
      openLabel: "Primary Action",
      openIntent: "none",
      canAbandon: false,
      abandonLabel: "Abandon Game",
      hint: isFinishedRoomStatus(selectedRoom.status)
        ? "Room is finished and not reopenable."
        : "Room is not available right now.",
    };
  }

  async function waitForRoomContext(roomCodeInput, timeoutMsInput) {
    const targetRoomCode = normalizeRoomCode(roomCodeInput);
    if (!targetRoomCode) {
      return false;
    }
    const timeoutMs = Math.max(200, Number(timeoutMsInput || 2000));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || "");
      if (currentRoomCode === targetRoomCode) {
        return true;
      }
      await new Promise((resolve) => {
        globalScope.setTimeout(resolve, 30);
      });
    }
    return normalizeRoomCode(multiplayerState.room?.code || "") === targetRoomCode;
  }

  async function ensureSelectedHubRoomContext(selectedRoomInput) {
    const selectedRoom = selectedRoomInput && typeof selectedRoomInput === "object"
      ? selectedRoomInput
      : null;
    if (!selectedRoom) {
      return false;
    }
    const selectedCode = normalizeRoomCode(selectedRoom.roomCode);
    if (!selectedCode) {
      return false;
    }
    const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    if (hasActiveMultiplayerRoom() && currentRoomCode === selectedCode) {
      return true;
    }
    const opened = await openSelectedHubRoom();
    if (opened === false) {
      return false;
    }
    return waitForRoomContext(selectedCode, 3000);
  }

  async function runSelectedHubPrimaryAction() {
    if (isDisplayNameRequired()) {
      openDisplayNameModal("create");
      return;
    }
    const rooms = createHubRoomList();
    const selectedCode = normalizeRoomCode(hubSelectedRoomCode);
    const selectedRoom = rooms.find((room) => room.roomCode === selectedCode) || null;
    if (!selectedRoom) {
      return;
    }
    const actions = resolveHubRoomActions(selectedRoom);
    if (!actions.canOpen) {
      multiplayerState.lastError = actions.hint;
      renderMultiplayerUi();
      return;
    }
    if (actions.openIntent !== "start_game") {
      await openSelectedHubRoom();
      return;
    }
    const entered = await ensureSelectedHubRoomContext(selectedRoom);
    if (!entered) {
      multiplayerState.lastError = "Could not enter this room to start the game.";
      renderMultiplayerUi();
      return;
    }
    if (!isLocalPlayerHost() || String(multiplayerState.room?.status || "") !== "lobby") {
      multiplayerState.lastError = "Only the host can start this game.";
      renderMultiplayerUi();
      return;
    }
    gameSurfaceRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    forceHomeSurface = false;
    setSectionViewsToPlayer(getPreferredSectionViewPlayerId());
    await sendMultiplayerCommand("start_game", {}, {
      errorMessage: "Could not start game. Check connection.",
    });
  }

  async function selectHubRoom(roomCodeInput) {
    const roomCode = normalizeRoomCode(roomCodeInput);
    if (!roomCode) {
      return;
    }
    hubSelectedRoomCode = roomCode;
    setHomeStep("room-list");
    renderMultiplayerUi();
  }

  async function openSelectedHubRoom() {
    if (isDisplayNameRequired()) {
      openDisplayNameModal("create");
      return false;
    }
    const rooms = createHubRoomList();
    const selectedCode = normalizeRoomCode(hubSelectedRoomCode);
    const selectedRoom = rooms.find((room) => room.roomCode === selectedCode) || null;
    if (!selectedRoom) {
      return;
    }
    const actions = resolveHubRoomActions(selectedRoom);
    if (!actions.canOpen) {
      multiplayerState.lastError = actions.hint;
      renderMultiplayerUi();
      return;
    }

    const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    const selectedReconnectToken = getReconnectTokenForRoom(selectedRoom.roomCode);
    if (hasActiveMultiplayerRoom() && selectedRoom.roomCode === currentRoomCode) {
      if (String(multiplayerState.room?.status || "").toLowerCase() === "in_game") {
        gameSurfaceRoomCode = selectedRoom.roomCode;
        forceHomeSurface = false;
        setSectionViewsToPlayer(getPreferredSectionViewPlayerId());
        renderState();
        return true;
      } else {
        gameSurfaceRoomCode = "";
        forceHomeSurface = true;
        setHomeStep("room-list");
        multiplayerClient.send("request_sync");
        return true;
      }
    }

    if (hasActiveMultiplayerRoom() && selectedRoom.roomCode !== currentRoomCode) {
      clearReconnectTimer();
      reconnectAttempts = 0;
      skipAutoReconnectOnNextClose = true;
      multiplayerClient.disconnect();
      multiplayerState.connecting = false;
      multiplayerState.connected = false;
      multiplayerState.connectionId = "";
      multiplayerState.lastError = "";
    }

    const reconnectCandidate = Boolean(selectedReconnectToken);
    multiplayerState.name = getDefaultPlayerName();
    multiplayerState.lastError = "";
    clearMultiplayerSessionIdentity({
      preserveHomeStep: true,
      preserveRoomSessions: true,
    });
    if (String(selectedRoom.status || "").toLowerCase() === "in_game") {
      gameSurfaceRoomCode = selectedRoom.roomCode;
      forceHomeSurface = false;
    } else {
      gameSurfaceRoomCode = "";
      forceHomeSurface = true;
    }
    gameStateService.update({ gameStarted: false });
    multiplayerState.roomCode = selectedRoom.roomCode;
    multiplayerState.reconnectToken = reconnectCandidate ? String(selectedReconnectToken) : "";
    const knownSession = getRoomSession(selectedRoom.roomCode);
    multiplayerState.playerId = String(knownSession?.playerId || "");
    persistMultiplayerState();
    setHomeStep("room-list");
    renderMultiplayerUi();
    await ensureMultiplayerConnection();
    const payload = {
      roomCode: selectedRoom.roomCode,
      name: multiplayerState.name || getDefaultPlayerName(),
      profileToken: multiplayerState.profileToken || "",
    };
    if (reconnectCandidate && selectedReconnectToken) {
      payload.reconnectToken = selectedReconnectToken;
    }
    const sent = await sendMultiplayerCommand("join_room", payload, {
      errorMessage: "Could not open room. Check connection.",
    });
    if (!sent) {
      multiplayerState.lastError = "not_connected";
      gameSurfaceRoomCode = "";
      forceHomeSurface = true;
      setHomeStep("room-list");
      renderMultiplayerUi();
      return false;
    }
    const joined = await waitForRoomContext(selectedRoom.roomCode, 3000);
    if (!joined) {
      multiplayerState.lastError = "Could not sync selected room.";
      renderMultiplayerUi();
      return false;
    }
    if (String(multiplayerState.room?.status || "").toLowerCase() === "in_game") {
      gameSurfaceRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
      forceHomeSurface = false;
      setSectionViewsToPlayer(getPreferredSectionViewPlayerId());
      renderState();
    }
    refreshPlayerHub(true);
    return true;
  }

  async function abandonSelectedHubRoom() {
    if (isDisplayNameRequired()) {
      openDisplayNameModal("create");
      return;
    }
    const rooms = createHubRoomList();
    const selectedCode = normalizeRoomCode(hubSelectedRoomCode);
    const selectedRoom = rooms.find((room) => room.roomCode === selectedCode) || null;
    if (!selectedRoom) {
      return;
    }
    const actions = resolveHubRoomActions(selectedRoom);
    if (!actions.canAbandon) {
      multiplayerState.lastError = actions.hint;
      renderMultiplayerUi();
      return;
    }
    const entered = await ensureSelectedHubRoomContext(selectedRoom);
    if (!entered) {
      multiplayerState.lastError = "Could not enter this room to abandon the game.";
      renderMultiplayerUi();
      return;
    }

    if (isLocalPlayerHost()) {
      const confirmedHost = typeof globalScope.confirm === "function"
        ? globalScope.confirm("Abandon this room for all players?")
        : true;
      if (!confirmedHost) {
        return;
      }
      await sendMultiplayerCommand("terminate_room", {}, {
        errorMessage: "Could not abandon room. Check connection.",
      });
      return;
    }

    const confirmedLeave = typeof globalScope.confirm === "function"
      ? globalScope.confirm("Abandon this room for your player?")
      : true;
    if (!confirmedLeave) {
      return;
    }
    const sent = await sendMultiplayerCommand("leave_room", {}, {
      errorMessage: "Could not leave room. Check connection.",
    });
    if (sent) {
      teardownMultiplayerSession("Left multiplayer room");
    }
  }

  function renderMultiplayerUi() {
    renderAuthUi();
    const connectionNode = document.getElementById("mp-connection-status");
    if (connectionNode) {
      connectionNode.textContent = summarizeMultiplayerStatus();
    }
    const room = multiplayerState.room;
    const roomStatusNode = document.getElementById("mp-room-status");
    if (roomStatusNode) {
      roomStatusNode.style.display = "";
      if (!room) {
        roomStatusNode.textContent = "No room joined.";
      } else {
        const waitSuffix = room.status === "lobby"
          ? " | Waiting for host to start"
          : waitingForRoomTurnAdvance
            ? " | Waiting for all players to end turn"
            : "";
        roomStatusNode.textContent =
          "Room " + formatRoomDisplayName(room.code) + " | " + String(room.status || "lobby") + " | Host " + toPlayerSeatLabel(room.hostPlayerId) + waitSuffix;
      }
    }
    const playerList = document.getElementById("mp-player-list");
    const players = Array.isArray(room?.players) ? room.players : [];
    const playerRows = players
      .map((player) => {
        const meTag = player.playerId === multiplayerState.playerId ? " (you)" : "";
        const hostTag = player.playerId === room?.hostPlayerId ? " [host]" : "";
        const onlineTag = player.connected ? "online" : "offline";
        const turnTag = player.endedTurn ? "ended" : "playing";
        return "<li>" + toPlayerSeatLabel(player.playerId) + meTag + hostTag + " - " + onlineTag + " - " + turnTag + "</li>";
      })
      .join("");
    if (playerList) {
      playerList.innerHTML = playerRows;
      playerList.style.display = "none";
    }
    const competitorPanel = document.getElementById("mp-competitor-visibility");
    if (competitorPanel) {
      competitorPanel.innerHTML = "";
      competitorPanel.style.display = "none";
    }
    const resetButton = document.getElementById("reset-game");
    if (resetButton) {
      resetButton.disabled = false;
      if (hasActiveMultiplayerRoom()) {
        resetButton.textContent = isLocalPlayerHost() ? "Abandon Room" : "Leave Room";
      } else {
        resetButton.textContent = "Abandon Game";
      }
    }
    const backToLobbyButton = document.getElementById("back-to-lobby");
    if (backToLobbyButton) {
      const showBackToLobby = hasJoinedMultiplayerRoom();
      backToLobbyButton.style.display = showBackToLobby ? "" : "none";
      backToLobbyButton.disabled = !showBackToLobby;
    }

    const modeStep = document.getElementById("home-step-mode");
    const roomListStep = document.getElementById("home-step-room-list");
    const stepLabel = document.getElementById("home-step-label");
    const effectiveStep = resolveHomeStep();
    if (modeStep && modeStep.style) {
      modeStep.style.display = effectiveStep === "mode" ? "grid" : "none";
    }
    if (roomListStep && roomListStep.style) {
      roomListStep.style.display = effectiveStep === "room-list" ? "grid" : "none";
    }
    if (stepLabel) {
      if (effectiveStep === "mode") {
        stepLabel.textContent = "Home";
      } else {
        stepLabel.textContent = "Room Details";
      }
    }
    const variableSetupMultiplayerSection = document.getElementById("home-variable-setup-multiplayer");
    if (variableSetupMultiplayerSection && variableSetupMultiplayerSection.style) {
      variableSetupMultiplayerSection.style.display = "grid";
    }
    [
      "var-setup-order-multiplayer",
      "var-setup-idea-multiplayer",
      "var-setup-parts-multiplayer",
    ].forEach((id) => {
      const input = document.getElementById(id);
      if (!input || typeof input.getAttribute !== "function") {
        return;
      }
      const option = String(input.getAttribute("data-variable-setup-option") || "");
      input.checked = Boolean(selectedVariableSetup[option]);
    });
    renderRoomDirectory();
    renderHubUi();
  }

  function importSharedRoomLog(room) {
    if (!room || !Array.isArray(room.sharedLog)) {
      return;
    }
    const sharedOnly = room.sharedLog.map((entry) => {
      const context = entry?.context && typeof entry.context === "object" ? entry.context : {};
      return {
        id: "shared-" + String(entry?.id || ""),
        level: String(entry?.level || "info"),
        message: String(entry?.message || ""),
        timestamp: entry?.timestamp || new Date().toISOString(),
        context: {
          ...context,
          shared: true,
          playerId: String(context.playerId || ""),
        },
      };
    }).slice(-MAX_PERSISTED_LOG_ENTRIES);
    loggerService.replaceEntries(sharedOnly);
  }

  async function ensureMultiplayerConnection() {
    if (!isAuthenticated()) {
      multiplayerState.connecting = false;
      multiplayerState.connected = false;
      multiplayerState.lastError = "Sign in required";
      renderMultiplayerUi();
      return;
    }
    if (multiplayerState.connected) {
      return;
    }
    if (multiplayerState.connecting) {
      try {
        await multiplayerClient.connect(multiplayerState.url);
        multiplayerState.connected = true;
        multiplayerState.connecting = false;
        multiplayerState.lastError = "";
      } catch (error) {
        multiplayerState.connecting = false;
        multiplayerState.connected = false;
        multiplayerState.lastError = String(error?.message || "connect_failed");
      }
      renderMultiplayerUi();
      return;
    }
    if (shouldNormalizeLocalDevMultiplayerUrl(multiplayerState.url)) {
      const normalizedUrl = inferLocalNodeMultiplayerUrl();
      if (normalizedUrl && normalizedUrl !== multiplayerState.url) {
        multiplayerState.url = normalizedUrl;
        persistMultiplayerState();
      }
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
      const initialDetail = String(error?.message || "connect_failed");
      const shouldRetryWithLocalNode = shouldNormalizeLocalDevMultiplayerUrl(multiplayerState.url);
      if (shouldRetryWithLocalNode) {
        const fallbackUrl = inferLocalNodeMultiplayerUrl();
        if (fallbackUrl && fallbackUrl !== multiplayerState.url) {
          multiplayerState.url = fallbackUrl;
          persistMultiplayerState();
          try {
            await multiplayerClient.connect(multiplayerState.url);
            multiplayerState.connected = true;
            multiplayerState.connecting = false;
            multiplayerState.lastError = "";
            loggerService.logEvent("info", "Multiplayer auto-switched to local Node server", {
              url: multiplayerState.url,
              source: "ui",
            });
            renderMultiplayerUi();
            return;
          } catch (_retryError) {
            // fall through to standard error handling below
          }
        }
      }
      multiplayerState.connecting = false;
      multiplayerState.connected = false;
      multiplayerState.lastError = initialDetail;
      loggerService.logEvent("error", "Multiplayer connection failed", { detail: multiplayerState.lastError, source: "ui" });
      renderMultiplayerUi();
    }
  }

  async function sendMultiplayerCommand(type, payload, optionsInput) {
    if (!requireAuthenticatedUser("Sign in required to join or play multiplayer.")) {
      return false;
    }
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const errorMessage = String(options.errorMessage || "not_connected");
    if (multiplayerClient.send(type, payload || {})) {
      return true;
    }
    if (options.tryReconnect !== false) {
      await ensureMultiplayerConnection();
      if (multiplayerClient.send(type, payload || {})) {
        return true;
      }
    }
    multiplayerState.lastError = errorMessage;
    renderMultiplayerUi();
    loggerService.logEvent("warn", "Multiplayer command failed to send", {
      type: String(type || ""),
      source: "network",
    });
    return false;
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

  function resolvePlayerName(playerIdInput, optionsInput) {
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const preferYou = options.preferYou !== false;
    const playerId = String(playerIdInput || "").trim();
    if (!playerId) {
      return "";
    }
    if (preferYou && !hasActiveMultiplayerRoom() && (playerId === "P1" || playerId === String(activePlayerId || ""))) {
      return "You";
    }
    const roomPlayers = Array.isArray(multiplayerState.room?.players) ? multiplayerState.room.players : [];
    const match = roomPlayers.find((item) => String(item?.playerId || "").trim() === playerId);
    if (match && String(match.name || "").trim()) {
      return String(match.name || "").trim();
    }
    if (String(multiplayerState.playerId || "") === playerId) {
      const localName = sanitizeDisplayName(multiplayerState.name || getAssignedDisplayName());
      if (localName) {
        return localName;
      }
    }
    return getPlayerSeatFallbackLabel(playerId);
  }

  function toPlayerSeatLabel(playerIdInput) {
    return resolvePlayerName(playerIdInput, { preferYou: false });
  }

  function getDefaultPlayerName() {
    return String(getAuthDisplayNameFallback() || "Player");
  }

  function escapeHtml(valueInput) {
    return String(valueInput || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getPhaseShortLabel(phaseInput) {
    const labels = {
      roll_and_group: "Roll",
      journal: "Journal",
      workshop: "Workshop",
      build: "Build",
      invent: "Invent",
      end_of_round: "End Turn",
    };
    const key = String(phaseInput || "");
    return labels[key] || "Unknown";
  }

  function computeAvailableWrenchesFromSnapshot(playerSnapshotInput) {
    const playerSnapshot = playerSnapshotInput && typeof playerSnapshotInput === "object"
      ? playerSnapshotInput
      : null;
    if (!playerSnapshot) {
      return null;
    }
    const journals = Array.isArray(playerSnapshot.journals) ? playerSnapshot.journals : [];
    const earned = journals.reduce((count, journal) => {
      const row = Array.isArray(journal?.rowWrenches) ? journal.rowWrenches : [];
      const col = Array.isArray(journal?.columnWrenches) ? journal.columnWrenches : [];
      return (
        count +
        row.filter((value) => value === "earned").length +
        col.filter((value) => value === "earned").length
      );
    }, 0);
    const spent = Number(playerSnapshot.spentWrenches || 0);
    return Math.max(0, earned - spent);
  }

  function getLiveStateSnapshotForRoomPlayer(roomPlayerInput) {
    const roomPlayer = roomPlayerInput && typeof roomPlayerInput === "object" ? roomPlayerInput : null;
    const liveState = roomPlayer?.liveState && typeof roomPlayer.liveState === "object"
      ? roomPlayer.liveState
      : null;
    if (!roomPlayer || !liveState) {
      return { state: null, player: null };
    }
    const players = Array.isArray(liveState.players) ? liveState.players : [];
    const byId = players.find((item) => String(item?.id || "") === String(roomPlayer.playerId || ""));
    return {
      state: liveState,
      player: byId || players[0] || null,
    };
  }

  function getLastSharedActionForPlayer(roomInput, playerIdInput) {
    const room = roomInput && typeof roomInput === "object" ? roomInput : null;
    const playerId = String(playerIdInput || "");
    const entries = Array.isArray(room?.sharedLog) ? room.sharedLog : [];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const actor = String(entry?.context?.playerId || "");
      if (actor === playerId) {
        return entry;
      }
    }
    return null;
  }

  function renderCompetitorVisibilityPanel(roomInput) {
    const container = document.getElementById("mp-competitor-visibility");
    if (!container) {
      return;
    }
    const room = roomInput && typeof roomInput === "object" ? roomInput : null;
    if (!room) {
      container.innerHTML = "";
      if (container.style) {
        container.style.display = "none";
      }
      return;
    }
    if (container.style) {
      container.style.display = "grid";
    }
    if (room.status === "lobby") {
      container.innerHTML = "<p class='mp-status-line'>Competitor visibility appears after the game starts.</p>";
      return;
    }
    const players = Array.isArray(room.players) ? room.players : [];
    const localPlayerId = String(multiplayerState.playerId || "");
    const competitors = players.filter((player) => String(player?.playerId || "") !== localPlayerId);
    if (competitors.length === 0) {
      container.innerHTML = "<p class='mp-status-line'>No competitors in this room yet.</p>";
      return;
    }
    const roomTurn = Number(room?.turn?.number || 0);
    const roomDay = String(room?.turn?.day || "");
    const cards = competitors.map((player) => {
      const snapshot = getLiveStateSnapshotForRoomPlayer(player);
      const state = snapshot.state;
      const playerSnapshot = snapshot.player;
      const hasSnapshot = Boolean(playerSnapshot);
      const totalScore = hasSnapshot ? Number(playerSnapshot.totalScore || 0) : null;
      const completedJournals = hasSnapshot ? Number(playerSnapshot.completedJournals || 0) : null;
      const unlockedTools = hasSnapshot && Array.isArray(playerSnapshot.unlockedTools)
        ? playerSnapshot.unlockedTools.length
        : null;
      const wrenches = hasSnapshot ? computeAvailableWrenchesFromSnapshot(playerSnapshot) : null;
      const liveTurn = hasSnapshot ? Number(state?.turnNumber || 0) : null;
      const liveDay = hasSnapshot ? String(state?.currentDay || "") : "";
      const inSync = hasSnapshot && liveTurn === roomTurn && liveDay === roomDay;
      const livePhase = hasSnapshot ? getPhaseShortLabel(state?.phase) : "No state";
      const lastAction = getLastSharedActionForPlayer(room, player.playerId);
      const lastActionText = lastAction?.message
        ? String(lastAction.message)
        : "No shared action yet.";
      const inventionSummary = hasSnapshot && Array.isArray(playerSnapshot.inventions)
        ? playerSnapshot.inventions
            .map((invention) => {
              const inventionId = String(invention?.id || "?");
              const placements = Array.isArray(invention?.placements) ? invention.placements.length : 0;
              return inventionId + ":" + String(placements);
            })
            .join(" | ")
        : "";
      const onlineTag = player.connected ? "online" : "offline";
      const turnTag = player.endedTurn ? "ended turn" : "playing";
      const statusText = onlineTag + " | " + turnTag;
      const syncText = hasSnapshot
        ? (inSync ? "synced" : "syncing")
        : "waiting";
      return "<article class='mp-competitor-card'>" +
        "<div class='mp-competitor-card__head'>" +
        "<strong class='mp-competitor-card__name'>" + escapeHtml(toPlayerSeatLabel(player.playerId)) + "</strong>" +
        "<span class='mp-competitor-card__status'>" + escapeHtml(statusText) + "</span>" +
        "</div>" +
        "<div class='mp-competitor-card__meta'>Phase: " + escapeHtml(livePhase) + " | " + escapeHtml(syncText) + "</div>" +
        "<div class='mp-competitor-card__metrics'>" +
        "<span><strong>Score</strong> " + (totalScore === null ? "-" : String(totalScore)) + "</span>" +
        "<span><strong>Journals</strong> " + (completedJournals === null ? "-" : String(completedJournals) + "/3") + "</span>" +
        "<span><strong>Wrenches</strong> " + (wrenches === null ? "-" : String(wrenches)) + "</span>" +
        "<span><strong>Tools</strong> " + (unlockedTools === null ? "-" : String(unlockedTools)) + "</span>" +
        "</div>" +
        "<div class='mp-competitor-card__activity'><strong>Latest:</strong> " + escapeHtml(lastActionText) + "</div>" +
        (inventionSummary
          ? "<div class='mp-competitor-card__inventions'><strong>Inventions</strong> " + escapeHtml(inventionSummary) + "</div>"
          : "") +
        "</article>";
    }).join("");
    container.innerHTML =
      "<h4 class='mp-competitor-visibility__title'>Competitor Visibility</h4>" +
      "<div class='mp-competitor-grid'>" + cards + "</div>";
  }

  function getOrderedPlayerIdsForView(stateInput) {
    const state = stateInput && typeof stateInput === "object" ? stateInput : {};
    const ordered = [];
    const seen = new Set();
    const push = (playerIdInput) => {
      const playerId = String(playerIdInput || "").trim();
      if (!playerId || seen.has(playerId)) {
        return;
      }
      seen.add(playerId);
      ordered.push(playerId);
    };
    const roomPlayers = Array.isArray(multiplayerState.room?.players) ? multiplayerState.room.players : [];
    roomPlayers.forEach((player) => push(player?.playerId));
    const localPlayers = Array.isArray(state.players) ? state.players : [];
    localPlayers.forEach((player) => push(player?.id));
    push(activePlayerId);
    if (ordered.length === 0) {
      push("P1");
    }
    const activeId = String(activePlayerId || "").trim();
    if (!activeId || !seen.has(activeId)) {
      return ordered;
    }
    return [activeId].concat(ordered.filter((playerId) => playerId !== activeId));
  }

  function getPlayerSnapshotForView(stateInput, playerIdInput) {
    const state = stateInput && typeof stateInput === "object" ? stateInput : {};
    const playerId = String(playerIdInput || "").trim();
    if (!playerId) {
      return { state: null, player: null };
    }
    const localPlayers = Array.isArray(state.players) ? state.players : [];
    const localPlayer = localPlayers.find((player) => String(player?.id || "") === playerId);
    if (localPlayer) {
      return { state, player: localPlayer };
    }
    const roomPlayers = Array.isArray(multiplayerState.room?.players) ? multiplayerState.room.players : [];
    const roomPlayer = roomPlayers.find((player) => String(player?.playerId || "") === playerId);
    if (!roomPlayer) {
      return { state: null, player: null };
    }
    const snapshot = getLiveStateSnapshotForRoomPlayer(roomPlayer);
    if (snapshot.player) {
      return {
        state: snapshot.state || null,
        player: snapshot.player,
      };
    }
    return { state: null, player: null };
  }

  function getSectionView(stateInput, sectionKeyInput) {
    const state = stateInput && typeof stateInput === "object" ? stateInput : {};
    const sectionKey = String(sectionKeyInput || "").trim();
    const orderedIds = getOrderedPlayerIdsForView(state);
    const currentForSection = String(sectionPlayerViews?.[sectionKey] || "").trim();
    const currentGlobal = String(sectionPlayerViews?.[SECTION_VIEW_KEYS[0]] || "").trim();
    let selectedPlayerId = orderedIds.includes(currentForSection)
      ? currentForSection
      : "";
    if (!selectedPlayerId && orderedIds.includes(currentGlobal)) {
      selectedPlayerId = currentGlobal;
    }
    if (!selectedPlayerId) {
      selectedPlayerId = orderedIds[0] || "";
    }
    if (selectedPlayerId) {
      SECTION_VIEW_KEYS.forEach((key) => {
        sectionPlayerViews[key] = selectedPlayerId;
      });
    }
    const snapshot = getPlayerSnapshotForView(state, selectedPlayerId);
    const snapshotState = snapshot.state && typeof snapshot.state === "object"
      ? snapshot.state
      : state;
    return {
      sectionKey,
      playerIds: orderedIds,
      playerId: selectedPlayerId,
      player: snapshot.player,
      state: snapshotState,
      editable: selectedPlayerId === String(activePlayerId || ""),
    };
  }

  function renderSectionPlayerTabs(stateInput, sectionKeyInput) {
    const sectionKey = String(sectionKeyInput || "").trim();
    if (!sectionKey) {
      return;
    }
    const container = document.getElementById(sectionKey + "-player-tabs");
    if (!container) {
      return;
    }
    const view = getSectionView(stateInput, sectionKey);
    const ids = Array.isArray(view.playerIds) ? view.playerIds : [];
    if (ids.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = ids.map((playerId) => {
      const isSelected = playerId === view.playerId;
      const label = toPlayerSeatLabel(playerId);
      return (
        '<button type="button" class="section-player-tab' +
        (isSelected ? " section-player-tab--active" : "") +
        '" data-action="section-view-player" data-section="' +
        escapeHtml(sectionKey) +
        '" data-player-id="' +
        escapeHtml(playerId) +
        '">' +
        escapeHtml(label) +
        "</button>"
      );
    }).join("");
  }

  function renderAllSectionPlayerTabs(stateInput) {
    SECTION_VIEW_KEYS.forEach((sectionKey) => {
      renderSectionPlayerTabs(stateInput, sectionKey);
    });
  }

  function isSectionViewingActivePlayer(stateInput, sectionKeyInput) {
    return getSectionView(stateInput, sectionKeyInput).editable;
  }

  function renderPlayerStateTitle() {
    const titleNode = document.getElementById("player-state-title");
    if (!titleNode) {
      return;
    }
    if (hasActiveMultiplayerRoom()) {
      const roomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
      titleNode.textContent = "Snapshot • " + formatRoomDisplayName(roomCode);
      return;
    }
    titleNode.textContent = "Snapshot";
  }

  function triggerSectionViewFadeAnimation() {
    const targetIds = [
      "journals-container",
      "workshops-container",
      "inventions-container",
      "tools-container",
    ];
    targetIds.forEach((id) => {
      const node = document.getElementById(id);
      if (!node || !node.classList) {
        return;
      }
      node.classList.remove("section-view-fade");
      void node.offsetWidth;
      node.classList.add("section-view-fade");
    });
  }

  function logPlayerAction(message, contextInput) {
    const playerId = String(activePlayerId || multiplayerState.playerId || "").trim();
    if (!playerId) {
      return;
    }
    const context = contextInput && typeof contextInput === "object" ? contextInput : {};
    loggerService.logEvent("info", String(message || "Player action"), {
      source: "player_action",
      playerId,
      playerName: resolvePlayerName(playerId),
      ...context,
    });
  }

  function hasLocalPlayerEndedTurnInRoom() {
    const room = multiplayerState.room;
    if (!room || !Array.isArray(room.players) || !multiplayerState.playerId) {
      return false;
    }
    const me = room.players.find((player) => player.playerId === multiplayerState.playerId);
    return Boolean(me && me.endedTurn);
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
    return localTurnActionBuffer
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        level: String(entry.level || "info"),
        message: String(entry.message || ""),
        timestamp: entry.timestamp || null,
        context: entry.context && typeof entry.context === "object" ? entry.context : {},
        clientActionId: String(entry.clientActionId || ""),
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
    const unsentActions = localTurnActionBuffer.slice(Math.max(0, localPublishedActionCursor));
    const sent = multiplayerClient.send("player_state_update", {
      state: payload,
      actions: unsentActions,
    });
    if (sent) {
      localPublishedActionCursor = localTurnActionBuffer.length;
    }
  }

  function submitOnlineEndTurn() {
    if (!isMultiplayerGameActive()) {
      return false;
    }
    logPlayerAction("Confirmed turn end", {
      action: "round-end-turn",
      day: String(roundEngineService.getState().currentDay || ""),
      turnNumber: Number(roundEngineService.getState().turnNumber || 0),
    });
    const sent = multiplayerClient.send("end_turn", {
      turnSummary: getCurrentOnlineTurnSummary(),
    });
    if (sent) {
      waitingForRoomTurnAdvance = true;
      localPublishedActionCursor = localTurnActionBuffer.length;
      loggerService.logEvent("info", "Ended turn online; waiting for other players", { source: "network" });
      renderMultiplayerUi();
      return true;
    }
    return false;
  }

  function cancelOnlineEndTurnIfNeeded() {
    if (!isMultiplayerGameActive()) {
      return false;
    }
    const ended = hasLocalPlayerEndedTurnInRoom();
    if (!waitingForRoomTurnAdvance && !ended) {
      return false;
    }
    const state = roundEngineService.getState();
    multiplayerClient.send("cancel_end_turn", {
      payload: {
        turnNumber: Number(state.turnNumber || 0),
        day: String(state.currentDay || ""),
      },
    });
    waitingForRoomTurnAdvance = false;
    if (multiplayerState.room && Array.isArray(multiplayerState.room.players)) {
      multiplayerState.room = {
        ...multiplayerState.room,
        players: multiplayerState.room.players.map((player) =>
          player.playerId === multiplayerState.playerId
            ? { ...player, endedTurn: false }
            : player
        ),
      };
    }
    renderMultiplayerUi();
    return true;
  }

  function advancePhaseForCurrentMode() {
    const state = roundEngineService.getState();
    if (!isMultiplayerGameActive()) {
      roundEngineService.advancePhase();
      return;
    }
    if (state.phase === "end_of_round") {
      submitOnlineEndTurn();
      return;
    }
    if (state.phase === "invent") {
      gameStateService.update({ phase: "end_of_round" });
      return;
    }
    if (state.phase === "build") {
      gameStateService.update({ phase: "invent" });
      return;
    }
    if (state.phase === "workshop") {
      const canBuild = typeof roundEngineService.canBuildThisTurn === "function"
        ? roundEngineService.canBuildThisTurn(state, activePlayerId)
        : true;
      gameStateService.update({ phase: canBuild ? "build" : "invent" });
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
        localTurnActionBuffer = [];
        localPublishedActionCursor = 0;
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
      localTurnActionBuffer = [];
      localPublishedActionCursor = 0;
      gameStateService.update({
        gameConfig: resolveHomeNewGameConfig(),
        setupPlan: null,
      });
      roundEngineService.setSeed(String(room.code));
      roundEngineService.initializePlayers([activePlayerId]);
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
      localTurnActionBuffer = [];
      localPublishedActionCursor = 0;
      lastSyncedStateSignature = "";
    }
    const me = (room.players || []).find((item) => item.playerId === multiplayerState.playerId);
    if (me) {
      waitingForRoomTurnAdvance = Boolean(me.endedTurn);
    }
  }

  multiplayerClient.onOpen(() => {
    skipAutoReconnectOnNextClose = false;
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
    if (skipAutoReconnectOnNextClose) {
      skipAutoReconnectOnNextClose = false;
      return;
    }
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
      if (message.profileId) {
        multiplayerState.profileId = String(message.profileId || "");
      }
      if (message.profileToken) {
        multiplayerState.profileToken = String(message.profileToken || "");
      }
      activePlayerId = multiplayerState.playerId || activePlayerId;
      multiplayerState.reconnectToken = String(message.reconnectToken || "");
      if (!forceHomeSurface && normalizeRoomCode(gameSurfaceRoomCode) === normalizeRoomCode(multiplayerState.roomCode)) {
        setSectionViewsToPlayer(getPreferredSectionViewPlayerId());
      }
      if (multiplayerState.roomCode && multiplayerState.reconnectToken) {
        upsertRoomSession(multiplayerState.roomCode, {
          playerId: multiplayerState.playerId,
          reconnectToken: multiplayerState.reconnectToken,
          lastKnownStatus: "lobby",
        });
      }
      appliedServerTurnKey = "";
      awaitingRoomStateRecovery = true;
      homeStep = "room-list";
      persistHomeUiState();
      persistMultiplayerState();
      queueAuthProfileSync("room_joined");
      gameStateService.update({ gameStarted: false });
      renderMultiplayerUi();
      refreshPlayerHub(true);
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
      importSharedRoomLog(multiplayerState.room);
      if (message?.you?.playerId) {
        multiplayerState.playerId = String(message.you.playerId);
        if (message?.you?.profileId) {
          multiplayerState.profileId = String(message.you.profileId || "");
        }
        if (message?.you?.profileToken) {
          multiplayerState.profileToken = String(message.you.profileToken || "");
        }
        activePlayerId = multiplayerState.playerId || activePlayerId;
        const meInRoom = (Array.isArray(multiplayerState.room?.players) ? multiplayerState.room.players : [])
          .find((player) => String(player?.playerId || "") === String(multiplayerState.playerId || ""));
        if (meInRoom && String(meInRoom.name || "").trim()) {
          multiplayerState.name = String(meInRoom.name || "").trim();
        }
      }
      if (message?.you?.reconnectToken) {
        multiplayerState.reconnectToken = String(message.you.reconnectToken);
      }
      const knownReconnectToken = String(
        multiplayerState.reconnectToken || getReconnectTokenForRoom(multiplayerState.room?.code || ""),
      );
      const resolvedRoomCode = normalizeRoomCode(multiplayerState.room?.code || "");
      const resolvedRoomStatus = String(multiplayerState.room?.status || "").toLowerCase();
      if (resolvedRoomCode && knownReconnectToken && isActiveRoomStatus(resolvedRoomStatus)) {
        upsertRoomSession(multiplayerState.room.code, {
          playerId: multiplayerState.playerId,
          reconnectToken: knownReconnectToken,
          lastKnownStatus: String(multiplayerState.room.status || "unknown"),
        });
      } else if (resolvedRoomCode && !isActiveRoomStatus(resolvedRoomStatus)) {
        removeRoomSession(resolvedRoomCode);
      }
      const incomingLiveState = message?.you?.liveState && typeof message.you.liveState === "object"
        ? message.you.liveState
        : null;
      const incomingRoomStatus = String(multiplayerState.room?.status || "").toLowerCase();
      homeStep = "room-list";
      if (incomingRoomStatus === "lobby") {
        gameSurfaceRoomCode = "";
        forceHomeSurface = true;
      }
      persistMultiplayerState();
      queueAuthProfileSync("room_state");
      persistHomeUiState();
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
      if (incomingRoomStatus === "in_game" && !forceHomeSurface) {
        const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
        if (currentRoomCode && currentRoomCode === normalizeRoomCode(gameSurfaceRoomCode)) {
          setSectionViewsToPlayer(getPreferredSectionViewPlayerId());
        }
      }
      renderMultiplayerUi();
      renderState();
      refreshPlayerHub(false);
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
        upsertRoomSession(message.roomCode, {
          playerId: multiplayerState.playerId,
          reconnectToken: multiplayerState.reconnectToken,
          lastKnownStatus: "in_game",
        });
      }
      syncLocalGameToRoom(multiplayerState.room);
      loggerService.logEvent("info", "Online turn advanced", {
        roomCode: message.roomCode,
        day: message.day,
        turnNumber: message.turnNumber,
        roll: message.roll,
        source: "network",
      });
      refreshPlayerHub(false);
      return;
    }
    if (type === "game_completed") {
      waitingForRoomTurnAdvance = false;
      if (multiplayerState.room && multiplayerState.room.code === message.roomCode) {
        multiplayerState.room = {
          ...multiplayerState.room,
          status: "completed",
        };
        upsertRoomSession(message.roomCode, {
          playerId: multiplayerState.playerId,
          reconnectToken: multiplayerState.reconnectToken,
          lastKnownStatus: "completed",
        });
      }
      loggerService.logEvent("info", "Online game completed", {
        roomCode: message.roomCode,
        finalDay: message.finalDay,
        source: "network",
      });
      renderMultiplayerUi();
      refreshPlayerHub(true);
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
      if (code === "already_in_room") {
        multiplayerState.lastError = "Already connected to a room. Opening room.";
        setHomeStep("room-list");
        multiplayerClient.send("request_sync");
        renderMultiplayerUi();
        loggerService.logEvent("warn", "Multiplayer server error", { code, detail, source: "network" });
        return;
      }
      if (code === "room_not_found" || code === "room_full" || code === "room_in_progress" || code === "turn_mismatch") {
        clearMultiplayerSessionIdentity({
          removeCurrentRoomSession: code === "room_not_found",
        });
      }
      multiplayerState.lastError = detail;
      renderMultiplayerUi();
      loggerService.logEvent("warn", "Multiplayer server error", { code, detail, source: "network" });
    }
  });

  function setGameSurfaceVisibility(started) {
    const authGateScreen = document.getElementById("auth-gate-screen");
    const newGameScreen = document.getElementById("new-game-screen");
    const appShell = document.getElementById("app-shell");
    const footer = document.getElementById("action-footer");
    if (!isAuthenticated()) {
      stopHubAutoRefresh();
      if (authGateScreen && authGateScreen.style) {
        authGateScreen.style.display = "flex";
      }
      if (newGameScreen && newGameScreen.style) {
        newGameScreen.style.display = "none";
      }
      if (appShell && appShell.style) {
        appShell.style.display = "none";
      }
      if (footer && footer.style) {
        footer.style.display = "none";
      }
      return;
    }
    if (authGateScreen && authGateScreen.style) {
      authGateScreen.style.display = "none";
    }
    ensureHubAutoRefresh();
    const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
    const isMultiplayerSurface = hasActiveMultiplayerRoom()
      ? currentRoomCode && currentRoomCode === normalizeRoomCode(gameSurfaceRoomCode)
      : true;
    const showGameSurface = Boolean(started) && !forceHomeSurface && Boolean(isMultiplayerSurface);
    if (newGameScreen && newGameScreen.style) {
      newGameScreen.style.display = showGameSurface ? "none" : "flex";
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
      invent: "Go to End Of Round",
      end_of_round: "End Turn",
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
    if (state.phase === "end_of_round") {
      return waitingForRoomTurnAdvance
        ? "Waiting for other players to end their turn."
        : "Confirm end of round when you are done.";
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
    const phases = roundEngineService.getPhases().concat(["end_of_round"]);
    const state = roundEngineService.getState();
    const currentDay = state.currentDay || "Friday";
    const currentSeed = state.rngSeed || "default-seed";
    const roomCode = hasActiveMultiplayerRoom()
      ? String(multiplayerState.room?.code || multiplayerState.roomCode || "")
      : "";
    const currentTurn = "Turn " + String(state.turnNumber || 1);
    const contextCrumbs = roomCode
      ? ["Room " + formatRoomDisplayName(roomCode), "Seed " + currentSeed, currentDay, currentTurn]
      : ["Seed " + currentSeed, currentDay, currentTurn];
    const phaseOffset = contextCrumbs.length;
    const crumbs = contextCrumbs
      .concat(phases.map((phase) => phase.replaceAll("_", " ")))
      .map(function toCrumb(label, index) {
        const isActive = index >= phaseOffset && phases[index - phaseOffset] === currentPhase;
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

  function getDiePipPositions(value) {
    const normalized = Math.max(1, Math.min(6, Number(value) || 1));
    if (normalized === 1) {
      return ["mc"];
    }
    if (normalized === 2) {
      return ["tl", "br"];
    }
    if (normalized === 3) {
      return ["tl", "mc", "br"];
    }
    if (normalized === 4) {
      return ["tl", "tr", "bl", "br"];
    }
    if (normalized === 5) {
      return ["tl", "tr", "mc", "bl", "br"];
    }
    return ["tl", "tr", "ml", "mr", "bl", "br"];
  }

  function renderRoundRollDie(value, index) {
    const pipMarkup = getDiePipPositions(value)
      .map((position) => '<span class="round-roll-pip round-roll-pip--' + position + '"></span>')
      .join("");
    return (
      '<span class="round-roll-die" aria-label="Die value ' +
      String(value) +
      '" style="--die-index:' +
      String(index) +
      ';">' +
      '<span class="round-roll-die-face">' +
      pipMarkup +
      "</span>" +
      "</span>"
    );
  }

  function renderUnknownRoundRollDie(index) {
    return (
      '<span class="round-roll-die round-roll-die--unknown" aria-label="Unknown die value" style="--die-index:' +
      String(index) +
      ';">' +
      '<span class="round-roll-die-face">' +
      '<span class="round-roll-die-question">?</span>' +
      "</span>" +
      "</span>"
    );
  }

  function isRenderableDieValue(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 6;
  }

  function renderGroupOptionLabel(option) {
    const values = Array.isArray(option?.values) ? option.values : [];
    if (values.length === 0 || !values.every((value) => isRenderableDieValue(value))) {
      return {
        isDice: false,
        markup: String(option?.label || ""),
      };
    }
    return {
      isDice: true,
      markup:
        '<span class="round-roll-dice-tray round-roll-dice-tray--inline">' +
        values.map((value, index) => renderRoundRollDie(value, index)).join("") +
        "</span>",
    };
  }

  function getDirectDieStates(selectedValues, remainingValues) {
    const selected = Array.isArray(selectedValues)
      ? selectedValues.map((value) => Number(value)).filter((value) => isRenderableDieValue(value))
      : [];
    const remainingCounts = new Map();
    (Array.isArray(remainingValues) ? remainingValues : [])
      .map((value) => Number(value))
      .filter((value) => isRenderableDieValue(value))
      .forEach((value) => {
        const key = String(value);
        remainingCounts.set(key, Number(remainingCounts.get(key) || 0) + 1);
      });
    return selected.map((value, index) => {
      const key = String(value);
      const available = Number(remainingCounts.get(key) || 0);
      if (available > 0) {
        remainingCounts.set(key, available - 1);
        return { value, index, used: false };
      }
      return { value, index, used: true };
    });
  }

  function renderNumberChoiceButtons(config) {
    const selectedValues = Array.isArray(config?.selectedValues) ? config.selectedValues : [];
    const remainingValues = Array.isArray(config?.remainingValues) ? config.remainingValues : [];
    const allChoices = Array.isArray(config?.allChoices) ? config.allChoices : [];
    const action = String(config?.action || "");
    const activePick = config?.activePick || null;
    if (!action) {
      return "";
    }
    const directStates = getDirectDieStates(selectedValues, remainingValues);
    const directButtons = directStates.map((stateItem) => {
      const isActive =
        !stateItem.used &&
        Number(stateItem.value) === Number(activePick?.usedValue) &&
        Number(stateItem.value) === Number(activePick?.consumeValue) &&
        !Boolean(activePick?.adjusted);
      return (
        '<button type="button" class="journal-chip journal-chip--number journal-chip--number-die' +
        (isActive ? " journal-chip--active" : "") +
        (stateItem.used ? " journal-chip--die-used" : "") +
        '" data-action="' +
        action +
        '" data-number="' +
        String(stateItem.value) +
        '" data-consume-number="' +
        String(stateItem.value) +
        '" data-adjusted="false" ' +
        (stateItem.used ? "disabled " : "") +
        'aria-label="Value ' +
        String(stateItem.value) +
        (stateItem.used ? " (used)" : "") +
        '">' +
        '<span class="round-roll-dice-tray round-roll-dice-tray--inline">' +
        renderRoundRollDie(stateItem.value, stateItem.index) +
        "</span>" +
        "</button>"
      );
    });
    const adjustedButtons = allChoices
      .filter((choice) => Boolean(choice?.adjusted))
      .map((choice, index) => {
        const isActive =
          Number(choice.usedValue) === Number(activePick?.usedValue) &&
          Number(choice.consumeValue) === Number(activePick?.consumeValue) &&
          Boolean(choice.adjusted) === Boolean(activePick?.adjusted);
        return (
          '<button type="button" class="journal-chip journal-chip--number journal-chip--number-die journal-chip--number-adjusted' +
          (isActive ? " journal-chip--active" : "") +
          '" data-action="' +
          action +
          '" data-number="' +
          String(choice.usedValue) +
          '" data-consume-number="' +
          String(choice.consumeValue) +
          '" data-adjusted="true" title="Ball Bearing: uses ' +
          String(choice.consumeValue) +
          ' as ' +
          String(choice.usedValue) +
          '" aria-label="Adjusted value ' +
          String(choice.usedValue) +
          '">' +
          '<span class="round-roll-dice-tray round-roll-dice-tray--inline">' +
          renderRoundRollDie(choice.usedValue, index) +
          "</span>" +
          '<span class="journal-chip-adjusted-badge">+</span>' +
          "</button>"
        );
      });
    const markup = directButtons.concat(adjustedButtons).join("");
    return markup || "<span class='journal-muted'>No numbers remaining.</span>";
  }

  function renderRoundRoll(state) {
    const container = document.getElementById("round-roll-container");
    const title = document.getElementById("round-roll-title");
    if (!container) {
      return;
    }
    if (title) {
      title.textContent = "Turn " + String(state?.turnNumber || "-") + ": Rolled Dice";
    }
    const dice = Array.isArray(state.rollAndGroup?.dice) ? state.rollAndGroup.dice : [];
    if (dice.length === 0) {
      container.innerHTML = "<span class='journal-muted'>Waiting for roll phase.</span>";
      container.className = "round-roll-container";
      return;
    }
    const rollKey = String(state.rollAndGroup?.rolledAtDay || "") + ":" + String(state.rollAndGroup?.rolledAtTurn || "");
    const waitingForReveal = state.phase === "roll_and_group" && rollRevealVisibleKey !== rollKey;
    if (waitingForReveal) {
      container.innerHTML =
        '<span class="round-roll-spinner" aria-hidden="true"></span>' +
        "<span class='journal-muted'>Rolling dice...</span>";
      container.className = "round-roll-container round-roll-container--pending";
      return;
    }
    container.innerHTML =
      '<span class="journal-muted">Rolled:</span>' +
      '<span class="round-roll-dice-tray">' +
      dice.map((value, index) => renderRoundRollDie(value, index)).join("") +
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
    if (phase === "end_of_round") {
      return "round-roll-panel";
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
    let afterState = null;
    if (isMultiplayerGameActive()) {
      afterState = gameStateService.update({ phase: "end_of_round" });
    } else {
      afterState = roundEngineService.advancePhase();
    }
    const afterKey = String(afterState?.currentDay) + ":" + String(afterState?.turnNumber) + ":" + String(afterState?.phase) + ":" + String(afterState?.gameStatus);
    return afterKey !== beforeKey;
  }

  function renderState() {
    try {
      renderMultiplayerUi();
      renderPlayerStateTitle();
      const shouldAnimateSectionView = sectionViewTransitionPending;
      sectionViewTransitionPending = false;
      const state = roundEngineService.getState();
      const started = isGameStarted(state);
      setGameSurfaceVisibility(started);
      if (!started) {
        clearRollPhaseTimers();
        lastAutoScrollTarget = "";
        lastAutoScrollPhaseKey = "";
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
          const toolsContainer = document.getElementById("tools-container");
          if (toolsContainer) {
            toolsContainer.innerHTML = "<p class='tools-placeholder'>Tools unlock after the game starts.</p>";
          }
          const summary = document.getElementById("player-state-summary");
          if (summary) {
            summary.innerHTML = "<p>Multiplayer room joined.</p><p>Waiting in lobby.</p>";
          }
          const advanceButton = document.getElementById("advance-phase");
          if (advanceButton) {
            advanceButton.style.display = "none";
          }
          const undoButton = document.getElementById("undo-action");
          if (undoButton) {
            undoButton.style.display = "none";
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
      renderAllSectionPlayerTabs(withAutoWorkshopState);
      const journalsView = getSectionView(withAutoWorkshopState, "journals");
      const workshopsView = getSectionView(withAutoWorkshopState, "workshops");
      const inventionsView = getSectionView(withAutoWorkshopState, "inventions");
      const toolsView = getSectionView(withAutoWorkshopState, "tools");
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
        if (withAutoWorkshopState.phase === "invent" || withAutoWorkshopState.phase === "end_of_round") {
          disableAdvance = true;
        }
        advanceButton.disabled = disableAdvance;
      }
      const undoButton = document.getElementById("undo-action");
      if (undoButton) {
        undoButton.style.display = "";
        undoButton.disabled = undoStack.length === 0;
      }
      renderPhaseControls(withAutoWorkshopState);
      lastHudState = withAutoWorkshopState;
      renderPlayerStatePanel(withAutoWorkshopState);
      renderRoundRoll(withAutoWorkshopState);
      renderJournals(journalsView.state, journalsView.player, journalsView);
      renderWorkshops(workshopsView.state, workshopsView.player, workshopsView);
      renderInventions(inventionsView.state, inventionsView.player, inventionsView);
      renderToolsPanel(toolsView.state, toolsView.player, toolsView);
      maybeAutoScrollToPhaseSection(withAutoWorkshopState);
      updateActiveAnchorFromScroll();
      maybePublishLocalState(withAutoWorkshopState);
      renderMultiplayerUi();
      if (shouldAnimateSectionView) {
        triggerSectionViewFadeAnimation();
      }
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
    if (phase === "end_of_round") {
      return "round-roll-panel";
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
    const phaseKey = String(state.currentDay || "") + ":" + String(state.turnNumber || "") + ":" + String(state.phase || "");
    if (!nextSectionId) {
      return;
    }
    if (lastAutoScrollTarget === nextSectionId && lastAutoScrollPhaseKey === phaseKey) {
      return;
    }
    lastAutoScrollTarget = nextSectionId;
    lastAutoScrollPhaseKey = phaseKey;
    if (typeof globalScope.requestAnimationFrame === "function") {
      globalScope.requestAnimationFrame(() => {
        scrollWorkspaceToSection(nextSectionId);
      });
      return;
    }
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
      const playerNames = players.map((player) => toPlayerSeatLabel(player.playerId)).join(", ");
      const canHostStart = isLocalPlayerHost() && room.status === "lobby" && players.length >= 1;
      const hostControls = isLocalPlayerHost()
        ? (
            '<button type="button" class="journal-chip journal-chip--group" data-action="mp-start-lobby"' +
            (canHostStart ? "" : " disabled") +
            ">Start Game</button>" +
            '<button type="button" class="journal-chip button-destructive" data-action="mp-cancel-room">Cancel Room</button>'
          )
        : (
            "<span class='journal-muted'>Waiting for host to start.</span>" +
            '<button type="button" class="journal-chip button-destructive" data-action="mp-leave-lobby">Leave Room</button>'
          );
      controls.innerHTML =
        "<div class='journal-control-row'><strong>Room " + escapeHtml(formatRoomDisplayName(room.code || "-")) + "</strong></div>" +
        "<div class='journal-control-row'><span class='journal-muted'>Players: " + (playerNames || "none") + "</span></div>" +
        "<div class='journal-control-row'>" + hostControls + "</div>";
      if (controls.style) {
        controls.style.display = "grid";
      }
      return;
    }

    if (state.phase !== "roll_and_group" &&
      state.phase !== "journal" &&
      state.phase !== "workshop" &&
      state.phase !== "build" &&
      state.phase !== "invent" &&
      state.phase !== "end_of_round") {
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

    if (state.phase === "end_of_round") {
      const waiting = Boolean(waitingForRoomTurnAdvance || hasLocalPlayerEndedTurnInRoom());
      controls.innerHTML =
        "<div class='journal-control-row'>" +
        "<button type='button' class='journal-chip journal-chip--group' data-action='round-end-turn' " +
        (waiting ? "disabled" : "") +
        ">" +
        (waiting ? "Confirm End Of Turn" : "Confirm End Of Turn") +
        "</button>" +
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
      const orientationConfirmButton = isMultiplayerGameActive()
        ? ""
        : '<button type="button" class="journal-chip journal-chip--group" data-action="invent-confirm">Confirm</button>';
      const orientationControls = inventShape.toolActive
        ? (
            '<div class="journal-control-row invent-orientation-row">' +
            '<button type="button" class="journal-chip" data-action="invent-rotate-cw">↻</button>' +
            shapePreview +
            '<button type="button" class="journal-chip" data-action="invent-rotate-ccw">↺</button>' +
            '<button type="button" class="journal-chip" data-action="invent-mirror">Mirror</button>' +
            orientationConfirmButton +
            '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
            "</div>" +
            ""
          )
        : "";
      const actionButton = isMultiplayerGameActive()
        ? ""
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
                actionButton +
                '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
                "</div>"
              ))
        : (
            "<div class='journal-control-row'><span class='journal-muted'>No mechanism available to invent.</span></div>" +
            (isMultiplayerGameActive()
              ? '<div class="journal-control-row"><button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button></div>'
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
      const isEurekaWorkshop = state.rollAndGroup?.outcomeType === "eureka";
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
            '" data-action="workshop-use-wrench">Pay a 🔧 → ' +
            '<span class="round-roll-dice-tray round-roll-dice-tray--inline">' +
            renderUnknownRoundRollDie(0) +
            "</span>" +
            "</button>"
          )
        : "";
      const groupButtons = options.length > 0
        ? options
            .map(
              (option) => {
                const label = renderGroupOptionLabel(option);
                return (
                '<button type="button" class="journal-chip journal-chip--group' +
                (label.isDice ? " journal-chip--group-dice" : "") +
                (option.key === selectedGroupKey ? " journal-chip--active" : "") +
                '" data-action="workshop-select-group" data-group-key="' +
                option.key +
                '" aria-label="' +
                String(option.label || "") +
                '">' +
                label.markup +
                "</button>"
                );
              },
            )
            .join("")
        : "<span class='journal-muted'>No workshop options this turn.</span>";
      const workshopNumberChoices =
        typeof roundEngineService.getWorkshopNumberChoices === "function"
          ? roundEngineService.getWorkshopNumberChoices(activePlayerId)
          : [];
      const activeWorkshopPick = selection?.activePick || null;
      const numberButtons = renderNumberChoiceButtons({
        selectedValues: selection?.selectedGroupValues,
        remainingValues: selection?.remainingNumbers,
        allChoices: workshopNumberChoices,
        activePick: activeWorkshopPick,
        action: "workshop-select-number",
      });

      let html = "";
      if (isEurekaWorkshop) {
        html = '<div class="journal-control-row journal-control-row--prominent">' +
          "<span class='journal-muted'>Eureka: choose any one workshop part.</span>" +
          wrenchButton +
          '<button type="button" class="journal-chip" data-action="advance-phase-inline">Skip</button>' +
          "</div>";
      } else if (!selectedGroupKey) {
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
            (option) => {
              const label = renderGroupOptionLabel(option);
              return (
              '<button type="button" class="journal-chip' +
              " journal-chip--group" +
              (label.isDice ? " journal-chip--group-dice" : "") +
              (option.key === selectedGroupKey ? " journal-chip--active" : "") +
              (groupLocked && option.key !== selectedGroupKey ? " journal-chip--disabled" : "") +
              '" data-action="select-group" data-group-key="' +
              option.key +
              '" aria-label="' +
              String(option.label || "") +
              '" ' +
              (groupLocked && option.key !== selectedGroupKey ? "disabled" : "") +
              '">' +
              label.markup +
              "</button>"
              );
            },
          )
          .join("")
      : "<span class='journal-muted'>No group choices available.</span>";

    const journalNumberChoices =
      typeof roundEngineService.getJournalNumberChoices === "function"
        ? roundEngineService.getJournalNumberChoices(activePlayerId)
        : [];
    const activePick = selection?.activePick || null;
    const numberButtons = renderNumberChoiceButtons({
      selectedValues: selection?.selectedGroupValues,
      remainingValues: selection?.remainingNumbers,
      allChoices: journalNumberChoices,
      activePick,
      action: "select-number",
    });

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

  function renderPlayerStatePanel(stateInput) {
    const state = stateInput && typeof stateInput === "object" ? stateInput : {};
    const summary = document.getElementById("player-state-summary");
    if (!summary) {
      return;
    }
    const orderedPlayerIds = getOrderedPlayerIdsForView(state);
    const roomPlayers = Array.isArray(multiplayerState.room?.players) ? multiplayerState.room.players : [];
    const roomById = new Map(roomPlayers.map((player) => [String(player?.playerId || ""), player]));
    if (orderedPlayerIds.length === 0) {
      summary.innerHTML = "<p class='journal-muted'>No player data yet.</p>";
      return;
    }
    const rows = orderedPlayerIds.map((playerId) => {
      const snapshot = getPlayerSnapshotForView(state, playerId);
      const player = snapshot.player;
      const roomPlayer = roomById.get(playerId) || null;
      const totalScore = player ? Number(player.totalScore || 0) : null;
      const completedJournals = player ? Number(player.completedJournals || 0) : null;
      const wrenches = player ? computeAvailableWrenchesFromSnapshot(player) : null;
      const tools = player && Array.isArray(player.unlockedTools) ? player.unlockedTools.length : null;
      const isOnline = roomPlayer ? Boolean(roomPlayer.connected) : true;
      const nameLabel = resolvePlayerName(playerId, { preferYou: false }) || playerId;
      const playerLabel = playerId === String(activePlayerId || "")
        ? nameLabel + " (you)"
        : nameLabel;
      return (
        "<tr>" +
        "<td><span class='player-name-cell'><span class='player-presence-dot " + (isOnline ? "player-presence-dot--online" : "player-presence-dot--offline") + "'></span>" + escapeHtml(playerLabel) + "</span></td>" +
        "<td>" + (totalScore === null ? "-" : String(totalScore)) + "</td>" +
        "<td>" + (completedJournals === null ? "-" : String(completedJournals) + "/3") + "</td>" +
        "<td>" + (wrenches === null ? "-" : String(wrenches)) + "</td>" +
        "<td>" + (tools === null ? "-" : String(tools)) + "</td>" +
        "</tr>"
      );
    }).join("");
    summary.innerHTML =
      "<table class='player-summary-table'>" +
      "<thead><tr>" +
      "<th>Player</th>" +
      "<th>Score</th>" +
      "<th>Journals</th>" +
      "<th>Wrenches</th>" +
      "<th>Tools</th>" +
      "</tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table>";
  }

  function renderGameHudOverlay() {
    const container = document.getElementById("game-hud-players");
    if (!container || !lastHudState) {
      return;
    }
    const state = lastHudState;
    const playerIds = getOrderedPlayerIdsForView(state);
    const catalog = typeof roundEngineService.getActiveTools === "function"
      ? roundEngineService.getActiveTools(activePlayerId)
      : [];
    const columns = playerIds.map(function (playerId) {
      const snapshot = getPlayerSnapshotForView(state, playerId);
      const player = snapshot.player;
      const isYou = playerId === String(activePlayerId || "");
      const name = resolvePlayerName(playerId, { preferYou: false }) || playerId;
      const score = player ? Number(player.totalScore || 0) : 0;
      const wrenchCount = player ? (Number(computeAvailableWrenchesFromSnapshot(player)) || 0) : 0;
      const completedJournals = player ? Number(player.completedJournals || 0) : 0;

      // Wrenches pill with label — shows 'none' when count is 0
      const wrenchDisplay = wrenchCount === 0
        ? '<span class="hud-wrenches-none">none</span>'
        : (wrenchCount <= 8
          ? '<span class="hud-wrenches-value">' + "🔧".repeat(wrenchCount) + "</span>"
          : '<span class="hud-wrenches-value">🔧×' + wrenchCount + "</span>");
      const wrenchPillHtml = '<div class="hud-wrenches-pill"><span class="hud-wrenches-label">Wrenches</span>' + wrenchDisplay + "</div>";

      // Workshops with mechanism line SVG overlay
      const workshops = Array.isArray(player && player.workshops) ? player.workshops : [];
      const wsHtml = workshops.map(function (ws) {
        const cells = (ws.cells || []).map(function (row) {
          return (Array.isArray(row) ? row : []).map(function (cell) {
            let cls = "workshop-hud-cell";
            if (cell.circled) {
              cls += " workshop-hud-cell--circled";
            } else if (cell.kind === "number" || cell.kind === "wild") {
              cls += " workshop-hud-cell--filled";
            }
            return '<span class="' + cls + '"></span>';
          }).join("");
        }).join("");
        const mechSvg = player
          ? renderWorkshopMechanismLines(state, player, ws.id, playerId)
          : "";
        const overlaidSvg = mechSvg
          ? mechSvg.replace("<svg ", '<svg class="workshop-hud-lines" ')
          : "";
        return (
          '<div class="workshop-hud-wrapper">' +
          '<div class="workshop-hud-grid">' + cells + "</div>" +
          overlaidSvg +
          "</div>"
        );
      }).join("");

      // Inventions: pattern (circles + connecting lines), criterion below, idea icons below
      const inventionData = Array.isArray(player && player.inventions) ? player.inventions : [];
      const iHtml = inventionData.map(function (inv) {
        const patternRows = Array.isArray(inv.pattern) ? inv.pattern.map(String) : [];
        const numRows = patternRows.length;
        const numCols = patternRows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
        const placementKeys = new Set(
          (Array.isArray(inv.placements) ? inv.placements : [])
            .flatMap(function (p) { return Array.isArray(p.cells) ? p.cells : []; })
            .map(function (c) { return String(Number(c.row)) + ":" + String(Number(c.col)); })
        );
        const miniResult = renderInventionMiniPattern(inv.pattern, placementKeys);
        const criterionKey = String(inv.criterionLabel || "");
        const criterion = escapeHtml(criterionKey);
        const criterionDesc = escapeHtml(
          typeof getUniqueCriterionDescription === "function"
            ? String(getUniqueCriterionDescription(criterionKey) || "")
            : ""
        );
        const ideasCount = Number(inv.ideasCaptured || 0);

        // SVG lines connecting adjacent placed cells (cell 12px, gap 2px → pitch 14px)
        const cellPitch = 14;
        const cellCenter = 6;
        const gridW = numCols * cellPitch - 2;
        const gridH = numRows * cellPitch - 2;
        const lineSegments = [];
        placementKeys.forEach(function (key) {
          const parts = key.split(":");
          const row = Number(parts[0]);
          const col = Number(parts[1]);
          if (placementKeys.has(String(row) + ":" + String(col + 1))) {
            lineSegments.push({ x1: col * cellPitch + cellCenter, y1: row * cellPitch + cellCenter, x2: (col + 1) * cellPitch + cellCenter, y2: row * cellPitch + cellCenter });
          }
          if (placementKeys.has(String(row + 1) + ":" + String(col))) {
            lineSegments.push({ x1: col * cellPitch + cellCenter, y1: row * cellPitch + cellCenter, x2: col * cellPitch + cellCenter, y2: (row + 1) * cellPitch + cellCenter });
          }
        });
        const invSvgHtml = lineSegments.length > 0
          ? '<svg class="invention-hud-lines" width="' + gridW + '" height="' + gridH + '">' +
            lineSegments.map(function (s) {
              return '<line class="invention-hud-line" x1="' + s.x1 + '" y1="' + s.y1 + '" x2="' + s.x2 + '" y2="' + s.y2 + '" vector-effect="non-scaling-stroke"></line>';
            }).join("") + "</svg>"
          : "";

        // Idea icons: one chip per captured idea
        let ideaTokensHtml = "";
        if (ideasCount > 0) {
          const chips = ideasCount <= 12
            ? new Array(ideasCount).fill('<span class="hud-idea-token">💡</span>').join("")
            : '<span class="hud-idea-token">💡</span><span class="hud-wrench-count">×' + ideasCount + "</span>";
          ideaTokensHtml = '<div class="hud-idea-tokens">' + chips + "</div>";
        }

        return (
          '<div class="invention-hud-wrapper">' +
          '<div class="invention-hud-grid-container">' +
          '<span class="invent-hud-pattern" style="grid-template-columns:repeat(' + miniResult.cols + ',12px)">' + miniResult.html + "</span>" +
          invSvgHtml +
          "</div>" +
          (criterion ? '<div class="invention-hud-criterion">' + criterion + "</div>" : "") +
          (criterionDesc ? '<div class="invention-hud-description">' + criterionDesc + "</div>" : "") +
          ideaTokensHtml +
          "</div>"
        );
      }).join("");

      // Tools: unlocked first (with ability text), then locked (with ability text)
      const unlockedById = new Set(
        (Array.isArray(player && player.unlockedTools) ? player.unlockedTools : [])
          .map(function (t) { return String((t && t.id) || ""); })
      );
      const unlockedTools = catalog.filter(function (t) { return unlockedById.has(String(t.id || "")); });
      const lockedTools = catalog.filter(function (t) { return !unlockedById.has(String(t.id || "")); });

      function hudToolHtml(tool) {
        const shape = renderToolShape(tool.pattern);
        const miniHtml = shape.html.replace('class="tool-shape"', 'class="tool-shape tool-shape--mini"');
        const ability = escapeHtml(String(tool.abilityText || "").trim());
        return (
          '<div class="hud-tool-item">' +
          miniHtml +
          (ability ? '<div class="hud-tool-ability">' + ability + "</div>" : "") +
          "</div>"
        );
      }

      const unlockedHtml = unlockedTools.map(hudToolHtml).join("");
      const lockedHtml = lockedTools.map(hudToolHtml).join("");
      const toolsHtml = (
        (unlockedHtml ? '<div class="hud-tools-section hud-tools-unlocked"><div class="hud-section-label">Unlocked Tools</div><div class="hud-section-row">' + unlockedHtml + "</div></div>" : "") +
        (lockedHtml ? '<div class="hud-tools-section hud-tools-locked"><div class="hud-section-label">Locked Tools</div><div class="hud-section-row">' + lockedHtml + "</div></div>" : "")
      );

      return (
        '<div class="hud-player-card">' +
        '<div class="hud-player-header">' +
        '<div class="hud-player-name">' + escapeHtml(name) + (isYou ? " <span style='font-weight:400;font-size:0.78rem;color:rgba(0,0,0,0.4)'>you</span>" : "") + "</div>" +
        '<div class="hud-player-stats">' +
        "<span>★ " + score + "</span>" +
        wrenchPillHtml +
        "<span>📓 " + completedJournals + "/3</span>" +
        "</div>" +
        "</div>" +
        '<div class="hud-player-body">' +
        '<div class="hud-col-left">' +
        (wsHtml ? '<div class="hud-section"><div class="hud-section-label">Workshops</div><div class="hud-workshops-2x2">' + wsHtml + "</div></div>" : "") +
        "</div>" +
        '<div class="hud-col-right">' +
        (iHtml ? '<div class="hud-section"><div class="hud-section-label">Inventions</div><div class="hud-inventions-list">' + iHtml + "</div></div>" : "") +
        (toolsHtml ? '<div class="hud-section">' + toolsHtml + "</div>" : "") +
        "</div>" +
        "</div>" +
        "</div>"
      );
    }).join("");
    container.innerHTML = columns;
  }

  function isGameActive() {
    const appShell = document.getElementById("app-shell");
    return Boolean(appShell && appShell.style.display !== "none");
  }

  function showGameHud() {
    if (!isGameActive()) {
      return;
    }
    const overlay = document.getElementById("game-hud-overlay");
    if (!overlay) {
      return;
    }
    renderGameHudOverlay();
    overlay.style.display = "flex";
  }

  function hideGameHud() {
    const overlay = document.getElementById("game-hud-overlay");
    if (overlay) {
      overlay.style.display = "none";
    }
  }

  function renderToolsPanel(_state, player, viewInput) {
    const container = document.getElementById("tools-container");
    if (!container) {
      return;
    }
    if (!player) {
      container.innerHTML = "<p class='tools-placeholder'>No visible data for this player yet.</p>";
      return;
    }
    const view = viewInput && typeof viewInput === "object" ? viewInput : {};
    const viewPlayerId = String(view.playerId || activePlayerId || "");
    const catalog = typeof roundEngineService.getActiveTools === "function"
      ? roundEngineService.getActiveTools(activePlayerId)
      : [];
    if (catalog.length === 0) {
      container.innerHTML = '<p class="tools-placeholder">No tools configured.</p>';
      return;
    }
    const unlockedById = new Set(
      (Array.isArray(player.unlockedTools) ? player.unlockedTools : [])
        .map((tool) => String(tool?.id || "")),
    );
    const cards = catalog
      .map((tool) => {
        const unlocked = unlockedById.has(String(tool.id || ""));
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
    const name = resolvePlayerName(viewPlayerId) || viewPlayerId;
    container.innerHTML =
      "<p class='tools-panel-subtitle'>Viewing " + escapeHtml(name) + "</p>" +
      "<div class='tool-grid'>" + cards + "</div>";
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

  function renderWorkshops(stateInput, player, viewInput) {
    const state = stateInput && typeof stateInput === "object" ? stateInput : {};
    const view = viewInput && typeof viewInput === "object" ? viewInput : {};
    const viewPlayerId = String(view.playerId || activePlayerId || "");
    const editable = Boolean(view.editable);
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
    const selection = state.workshopSelections?.[viewPlayerId];
    const isEurekaWorkshop = state.phase === "workshop" && state.rollAndGroup?.outcomeType === "eureka";
    const allowedWorkshopValues =
      editable && state.phase === "workshop"
        ? (
            typeof roundEngineService.getWorkshopNumberChoices === "function"
              ? roundEngineService
                  .getWorkshopNumberChoices(viewPlayerId)
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
          editable && typeof roundEngineService.hasTool === "function"
            ? roundEngineService.hasTool(viewPlayerId, "T4")
            : false;
        const workshopLockedOut = !isEurekaWorkshop && !hasReamer && Boolean(selectedWorkshopId) && selectedWorkshopId !== workshop.id;
        const activeNumber = Number(selection?.activeNumber);
        const buildDraft = state.buildDrafts?.[viewPlayerId];
        const isBuildPhase = editable && state.phase === "build";
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
                  editable &&
                  state.phase === "workshop" &&
                  (isEurekaWorkshop || selection?.selectedGroupKey) &&
                  !workshopLockedOut &&
                  !cell.circled &&
                  (
                    isEurekaWorkshop ||
                    cell.kind === "wild" ||
                    (cell.kind === "number" && allowedWorkshopValues.includes(Number(cell.value)))
                  );
                const canWrenchPick =
                  editable &&
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
                const readOnly = !editable;
                const isDisabled = isBuildPhase
                  ? (!canBuildSelect && !inCommittedMechanism)
                  : (!cell.circled && !canMatchActive && !canWrenchPick) || readOnly;
                const shouldVisuallyDim = isBuildPhase
                  ? (!canBuildSelect && !cell.circled && !onDraftPath && !inCommittedMechanism)
                  : (!cell.circled && !canMatchActive && !canWrenchPick && !inCommittedMechanism) || readOnly;
                return (
                  '<button type="button" class="workshop-cell' +
                  valueClass +
                  (onDraftPath ? " workshop-cell--path" : "") +
                  (inCommittedMechanism ? " workshop-cell--mechanism" : "") +
                  (editable && state.phase === "workshop" && (canMatchActive || canWrenchPick) ? " workshop-cell--clickable" : "") +
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
        const mechanismLines = renderWorkshopMechanismLines(state, player, workshop.id, viewPlayerId);
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

  function renderWorkshopMechanismLines(state, player, workshopId, viewPlayerIdInput) {
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
    const viewPlayerId = String(viewPlayerIdInput || activePlayerId || "");
    const draft = state.buildDrafts?.[viewPlayerId];
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
        const x1 = a.col * 20 + 10;
        const y1 = a.row * 20 + 10;
        const x2 = b.col * 20 + 10;
        const y2 = b.row * 20 + 10;
        return (
          '<line class="' +
          className +
          '" x1="' +
          String(x1) +
          '%" y1="' +
          String(y1) +
          '%" x2="' +
          String(x2) +
          '%" y2="' +
          String(y2) +
          '%" vector-effect="non-scaling-stroke"></line>'
        );
      })
      .join("");
    return '<svg preserveAspectRatio="none">' + lineHtml + "</svg>";
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

  function renderJournals(stateInput, player, viewInput) {
    const state = stateInput && typeof stateInput === "object" ? stateInput : {};
    const view = viewInput && typeof viewInput === "object" ? viewInput : {};
    const viewPlayerId = String(view.playerId || activePlayerId || "");
    const editable = Boolean(view.editable);
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
      const playerSelection = state.journalSelections?.[viewPlayerId];
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
                editable && playerSelection?.selectedGroupKey && !isJournalLockedOut
                  ? " journal-cell--clickable"
                  : "";
              const shouldValidate =
                editable &&
                playerSelection?.selectedGroupKey &&
                hasActiveNumber &&
                !isJournalLockedOut;
              const validation = shouldValidate
                ? roundEngineService.validateJournalPlacement(journal, rowIndex, columnIndex, activeNumber)
                : { ok: true };
              const isDisabled =
                !editable ||
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

  function renderInventions(stateInput, player, viewInput) {
    const state = stateInput && typeof stateInput === "object" ? stateInput : {};
    const view = viewInput && typeof viewInput === "object" ? viewInput : {};
    const viewPlayerId = String(view.playerId || activePlayerId || "");
    const editable = Boolean(view.editable);
    const container = document.getElementById("inventions-container");
    if (!container) {
      return;
    }
    if (!player) {
      container.innerHTML = "<p>No player found.</p>";
      return;
    }
    const inventions = getPlayerInventionsForRender(player);
    const pendingMechanism = editable && state.phase === "invent" &&
      typeof roundEngineService.getPendingMechanismForInvent === "function"
      ? roundEngineService.getPendingMechanismForInvent(viewPlayerId)
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
          editable &&
          state.phase === "invent" &&
          pendingMechanism &&
          inventionHover &&
          inventionHover.inventionId === invention.id &&
          typeof roundEngineService.computeInventionPlacementPreview === "function"
            ? roundEngineService.computeInventionPlacementPreview(
                viewPlayerId,
                invention.id,
                inventionHover.row,
                inventionHover.col,
              )
            : null;
        const pattern = renderInventionPattern(invention.pattern, {
          inventionId: invention.id,
          preview,
          interactive: editable && state.phase === "invent" && Boolean(pendingMechanism),
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
    if (isInteractionBlocked()) {
      return;
    }
    logPlayerAction("Advanced phase", { action: "advance-phase" });
    runWithUndo(() => {
      advancePhaseForCurrentMode();
    });
    renderState();
  });

  const homeModeFlow = typeof root.createHomeModeFlow === "function"
    ? root.createHomeModeFlow({
        documentRef: typeof document !== "undefined" ? document : null,
        globalRef: globalScope,
        multiplayerState,
        multiplayerClient,
        ensureMultiplayerConnection,
        clearMultiplayerSessionIdentity,
        resetMultiplayerForHomeAction,
        gameStateService,
        persistMultiplayerState,
        renderMultiplayerUi,
        refreshRoomDirectory,
        refreshPlayerHub,
        resetLocalMultiplayerMemory,
        setHomeStep,
        getDefaultPlayerName,
        canAccessMultiplayer: canAccessMultiplayerFeature,
        getMultiplayerAccessError,
        getVariableSetupSelection,
        setVariableSetupSelection,
        persistHomeUiState,
      })
    : null;
  if (homeModeFlow && typeof homeModeFlow.bindHomeControls === "function") {
    homeModeFlow.bindHomeControls();
  }
  bindAuthControls();

  const hubRoomList = document.getElementById("mp-hub-room-list");
  if (hubRoomList) {
    hubRoomList.addEventListener("click", function onHubRoomListClick(event) {
      const target = event.target;
      if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
        return;
      }
      const roomLink = target.closest("[data-action='hub-select-room']");
      if (!roomLink) {
        return;
      }
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      const roomCode = String(roomLink.getAttribute("data-room-code") || "").trim().toUpperCase();
      if (!roomCode) {
        return;
      }
      selectHubRoom(roomCode);
    });
  }

  const homeRoomOpenButton = document.getElementById("home-room-open");
  if (homeRoomOpenButton) {
    homeRoomOpenButton.addEventListener("click", async function onHomeRoomOpenClick() {
      await runSelectedHubPrimaryAction();
    });
  }

  const homeRoomAbandonButton = document.getElementById("home-room-abandon");
  if (homeRoomAbandonButton) {
    homeRoomAbandonButton.addEventListener("click", async function onHomeRoomAbandonClick() {
      await abandonSelectedHubRoom();
    });
  }

  const hubRoomPlayerTableBody = document.getElementById("mp-hub-room-player-table-body");
  if (hubRoomPlayerTableBody) {
    hubRoomPlayerTableBody.addEventListener("click", async function onHubRoomKickClick(event) {
      const target = event.target;
      if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
        return;
      }
      const button = target.closest("button[data-action='hub-kick-player']");
      if (!button) {
        return;
      }
      if (!isLocalPlayerHost()) {
        return;
      }
      const currentRoomCode = normalizeRoomCode(multiplayerState.room?.code || multiplayerState.roomCode);
      const selectedCode = normalizeRoomCode(hubSelectedRoomCode);
      if (!currentRoomCode || currentRoomCode !== selectedCode) {
        return;
      }
      const playerId = String(button.getAttribute("data-player-id") || "").trim();
      if (!playerId) {
        return;
      }
      const playerLabel = resolvePlayerName(playerId, { preferYou: false }) || playerId;
      const confirmed = typeof globalScope.confirm === "function"
        ? globalScope.confirm("Kick " + playerLabel + " from room?")
        : true;
      if (!confirmed) {
        return;
      }
      await sendMultiplayerCommand("kick_player", { playerId }, {
        errorMessage: "Could not kick player. Check connection.",
      });
    });
  }

  const backToLobbyButton = document.getElementById("back-to-lobby");
  if (backToLobbyButton) {
    backToLobbyButton.addEventListener("click", function onBackToLobby() {
      if (!hasJoinedMultiplayerRoom()) {
        return;
      }
      gameSurfaceRoomCode = "";
      forceHomeSurface = true;
      setHomeStep("room-list");
      renderState();
    });
  }

  document.getElementById("reset-game").addEventListener("click", async function onResetGame() {
    if (hasActiveMultiplayerRoom()) {
      if (isLocalPlayerHost()) {
        const confirmedHost = typeof globalScope.confirm === "function"
          ? globalScope.confirm("Terminate this multiplayer room for all players?")
          : true;
        if (!confirmedHost) {
          return;
        }
        await sendMultiplayerCommand("terminate_room", {}, {
          errorMessage: "Could not abandon room. Check connection.",
        });
        return;
      }
      const confirmedLeave = typeof globalScope.confirm === "function"
        ? globalScope.confirm("Leave this multiplayer room?")
        : true;
      if (!confirmedLeave) {
        return;
      }
      const sent = await sendMultiplayerCommand("leave_room", {}, {
        errorMessage: "Could not leave room. Check connection.",
      });
      if (sent) {
        teardownMultiplayerSession("Left multiplayer room");
      }
      return;
    }
    const confirmed = typeof globalScope.confirm === "function"
      ? globalScope.confirm("Abandon the current game and return to New Game? This cannot be undone.")
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
    if (isInteractionBlocked()) {
      return;
    }
    if (undoStack.length === 0) {
      return;
    }
    logPlayerAction("Undid previous action", { action: "undo" });
    cancelOnlineEndTurnIfNeeded();
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
    const actionTarget = target.closest("[data-action]");
    if (!actionTarget) {
      return;
    }

    const action = actionTarget.getAttribute("data-action");
    if (action === "mp-start-lobby") {
      logPlayerAction("Started room game", { action });
      multiplayerClient.send("start_game");
      return;
    }
    if (action === "mp-cancel-room") {
      const confirmedCancel = typeof globalScope.confirm === "function"
        ? globalScope.confirm("Cancel this room for all players?")
        : true;
      if (!confirmedCancel) {
        return;
      }
      logPlayerAction("Canceled multiplayer room", { action });
      multiplayerClient.send("terminate_room");
      return;
    }
    if (action === "mp-leave-lobby") {
      const confirmedLeave = typeof globalScope.confirm === "function"
        ? globalScope.confirm("Leave this multiplayer room?")
        : true;
      if (!confirmedLeave) {
        return;
      }
      logPlayerAction("Left multiplayer lobby", { action });
      multiplayerClient.send("leave_room");
      teardownMultiplayerSession("Left multiplayer room");
      return;
    }
    if (isInteractionBlocked() && action !== "confirm-tool-unlock") {
      return;
    }
    if (maybeBlockActionForUnlockPrompt(action)) {
      return;
    }
    if (action) {
      logPlayerAction("Performed action: " + String(action), { action });
    }

    if (action === "select-group") {
      runWithUndo(() => {
        roundEngineService.selectJournalingGroup(activePlayerId, actionTarget.getAttribute("data-group-key"));
      });
      renderState();
      return;
    }

    if (action === "workshop-select-group") {
      runWithUndo(() => {
        roundEngineService.selectWorkshoppingGroup(activePlayerId, actionTarget.getAttribute("data-group-key"));
      });
      renderState();
      return;
    }

    if (action === "workshop-select-number") {
      runWithUndo(() => {
        roundEngineService.selectActiveWorkshopNumber(
          activePlayerId,
          Number(actionTarget.getAttribute("data-number")),
          Number(actionTarget.getAttribute("data-consume-number")),
          String(actionTarget.getAttribute("data-adjusted") || "false"),
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
          String(actionTarget.getAttribute("data-journal-id") || ""),
          String(actionTarget.getAttribute("data-invention-id") || ""),
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

    if (action === "round-end-turn") {
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
          Number(actionTarget.getAttribute("data-number")),
          Number(actionTarget.getAttribute("data-consume-number")),
          String(actionTarget.getAttribute("data-adjusted") || "false"),
        );
      });
      renderState();
    }
  });

  SECTION_VIEW_KEYS.forEach((sectionKey) => {
    const tabsNode = document.getElementById(sectionKey + "-player-tabs");
    if (!tabsNode) {
      return;
    }
    tabsNode.addEventListener("click", function onSectionPlayerTabClick(event) {
      const target = event.target;
      if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
        return;
      }
      const button = target.closest("button[data-action='section-view-player']");
      if (!button) {
        return;
      }
      const nextSection = String(button.getAttribute("data-section") || "").trim();
      const nextPlayerId = String(button.getAttribute("data-player-id") || "").trim();
      if (!SECTION_VIEW_KEYS.includes(nextSection) || !nextPlayerId) {
        return;
      }
      SECTION_VIEW_KEYS.forEach((key) => {
        sectionPlayerViews[key] = nextPlayerId;
      });
      sectionViewTransitionPending = true;
      inventionHover = null;
      inventionVarietyHover = null;
      renderState();
    });
  });

  document.getElementById("journals-container").addEventListener("click", function onJournalClick(event) {
    if (isInteractionBlocked()) {
      return;
    }
    const state = roundEngineService.getState();
    if (!isSectionViewingActivePlayer(state, "journals")) {
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
    logPlayerAction("Placed journal number", {
      action: "journal-place-number",
      journalId,
      rowIndex,
      columnIndex,
    });
    runWithUndo(() => {
      roundEngineService.placeJournalNumber(activePlayerId, rowIndex, columnIndex, journalId);
      maybeAutoAdvanceAfterJournalProgress();
    });
    renderState();
  });

  document.getElementById("workshops-container").addEventListener("click", function onWorkshopClick(event) {
    if (isInteractionBlocked()) {
      return;
    }
    const state = roundEngineService.getState();
    if (!isSectionViewingActivePlayer(state, "workshops")) {
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
    logPlayerAction("Selected workshop cell", {
      action: state.phase === "build" ? "build-select-cell" : "workshop-place-part",
      workshopId,
      rowIndex,
      columnIndex,
      phase: state.phase,
    });
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
    const currentState = roundEngineService.getState();
    const workshopView = getSectionView(currentState, "workshops");
    if (!workshopView.player) {
      hideWorkshopTooltip();
      return;
    }
    renderMechanismUsageTooltip(workshopView.state, workshopView.player, mechanismId, button);
  });

  document.getElementById("workshops-container").addEventListener("mouseleave", function onWorkshopLeave() {
    hideWorkshopTooltip();
  });

  document.getElementById("inventions-container").addEventListener("mousemove", function onInventionHover(event) {
    const target = event.target;
    if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
      return;
    }
    const currentState = roundEngineService.getState();
    const inventionsView = getSectionView(currentState, "inventions");
    if (!inventionsView.editable || inventionsView.state.phase !== "invent") {
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
        renderInventions(inventionsView.state, inventionsView.player, inventionsView);
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
    renderInventions(inventionsView.state, inventionsView.player, inventionsView);
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
    const currentState = roundEngineService.getState();
    const inventionsView = getSectionView(currentState, "inventions");
    renderInventions(inventionsView.state, inventionsView.player, inventionsView);
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
    const currentState = roundEngineService.getState();
    const inventionsView = getSectionView(currentState, "inventions");
    renderInventions(inventionsView.state, inventionsView.player, inventionsView);
  });

  document.getElementById("inventions-container").addEventListener("mouseleave", function onInventionLeave() {
    if (!inventionHover) {
      if (!inventionVarietyHover) {
        return;
      }
    }
    inventionHover = null;
    inventionVarietyHover = null;
    const currentState = roundEngineService.getState();
    const inventionsView = getSectionView(currentState, "inventions");
    renderInventions(inventionsView.state, inventionsView.player, inventionsView);
  });

  document.getElementById("inventions-container").addEventListener("click", function onInventionClick(event) {
    if (isInteractionBlocked()) {
      return;
    }
    const state = roundEngineService.getState();
    if (!isSectionViewingActivePlayer(state, "inventions")) {
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
        logPlayerAction("Placed mechanism in invention", {
          action: "invent-place-mechanism",
          inventionId,
          rowIndex,
          columnIndex,
        });
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

  initializeSupabaseAuth().catch(() => {});
  renderMultiplayerUi();
  refreshRoomDirectory(true);
  if (multiplayerState.roomCode && multiplayerState.reconnectToken) {
    ensureMultiplayerConnection().then(() => {
      if (!multiplayerState.connected) {
        return;
      }
      multiplayerClient.send("join_room", {
        roomCode: multiplayerState.roomCode,
        reconnectToken: multiplayerState.reconnectToken,
        profileToken: multiplayerState.profileToken || "",
      });
    });
  }
  document.addEventListener("keydown", function onHudKeydown(event) {
    if (String(event && event.key || "") !== "Tab") {
      return;
    }
    event.preventDefault();
    showGameHud();
  });

  document.addEventListener("keyup", function onHudKeyup(event) {
    if (String(event && event.key || "") !== "Tab") {
      return;
    }
    hideGameHud();
  });

  window.addEventListener("blur", hideGameHud);

  document.addEventListener("visibilitychange", function onHudVisibilityChange() {
    if (document.hidden) {
      hideGameHud();
    }
  });

  renderState();
})(typeof window !== "undefined" ? window : globalThis);

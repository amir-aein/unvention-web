(function attachLogSidebar(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  function createLogSidebar(loggerService) {
    const logList = document.getElementById("log-list");
    const clearLogButton = document.getElementById("clear-log");
    const playerFilterTabs = document.getElementById("log-player-filter-tabs");
    let selectedPlayer = "all";

    function formatTime(date) {
      return date.toLocaleString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }

    function render(entries) {
      syncPlayerOptions(entries);
      const visibleEntries = entries.filter((entry) => {
        if (selectedPlayer === "all") {
          return true;
        }
        return resolveActor(entry.context) === selectedPlayer;
      });

      logList.innerHTML = "";

      if (visibleEntries.length === 0) {
        const emptyItem = document.createElement("li");
        emptyItem.className = "log-item";
        emptyItem.textContent = "No log entries for selected filters.";
        logList.appendChild(emptyItem);
      } else {
        visibleEntries.forEach((entry) => {
          const item = document.createElement("li");
          item.className = "log-item log-item--" + entry.level;

          const meta = document.createElement("div");
          meta.className = "log-item__meta";

          const time = document.createElement("span");
          time.className = "log-item__time";
          time.textContent = formatTime(entry.timestamp) + " -- ";

          const actor = document.createElement("span");
          actor.className = "log-item__actor";
          actor.textContent = resolveActor(entry.context);

          meta.appendChild(time);
          meta.appendChild(actor);

          const message = document.createElement("div");
          message.className = "log-item__message";
          message.textContent = normalizeMessage(entry.message, entry.context);

          item.appendChild(meta);
          item.appendChild(message);
          logList.appendChild(item);
        });
      }

      // Strict behavior: newest entry remains visible at the bottom.
      logList.scrollTop = logList.scrollHeight;
    }

    const unsubscribe = loggerService.subscribe(render);

    if (playerFilterTabs) {
      playerFilterTabs.addEventListener("click", (event) => {
        const target = event.target;
        if (typeof globalScope.HTMLElement !== "undefined" && !(target instanceof globalScope.HTMLElement)) {
          return;
        }
        const tab = target.closest("button[data-player-filter]");
        if (!tab) {
          return;
        }
        const next = String(tab.getAttribute("data-player-filter") || "all");
        if (!next || next === selectedPlayer) {
          return;
        }
        selectedPlayer = next;
        render(loggerService.getEntries());
      });
    }

    clearLogButton.addEventListener("click", () => {
      loggerService.clear();
      loggerService.logEvent("info", "Log cleared by player", { source: "ui" });
    });

    return {
      destroy() {
        unsubscribe();
      },
    };

    function syncPlayerOptions(entries) {
      if (!playerFilterTabs) {
        return;
      }
      const actors = Array.from(
        new Set(
          (entries || [])
            .map((entry) => resolveActor(entry.context))
            .filter((actor) => actor && actor !== "System"),
        ),
      ).sort((a, b) => a.localeCompare(b));
      const nextValues = ["all"].concat(actors);
      const existingValues = Array.from(playerFilterTabs.querySelectorAll("button[data-player-filter]"))
        .map((button) => String(button.getAttribute("data-player-filter") || ""));
      if (
        existingValues.length === nextValues.length &&
        existingValues.every((value, index) => value === nextValues[index])
      ) {
        updateActiveTab();
        return;
      }
      playerFilterTabs.innerHTML = nextValues
        .map((value) => (
          '<button type="button" class="log-player-tab' +
          (value === selectedPlayer ? " log-player-tab--active" : "") +
          '" data-player-filter="' +
          value +
          '">' +
          (value === "all" ? "All" : value) +
          "</button>"
        ))
        .join("");
      if (!nextValues.includes(selectedPlayer)) {
        selectedPlayer = "all";
      }
      updateActiveTab();
    }

    function updateActiveTab() {
      if (!playerFilterTabs) {
        return;
      }
      Array.from(playerFilterTabs.querySelectorAll("button[data-player-filter]")).forEach((button) => {
        const value = String(button.getAttribute("data-player-filter") || "");
        button.classList.toggle("log-player-tab--active", value === selectedPlayer);
      });
    }
  }

  function resolveActor(context) {
    const playerName = String(context?.playerName || "").trim();
    if (playerName) {
      return playerName;
    }
    const playerId = String(context?.playerId || "").trim();
    if (!playerId) {
      return "System";
    }
    return playerId;
  }

  function normalizeMessage(message, context) {
    const text = String(message || "");
    const actor = resolveActor(context);
    if (actor && actor !== "System") {
      return text.replace(/^Player X\b/, actor);
    }
    return text;
  }

  root.createLogSidebar = createLogSidebar;
})(typeof window !== "undefined" ? window : globalThis);

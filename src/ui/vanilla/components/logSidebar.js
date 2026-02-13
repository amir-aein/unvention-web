(function attachLogSidebar(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  function createLogSidebar(loggerService) {
    const logList = document.getElementById("log-list");
    const clearLogButton = document.getElementById("clear-log");
    const filterCheckboxes = document.querySelectorAll(".log-filters input");

    function getEnabledLevels() {
      return new Set(
        Array.from(filterCheckboxes)
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.value),
      );
    }

    function formatTime(date) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }

    function render(entries) {
      const enabledLevels = getEnabledLevels();
      const visibleEntries = entries.filter((entry) => enabledLevels.has(entry.level));

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

          const level = document.createElement("span");
          level.textContent = entry.level.toUpperCase();

          const time = document.createElement("span");
          time.textContent = formatTime(entry.timestamp);

          meta.appendChild(level);
          meta.appendChild(time);

          const message = document.createElement("div");
          message.className = "log-item__message";
          message.textContent = entry.message;

          item.appendChild(meta);
          item.appendChild(message);
          logList.appendChild(item);
        });
      }

      // Strict behavior: newest entry remains visible at the bottom.
      logList.scrollTop = logList.scrollHeight;
    }

    const unsubscribe = loggerService.subscribe(render);

    filterCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", () => render(loggerService.getEntries()));
    });

    clearLogButton.addEventListener("click", () => {
      loggerService.clear();
      loggerService.logEvent("info", "Log cleared by player", { source: "ui" });
    });

    return {
      destroy() {
        unsubscribe();
      },
    };
  }

  root.createLogSidebar = createLogSidebar;
})(typeof window !== "undefined" ? window : globalThis);

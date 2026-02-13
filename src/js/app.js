const logger = new window.Logger();
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
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderLog(entries) {
  const enabledLevels = getEnabledLevels();
  const visibleEntries = entries.filter((entry) => enabledLevels.has(entry.level));

  logList.innerHTML = "";

  if (visibleEntries.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "log-item";
    emptyItem.textContent = "No log entries for selected filters.";
    logList.appendChild(emptyItem);
    return;
  }

  visibleEntries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = `log-item log-item--${entry.level}`;

    const meta = document.createElement("div");
    meta.className = "log-item__meta";
    meta.innerHTML = `<span>${entry.level.toUpperCase()}</span><span>${formatTime(entry.timestamp)}</span>`;

    const message = document.createElement("div");
    message.className = "log-item__message";
    message.textContent = entry.message;

    item.appendChild(meta);
    item.appendChild(message);
    logList.appendChild(item);
  });

  logList.scrollTop = logList.scrollHeight;
}

logger.subscribe(renderLog);

filterCheckboxes.forEach((checkbox) => {
  checkbox.addEventListener("change", () => renderLog(logger.entries));
});

clearLogButton.addEventListener("click", () => {
  logger.clear();
  logger.logEvent("info", "Log cleared by player", { source: "ui" });
});

document.getElementById("demo-info").addEventListener("click", () => {
  logger.logEvent("info", "Player explored a safe action", { playerId: "P1", phase: "setup" });
});

document.getElementById("demo-warn").addEventListener("click", () => {
  logger.logEvent("warn", "Player tried an out-of-order action", { playerId: "P1", phase: "turn" });
});

document.getElementById("demo-error").addEventListener("click", () => {
  logger.logEvent("error", "Action failed validation", { playerId: "P1", phase: "resolution" });
});

logger.logEvent("info", "Logging system initialized", { source: "system" });
logger.logEvent("debug", "Ready for game function integration", { source: "system" });

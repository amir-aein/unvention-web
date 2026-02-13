(function attachLoggerService(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  class LoggerService {
    constructor(loggerPort) {
      this.loggerPort = loggerPort;
    }

    logEvent(level, message, context) {
      const safeLevel = this.normalizeLevel(level);
      return this.loggerPort.append({
        level: safeLevel,
        message,
        context: context || {},
        timestamp: new Date(),
      });
    }

    clear() {
      this.loggerPort.clear();
    }

    getEntries() {
      return this.loggerPort.getEntries();
    }

    replaceEntries(entries) {
      const normalizedEntries = (entries || []).map((entry) => ({
        id: entry.id,
        level: this.normalizeLevel(entry.level),
        message: entry.message || "",
        context: entry.context || {},
        timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
      }));

      if (typeof this.loggerPort.replaceAll === "function") {
        this.loggerPort.replaceAll(normalizedEntries);
      } else {
        this.loggerPort.clear();
        normalizedEntries.forEach((entry) => {
          this.loggerPort.append(entry);
        });
      }
    }

    toSerializableEntries() {
      return this.getEntries().map((entry) => ({
        id: entry.id,
        level: entry.level,
        message: entry.message,
        context: entry.context || {},
        timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
      }));
    }

    subscribe(listener) {
      return this.loggerPort.subscribe(listener);
    }

    normalizeLevel(level) {
      const allowedLevels = root.LOG_LEVELS || ["info", "warn", "error", "debug"];
      return allowedLevels.includes(level) ? level : "info";
    }
  }

  root.LoggerService = LoggerService;
})(typeof window !== "undefined" ? window : globalThis);

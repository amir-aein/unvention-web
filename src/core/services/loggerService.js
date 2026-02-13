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

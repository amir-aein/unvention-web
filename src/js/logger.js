class Logger {
  constructor() {
    this.entries = [];
    this.listeners = [];
    this.nextId = 1;
  }

  logEvent(level, message, context = {}) {
    const normalizedLevel = this.normalizeLevel(level);
    const entry = {
      id: this.nextId++,
      level: normalizedLevel,
      message,
      context,
      timestamp: new Date(),
    };

    this.entries.push(entry);
    this.emit();
    return entry;
  }

  clear() {
    this.entries = [];
    this.emit();
  }

  subscribe(listener) {
    this.listeners.push(listener);
    listener(this.entries);

    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  emit() {
    this.listeners.forEach((listener) => listener(this.entries));
  }

  normalizeLevel(level) {
    const allowed = new Set(["info", "warn", "error", "debug"]);
    return allowed.has(level) ? level : "info";
  }
}

window.Logger = Logger;

(function attachInMemoryLogger(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  class InMemoryLogger {
    constructor() {
      this.entries = [];
      this.listeners = [];
      this.nextId = 1;
    }

    append(entryInput) {
      const entry = {
        id: this.nextId++,
        level: entryInput.level,
        message: entryInput.message,
        context: entryInput.context || {},
        timestamp: entryInput.timestamp || new Date(),
      };

      this.entries.push(entry);
      this.emit();
      return entry;
    }

    clear() {
      this.entries = [];
      this.emit();
    }

    replaceAll(entries) {
      this.entries = entries.map((entry, index) => ({
        id: entry.id || index + 1,
        level: entry.level,
        message: entry.message,
        context: entry.context || {},
        timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
      }));
      this.nextId = this.entries.length + 1;
      this.emit();
    }

    getEntries() {
      return [...this.entries];
    }

    subscribe(listener) {
      this.listeners.push(listener);
      listener(this.getEntries());

      return () => {
        this.listeners = this.listeners.filter((item) => item !== listener);
      };
    }

    emit() {
      const snapshot = this.getEntries();
      this.listeners.forEach((listener) => listener(snapshot));
    }
  }

  root.InMemoryLogger = InMemoryLogger;
})(typeof window !== "undefined" ? window : globalThis);

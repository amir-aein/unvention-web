(function attachLocalStorageStateStore(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  class LocalStorageStateStore {
    constructor(storage, storageKey) {
      this.storage = storage;
      this.storageKey = storageKey || "unvention.appState.v1";
    }

    loadState() {
      if (!this.storage || typeof this.storage.getItem !== "function") {
        return null;
      }

      try {
        const raw = this.storage.getItem(this.storageKey);
        if (!raw) {
          return null;
        }

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch (_error) {
        return null;
      }
    }

    saveState(state) {
      if (!this.storage || typeof this.storage.setItem !== "function") {
        return;
      }

      try {
        const serialized = JSON.stringify(state);
        this.storage.setItem(this.storageKey, serialized);
      } catch (_error) {
        // Ignore storage errors (quota or unavailable storage).
      }
    }

    clearState() {
      if (!this.storage || typeof this.storage.removeItem !== "function") {
        return;
      }

      try {
        this.storage.removeItem(this.storageKey);
      } catch (_error) {
        // Ignore storage errors.
      }
    }
  }

  root.LocalStorageStateStore = LocalStorageStateStore;
})(typeof window !== "undefined" ? window : globalThis);

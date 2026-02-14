(function attachMultiplayerClient(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  class MultiplayerClient {
    constructor() {
      this.socket = null;
      this.url = "";
      this.messageListeners = [];
      this.openListeners = [];
      this.closeListeners = [];
      this.errorListeners = [];
    }

    connect(urlInput) {
      const url = String(urlInput || "").trim();
      if (!url) {
        return Promise.reject(new Error("Server URL is required."));
      }
      this.url = url;
      if (this.socket && this.socket.readyState === 1) {
        return Promise.resolve();
      }
      if (this.socket && this.socket.readyState === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const socket = new globalScope.WebSocket(url);
        this.socket = socket;

        socket.addEventListener("open", () => {
          settled = true;
          this.openListeners.forEach((listener) => listener());
          resolve();
        });

        socket.addEventListener("message", (event) => {
          let data = null;
          try {
            data = JSON.parse(String(event.data || ""));
          } catch (_error) {
            return;
          }
          this.messageListeners.forEach((listener) => listener(data));
        });

        socket.addEventListener("close", (event) => {
          this.closeListeners.forEach((listener) => listener(event));
        });

        socket.addEventListener("error", (error) => {
          this.errorListeners.forEach((listener) => listener(error));
          if (!settled) {
            settled = true;
            reject(new Error("Unable to connect to multiplayer server."));
          }
        });
      });
    }

    disconnect() {
      if (!this.socket) {
        return;
      }
      this.socket.close();
      this.socket = null;
    }

    send(type, payload) {
      if (!this.socket || this.socket.readyState !== 1) {
        return false;
      }
      this.socket.send(
        JSON.stringify({
          type,
          ...(payload || {}),
        }),
      );
      return true;
    }

    onMessage(listener) {
      this.messageListeners.push(listener);
      return () => {
        this.messageListeners = this.messageListeners.filter((item) => item !== listener);
      };
    }

    onOpen(listener) {
      this.openListeners.push(listener);
      return () => {
        this.openListeners = this.openListeners.filter((item) => item !== listener);
      };
    }

    onClose(listener) {
      this.closeListeners.push(listener);
      return () => {
        this.closeListeners = this.closeListeners.filter((item) => item !== listener);
      };
    }

    onError(listener) {
      this.errorListeners.push(listener);
      return () => {
        this.errorListeners = this.errorListeners.filter((item) => item !== listener);
      };
    }
  }

  root.MultiplayerClient = MultiplayerClient;
})(typeof window !== "undefined" ? window : globalThis);

(function attachMultiplayerClient(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  class MultiplayerClient {
    constructor() {
      this.socket = null;
      this.connectPromise = null;
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
        if (this.connectPromise) {
          return this.connectPromise;
        }
        this.connectPromise = this.createConnectPromiseForSocket(this.socket);
        return this.connectPromise;
      }
      const socket = new globalScope.WebSocket(url);
      this.socket = socket;
      this.connectPromise = this.createConnectPromiseForSocket(socket);
      return this.connectPromise;
    }

    createConnectPromiseForSocket(socket) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const settleResolve = () => {
          if (settled) {
            return;
          }
          settled = true;
          if (this.connectPromise) {
            this.connectPromise = null;
          }
          resolve();
        };
        const settleReject = (message) => {
          if (settled) {
            return;
          }
          settled = true;
          if (this.connectPromise) {
            this.connectPromise = null;
          }
          reject(new Error(String(message || "Unable to connect to multiplayer server.")));
        };

        socket.addEventListener("open", () => {
          if (this.socket !== socket) {
            return;
          }
          this.openListeners.forEach((listener) => listener());
          settleResolve();
        });

        socket.addEventListener("message", (event) => {
          if (this.socket !== socket) {
            return;
          }
          let data = null;
          try {
            data = JSON.parse(String(event.data || ""));
          } catch (_error) {
            return;
          }
          this.messageListeners.forEach((listener) => listener(data));
        });

        socket.addEventListener("close", (event) => {
          const isActiveSocket = this.socket === socket;
          if (!isActiveSocket) {
            return;
          }
          this.socket = null;
          this.connectPromise = null;
          this.closeListeners.forEach((listener) => listener(event));
          settleReject("Unable to connect to multiplayer server.");
        });

        socket.addEventListener("error", (error) => {
          if (this.socket !== socket) {
            return;
          }
          this.errorListeners.forEach((listener) => listener(error));
          settleReject("Unable to connect to multiplayer server.");
        });
      });
    }

    disconnect() {
      if (!this.socket) {
        return;
      }
      const socket = this.socket;
      this.socket = null;
      this.connectPromise = null;
      socket.close();
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

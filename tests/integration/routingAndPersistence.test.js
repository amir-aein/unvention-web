const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? Number(address.port) : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        resolve({
          statusCode: Number(response.statusCode || 0),
          headers: response.headers || {},
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", reject);
  });
}

function httpGetJson(url) {
  return httpGet(url).then((response) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error("HTTP " + String(response.statusCode) + " from " + url + ": " + response.body);
    }
    return JSON.parse(response.body || "{}");
  });
}

function httpPostJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const target = new URL(url);
    const request = http.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: Number(response.statusCode || 0),
            headers: response.headers || {},
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function waitForServerReady(baseHttpUrl, timeoutMs) {
  const deadline = Date.now() + Number(timeoutMs || 10000);
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const payload = await httpGetJson(baseHttpUrl + "/health");
      if (payload?.ok) {
        return;
      }
      lastError = new Error("health_not_ok");
    } catch (error) {
      lastError = error;
    }
    await wait(120);
  }
  throw lastError || new Error("Timed out waiting for server readiness");
}

function launchServer(port, outputDir, extraEnv) {
  const projectRoot = path.resolve(__dirname, "../..");
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      SERVER_OUTPUT_DIR: outputDir,
      ...(extraEnv || {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk || "");
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk || "");
  });
  return {
    child,
    getLogs() {
      return { stdout, stderr };
    },
  };
}

async function stopServer(server) {
  if (!server?.child || server.child.killed) {
    return;
  }
  server.child.kill("SIGTERM");
  await new Promise((resolve) => server.child.once("exit", () => resolve()));
}

function connectClient(serverUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(serverUrl);
    const buffer = [];
    const waiters = [];
    let opened = false;

    const dispatch = (message) => {
      for (let index = 0; index < waiters.length; index += 1) {
        const waiter = waiters[index];
        if (!waiter.matches(message)) {
          continue;
        }
        waiters.splice(index, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
        return;
      }
      buffer.push(message);
    };

    ws.on("message", (raw) => {
      try {
        dispatch(JSON.parse(String(raw || "")));
      } catch (_error) {}
    });

    ws.on("open", () => {
      opened = true;
      resolve({
        waitFor(type, validator, timeoutMs) {
          const expectedType = String(type || "");
          const validate = typeof validator === "function" ? validator : null;
          return new Promise((resolveWait, rejectWait) => {
            const matches = (message) => {
              if (String(message?.type || "") !== expectedType) {
                return false;
              }
              return validate ? Boolean(validate(message)) : true;
            };
            for (let index = 0; index < buffer.length; index += 1) {
              const message = buffer[index];
              if (!matches(message)) {
                continue;
              }
              buffer.splice(index, 1);
              resolveWait(message);
              return;
            }
            const waiter = {
              matches,
              resolve: resolveWait,
              timeout: setTimeout(() => {
                const pendingIndex = waiters.indexOf(waiter);
                if (pendingIndex >= 0) {
                  waiters.splice(pendingIndex, 1);
                }
                rejectWait(new Error("Timed out waiting for message type " + expectedType));
              }, Number(timeoutMs || 5000)),
            };
            waiters.push(waiter);
          });
        },
        send(type, payload) {
          ws.send(JSON.stringify({ type, ...(payload || {}) }));
        },
        async request(type, payload, expectedType, validator, timeoutMs) {
          this.send(type, payload);
          return this.waitFor(expectedType, validator, timeoutMs);
        },
        close() {
          return new Promise((resolveClose) => {
            if (ws.readyState === WebSocket.CLOSED) {
              resolveClose();
              return;
            }
            ws.once("close", () => resolveClose());
            ws.close();
          });
        },
      });
    });

    ws.on("error", (error) => {
      if (!opened) {
        reject(error);
      }
    });
  });
}

test("app routes fall back to the SPA shell", { timeout: 20000 }, async (t) => {
  const port = await getFreePort();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvention-routes-"));
  const baseHttpUrl = "http://127.0.0.1:" + String(port);
  const server = launchServer(port, outputDir);

  t.after(async () => {
    await stopServer(server);
  });

  await waitForServerReady(baseHttpUrl, 10000);

  const hubResponse = await httpGet(baseHttpUrl + "/hub");
  assert.equal(hubResponse.statusCode, 200);
  assert.match(hubResponse.body, /<html/i);

  const roomResponse = await httpGet(baseHttpUrl + "/rooms/ABC123/game");
  assert.equal(roomResponse.statusCode, 200);
  assert.match(roomResponse.body, /<html/i);
});

test("rooms persist across restart and reconnect with the saved token", { timeout: 40000 }, async (t) => {
  const port = await getFreePort();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvention-persist-"));
  const baseHttpUrl = "http://127.0.0.1:" + String(port);
  const wsUrl = "ws://127.0.0.1:" + String(port);
  let server = launchServer(port, outputDir);

  t.after(async () => {
    await stopServer(server);
  });

  await waitForServerReady(baseHttpUrl, 10000);

  const host = await connectClient(wsUrl);
  await host.waitFor("connected");
  const joined = await host.request("create_room", { name: "Host" }, "room_joined");
  const roomCode = String(joined.roomCode || "");
  const reconnectToken = String(joined.reconnectToken || "");
  const profileToken = String(joined.profileToken || "");
  assert.ok(roomCode);
  assert.ok(reconnectToken);
  assert.ok(profileToken);
  await host.waitFor("room_state", (message) => String(message?.room?.code || "") === roomCode);
  await host.close();
  await wait(120);

  await stopServer(server);
  server = launchServer(port, outputDir);
  await waitForServerReady(baseHttpUrl, 10000);

  const directory = await httpGetJson(baseHttpUrl + "/api/rooms");
  const persistedRoom = (Array.isArray(directory.roomList) ? directory.roomList : []).find(
    (room) => String(room?.code || "") === roomCode,
  );
  assert.ok(persistedRoom);

  const reconnectingHost = await connectClient(wsUrl);
  await reconnectingHost.waitFor("connected");
  const rejoined = await reconnectingHost.request(
    "join_room",
    { roomCode, reconnectToken, profileToken },
    "room_joined",
  );
  assert.equal(String(rejoined.roomCode || ""), roomCode);
  await reconnectingHost.waitFor("room_state", (message) => {
    return (
      String(message?.room?.code || "") === roomCode &&
      Array.isArray(message?.room?.players) &&
      message.room.players.some((player) => Boolean(player?.connected))
    );
  });
  await reconnectingHost.close();
});

test("profile payload exposes authoritative rooms array and version", { timeout: 30000 }, async (t) => {
  const port = await getFreePort();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvention-profile-"));
  const baseHttpUrl = "http://127.0.0.1:" + String(port);
  const wsUrl = "ws://127.0.0.1:" + String(port);
  const server = launchServer(port, outputDir);

  t.after(async () => {
    await stopServer(server);
  });

  await waitForServerReady(baseHttpUrl, 10000);

  const host = await connectClient(wsUrl);
  await host.waitFor("connected");
  const roomA = await host.request("create_room", { name: "Host" }, "room_joined");
  await host.waitFor("room_state", (message) => String(message?.room?.code || "") === String(roomA.roomCode || ""));
  await host.close();

  const secondHost = await connectClient(wsUrl);
  await secondHost.waitFor("connected");
  const secondRoom = await secondHost.request("create_room", { name: "Host 2" }, "room_joined");
  await secondHost.waitFor("room_state", (message) => String(message?.room?.code || "") === String(secondRoom.roomCode || ""));

  const profilePayload = await httpGetJson(
    baseHttpUrl +
      "/api/profile?profileToken=" +
      encodeURIComponent(String(roomA.profileToken || "")) +
      "&currentRoomCode=" +
      encodeURIComponent(String(roomA.roomCode || "")),
  );
  assert.ok(Array.isArray(profilePayload.rooms));
  assert.ok(profilePayload.directory);
  assert.ok(Array.isArray(profilePayload.directory.activeRooms));
  assert.ok(Array.isArray(profilePayload.directory.openRooms));
  assert.ok(Array.isArray(profilePayload.directory.archivedRooms));
  assert.ok(Number(profilePayload.version || 0) > 0);
  assert.deepEqual(
    profilePayload.rooms.map((room) => String(room?.roomCode || "")),
    [String(roomA.roomCode || "")],
  );
  assert.equal(Boolean(profilePayload.rooms[0]?.currentJoined), true);
  assert.ok(
    profilePayload.directory.openRooms.some(
      (room) => String(room?.roomCode || "") === String(roomA.roomCode || ""),
    ),
  );
  assert.deepEqual(
    profilePayload.directory.activeRooms.map((room) => String(room?.roomCode || "")),
    [],
  );

  await secondHost.close();
});

test("expired reconnect windows no longer delete the room", { timeout: 30000 }, async (t) => {
  const port = await getFreePort();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvention-expire-"));
  const baseHttpUrl = "http://127.0.0.1:" + String(port);
  const wsUrl = "ws://127.0.0.1:" + String(port);
  const server = launchServer(port, outputDir, {
    RECONNECT_WINDOW_MS: "150",
    SWEEP_INTERVAL_MS: "50",
  });

  t.after(async () => {
    await stopServer(server);
  });

  await waitForServerReady(baseHttpUrl, 10000);

  const host = await connectClient(wsUrl);
  await host.waitFor("connected");
  const joined = await host.request("create_room", { name: "Host" }, "room_joined");
  const roomCode = String(joined.roomCode || "");
  await host.waitFor("room_state", (message) => String(message?.room?.code || "") === roomCode);
  await host.close();

  await wait(500);

  const directory = await httpGetJson(baseHttpUrl + "/api/rooms");
  const persistedRoom = (Array.isArray(directory.roomList) ? directory.roomList : []).find(
    (room) => String(room?.code || "") === roomCode,
  );
  assert.ok(persistedRoom, "expected room to still be listed after reconnect expiry");
  assert.equal(Number(persistedRoom?.playerCount), 0);
});

test("profile can delete an archived room from its room history", { timeout: 30000 }, async (t) => {
  const port = await getFreePort();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvention-room-delete-"));
  const baseHttpUrl = "http://127.0.0.1:" + String(port);
  const wsUrl = "ws://127.0.0.1:" + String(port);
  const server = launchServer(port, outputDir);

  t.after(async () => {
    await stopServer(server);
  });

  await waitForServerReady(baseHttpUrl, 10000);

  const host = await connectClient(wsUrl);
  await host.waitFor("connected");
  const joined = await host.request("create_room", { name: "Host" }, "room_joined");
  const roomCode = String(joined.roomCode || "");
  const profileToken = String(joined.profileToken || "");
  await host.waitFor("room_state", (message) => String(message?.room?.code || "") === roomCode);
  host.send("terminate_room", {});
  await host.waitFor("room_terminated", (message) => String(message?.roomCode || "") === roomCode);
  await host.close();

  const beforeDelete = await httpGetJson(
    baseHttpUrl +
      "/api/profile?profileToken=" +
      encodeURIComponent(profileToken),
  );
  assert.ok(
    beforeDelete.directory.archivedRooms.some((room) => String(room?.roomCode || "") === roomCode),
  );

  const deleteResponse = await httpPostJson(
    baseHttpUrl +
      "/api/profile/rooms/" +
      encodeURIComponent(roomCode) +
      "/delete?profileToken=" +
      encodeURIComponent(profileToken),
    {},
  );
  assert.equal(deleteResponse.statusCode, 200);
  const deletePayload = JSON.parse(String(deleteResponse.body || "{}"));
  assert.equal(Boolean(deletePayload.deleted), true);

  const afterDelete = await httpGetJson(
    baseHttpUrl +
      "/api/profile?profileToken=" +
      encodeURIComponent(profileToken),
  );
  assert.equal(
    afterDelete.directory.archivedRooms.some((room) => String(room?.roomCode || "") === roomCode),
    false,
  );
});

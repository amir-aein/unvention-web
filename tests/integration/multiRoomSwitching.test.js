const test = require("node:test");
const assert = require("node:assert/strict");
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

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (Number(response.statusCode || 0) < 200 || Number(response.statusCode || 0) >= 300) {
          reject(new Error("HTTP " + String(response.statusCode || 0) + " from " + url + ": " + body));
          return;
        }
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function httpPostJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: "POST" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (Number(response.statusCode || 0) < 200 || Number(response.statusCode || 0) >= 300) {
          reject(new Error("HTTP " + String(response.statusCode || 0) + " from " + url + ": " + body));
          return;
        }
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
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
      lastError = new Error("Health check returned non-ok payload");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw lastError || new Error("Timed out waiting for server readiness");
}

function launchServer(port) {
  const projectRoot = path.resolve(__dirname, "../..");
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
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
      if (buffer.length > 300) {
        buffer.shift();
      }
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
          const timeout = Number(timeoutMs || 5000);
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
              }, timeout),
            };
            waiters.push(waiter);
          });
        },
        request(type, payload, expectedType, validator, timeoutMs) {
          ws.send(JSON.stringify({
            type,
            ...(payload || {}),
          }));
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

test("multiplayer supports switching/rejoining between two concurrent rooms", { timeout: 40000 }, async (t) => {
  const port = await getFreePort();
  const baseHttpUrl = "http://127.0.0.1:" + String(port);
  const wsUrl = "ws://127.0.0.1:" + String(port);
  const server = launchServer(port);
  const openClients = [];

  t.after(async () => {
    await Promise.all(openClients.map((client) => client.close().catch(() => {})));
    if (!server.child.killed) {
      server.child.kill("SIGTERM");
    }
  });

  server.child.on("exit", (code, signal) => {
    if (code === 0 || signal === "SIGTERM") {
      return;
    }
    const logs = server.getLogs();
    throw new Error(
      "Server exited unexpectedly (code=" +
        String(code) +
        ", signal=" +
        String(signal) +
        ").\nstdout:\n" +
        logs.stdout +
        "\nstderr:\n" +
        logs.stderr,
    );
  });

  await waitForServerReady(baseHttpUrl, 10000);

  const hostA = await connectClient(wsUrl);
  openClients.push(hostA);
  await hostA.waitFor("connected");
  const hostCreateA = await hostA.request("create_room", { name: "Host" }, "room_joined");
  const roomA = String(hostCreateA.roomCode || "");
  const hostProfileToken = String(hostCreateA.profileToken || "");
  const hostPlayerIdA = String(hostCreateA.playerId || "");
  assert.ok(roomA);
  assert.ok(hostProfileToken);
  await hostA.waitFor("room_state", (message) => {
    return String(message?.room?.code || "") === roomA && String(message?.room?.status || "") === "lobby";
  });

  const guestA = await connectClient(wsUrl);
  openClients.push(guestA);
  await guestA.waitFor("connected");
  const guestJoinA = await guestA.request("join_room", { roomCode: roomA, name: "Guest" }, "room_joined");
  const guestProfileToken = String(guestJoinA.profileToken || "");
  const guestPlayerIdA = String(guestJoinA.playerId || "");
  assert.ok(guestProfileToken);
  await guestA.waitFor("room_state", (message) => {
    return String(message?.room?.code || "") === roomA && Number(message?.room?.players?.length || 0) >= 2;
  });

  await hostA.close();
  await guestA.close();

  const hostB = await connectClient(wsUrl);
  openClients.push(hostB);
  await hostB.waitFor("connected");
  const hostCreateB = await hostB.request("create_room", {
    name: "Host",
    profileToken: hostProfileToken,
  }, "room_joined");
  const roomB = String(hostCreateB.roomCode || "");
  const hostPlayerIdB = String(hostCreateB.playerId || "");
  assert.ok(roomB);
  assert.notEqual(roomB, roomA);
  await hostB.waitFor("room_state", (message) => {
    return String(message?.room?.code || "") === roomB && String(message?.room?.status || "") === "lobby";
  });
  await hostB.close();

  const guestB = await connectClient(wsUrl);
  openClients.push(guestB);
  await guestB.waitFor("connected");
  await guestB.request("join_room", {
    roomCode: roomB,
    name: "Guest",
    profileToken: guestProfileToken,
  }, "room_joined");
  await guestB.waitFor("room_state", (message) => {
    return String(message?.room?.code || "") === roomB && Number(message?.room?.players?.length || 0) >= 2;
  });
  await guestB.close();

  const hostProfilePayload = await httpGetJson(
    baseHttpUrl + "/api/profile?profileToken=" + encodeURIComponent(hostProfileToken),
  );
  const hostActiveCodes = new Set((hostProfilePayload.activeRooms || []).map((row) => String(row?.roomCode || "")));
  assert.ok(hostActiveCodes.has(roomA));
  assert.ok(hostActiveCodes.has(roomB));

  const guestProfilePayload = await httpGetJson(
    baseHttpUrl + "/api/profile?profileToken=" + encodeURIComponent(guestProfileToken),
  );
  const guestActiveCodes = new Set((guestProfilePayload.activeRooms || []).map((row) => String(row?.roomCode || "")));
  assert.ok(guestActiveCodes.has(roomA));
  assert.ok(guestActiveCodes.has(roomB));

  const hostRejoinA = await connectClient(wsUrl);
  openClients.push(hostRejoinA);
  await hostRejoinA.waitFor("connected");
  const hostRejoinAJoined = await hostRejoinA.request("join_room", {
    roomCode: roomA,
    name: "Host",
    profileToken: hostProfileToken,
  }, "room_joined");
  assert.equal(String(hostRejoinAJoined.playerId || ""), hostPlayerIdA);
  await hostRejoinA.waitFor("room_state", (message) => {
    return String(message?.room?.code || "") === roomA && String(message?.room?.status || "") === "lobby";
  });
  await hostRejoinA.request("start_game", {}, "room_state", (message) => {
    return String(message?.room?.code || "") === roomA && String(message?.room?.status || "") === "in_game";
  });
  await hostRejoinA.close();

  const guestRejoinA = await connectClient(wsUrl);
  openClients.push(guestRejoinA);
  await guestRejoinA.waitFor("connected");
  const guestRejoinAJoined = await guestRejoinA.request("join_room", {
    roomCode: roomA,
    name: "Guest",
    profileToken: guestProfileToken,
  }, "room_joined");
  assert.equal(String(guestRejoinAJoined.playerId || ""), guestPlayerIdA);
  await guestRejoinA.waitFor("room_state", (message) => {
    return String(message?.room?.code || "") === roomA && String(message?.room?.status || "") === "in_game";
  });
  await guestRejoinA.close();

  const hostRejoinB = await connectClient(wsUrl);
  openClients.push(hostRejoinB);
  await hostRejoinB.waitFor("connected");
  const hostRejoinBJoined = await hostRejoinB.request("join_room", {
    roomCode: roomB,
    name: "Host",
    profileToken: hostProfileToken,
  }, "room_joined");
  assert.equal(String(hostRejoinBJoined.playerId || ""), hostPlayerIdB);
  await hostRejoinB.waitFor("room_state", (message) => {
    return String(message?.room?.code || "") === roomB && String(message?.room?.status || "") === "lobby";
  });
});

test("profile reset removes host-owned open rooms from directory", { timeout: 20000 }, async (t) => {
  const port = await getFreePort();
  const baseHttpUrl = "http://127.0.0.1:" + String(port);
  const wsUrl = "ws://127.0.0.1:" + String(port);
  const server = launchServer(port);
  const openClients = [];

  t.after(async () => {
    await Promise.all(openClients.map((client) => client.close().catch(() => {})));
    if (!server.child.killed) {
      server.child.kill("SIGTERM");
    }
  });

  await waitForServerReady(baseHttpUrl, 10000);
  const host = await connectClient(wsUrl);
  openClients.push(host);
  await host.waitFor("connected");
  const joined = await host.request("create_room", { name: "Host" }, "room_joined");
  const hostProfileToken = String(joined.profileToken || "");
  const roomCode = String(joined.roomCode || "");
  assert.ok(hostProfileToken);
  assert.ok(roomCode);
  await host.waitFor("room_state", (message) => String(message?.room?.code || "") === roomCode);

  const beforeReset = await httpGetJson(baseHttpUrl + "/api/rooms");
  assert.ok((beforeReset.roomList || []).some((row) => String(row?.code || "") === roomCode));

  const resetPayload = await httpPostJson(
    baseHttpUrl + "/api/profile/reset?profileToken=" + encodeURIComponent(hostProfileToken),
  );
  assert.equal(Boolean(resetPayload.ok), true);
  assert.equal(Number(resetPayload.terminatedRooms || 0) >= 1, true);

  const afterReset = await httpGetJson(baseHttpUrl + "/api/rooms");
  assert.equal((afterReset.roomList || []).some((row) => String(row?.code || "") === roomCode), false);
});

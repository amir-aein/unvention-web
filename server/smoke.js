const WebSocket = require("ws");

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:8080";
const CLIENT_COUNT = Number(process.env.CLIENT_COUNT || 3);

async function run() {
  const host = await connectClient("Host");
  const createResponse = await host.request("create_room", { name: "Host" }, "room_joined");
  const roomCode = createResponse.roomCode;
  if (!roomCode) {
    throw new Error("No room code returned by server.");
  }
  const clients = [host];

  for (let index = 1; index < CLIENT_COUNT; index += 1) {
    const name = "Guest" + String(index + 1);
    const client = await connectClient(name);
    await client.request("join_room", { roomCode, name }, "room_joined");
    clients.push(client);
  }

  await host.request("start_game", {}, "room_state", (msg) => msg?.room?.status === "in_game");

  for (let index = 0; index < clients.length; index += 1) {
    const client = clients[index];
    await client.request("end_turn", {
      turnSummary: {
        completedJournals: 0,
        totalScore: 0,
        payload: { smokeClient: index + 1 },
      },
    }, "room_state");
  }

  await Promise.all(clients.map((client) => client.close()));
  // eslint-disable-next-line no-console
  console.log("Smoke test passed for room", roomCode, "with", clients.length, "clients.");
}

function connectClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const pending = [];
    let settled = false;

    ws.on("open", () => {
      settled = true;
      resolve({
        name,
        request(type, payload, expectedType, validator) {
          return requestOverSocket(ws, pending, type, payload, expectedType, validator);
        },
        close() {
          return new Promise((done) => {
            ws.once("close", () => done());
            ws.close();
          });
        },
      });
    });

    ws.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    ws.on("message", (raw) => {
      let message = null;
      try {
        message = JSON.parse(String(raw || ""));
      } catch (_error) {
        return;
      }
      for (let index = 0; index < pending.length; index += 1) {
        const matcher = pending[index];
        if (!matcher.matches(message)) {
          continue;
        }
        pending.splice(index, 1);
        matcher.resolve(message);
        return;
      }
    });
  });
}

function requestOverSocket(ws, pending, type, payload, expectedType, validator) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = pending.indexOf(matcher);
      if (index >= 0) {
        pending.splice(index, 1);
      }
      reject(new Error("Timed out waiting for " + expectedType));
    }, 3000);

    const matcher = {
      matches(message) {
        if (message?.type !== expectedType) {
          return false;
        }
        if (typeof validator === "function") {
          return Boolean(validator(message));
        }
        return true;
      },
      resolve(message) {
        clearTimeout(timeout);
        resolve(message);
      },
    };
    pending.push(matcher);

    ws.send(
      JSON.stringify({
        type,
        ...(payload || {}),
      }),
    );
  });
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Smoke test failed:", error?.message || error);
  process.exit(1);
});

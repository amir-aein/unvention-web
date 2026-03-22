"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createRoomRepository(configInput) {
  const config = configInput && typeof configInput === "object" ? configInput : {};
  const filePath = path.resolve(String(config.filePath || ""));
  const urlBase = String(config.supabaseUrl || "").trim().replace(/\/$/, "");
  const secretKey = String(config.supabaseSecretKey || "").trim();
  const fetchImpl = typeof config.fetch === "function" ? config.fetch : null;
  const supabaseEnabled = Boolean(urlBase && secretKey && fetchImpl);
  const activeRoomsByCode = new Map();
  const archivesByCode = new Map();
  let lastError = "";
  let lastSyncedAt = 0;

  ensureParentDir(filePath);
  loadFromDisk();

  function ensureParentDir(targetPath) {
    const parentDir = path.dirname(String(targetPath || ""));
    if (!parentDir) {
      return;
    }
    fs.mkdirSync(parentDir, { recursive: true });
  }

  function loadFromDisk() {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
      const archives = Array.isArray(parsed?.archives) ? parsed.archives : [];
      rooms.forEach((room) => {
        const code = String(room?.code || "").trim().toUpperCase();
        if (!code) {
          return;
        }
        activeRoomsByCode.set(code, JSON.parse(JSON.stringify(room)));
      });
      archives.forEach((archive) => {
        const code = String(archive?.code || "").trim().toUpperCase();
        if (!code) {
          return;
        }
        archivesByCode.set(code, JSON.parse(JSON.stringify(archive)));
      });
    } catch (error) {
      lastError = String(error?.message || error || "room_repository_load_failed");
    }
  }

  function writeSnapshot() {
    if (!filePath) {
      return;
    }
    const payload = {
      version: 1,
      generatedAt: Date.now(),
      rooms: Array.from(activeRoomsByCode.values()),
      archives: Array.from(archivesByCode.values()),
    };
    try {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
      lastError = "";
    } catch (error) {
      lastError = String(error?.message || error || "room_repository_write_failed");
    }
  }

  async function postRows(tableName, conflictColumn, rows) {
    if (!supabaseEnabled || !rows.length) {
      return;
    }
    const endpoint =
      urlBase +
      "/rest/v1/" +
      encodeURIComponent(String(tableName || "")) +
      "?on_conflict=" +
      encodeURIComponent(String(conflictColumn || ""));
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        "Supabase " +
          String(tableName || "") +
          " upsert failed: " +
          String(response.status || 0) +
          " " +
          bodyText,
      );
    }
  }

  async function deleteRows(tableName, filters) {
    if (!supabaseEnabled || !Array.isArray(filters) || filters.length === 0) {
      return;
    }
    const query = filters
      .map((filter) => {
        const key = encodeURIComponent(String(filter?.key || ""));
        const value = encodeURIComponent(String(filter?.value || ""));
        return key + "=eq." + value;
      })
      .join("&");
    const endpoint =
      urlBase +
      "/rest/v1/" +
      encodeURIComponent(String(tableName || "")) +
      (query ? "?" + query : "");
    const response = await fetchImpl(endpoint, {
      method: "DELETE",
      headers: {
        apikey: secretKey,
        authorization: "Bearer " + secretKey,
      },
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        "Supabase " +
          String(tableName || "") +
          " delete failed: " +
          String(response.status || 0) +
          " " +
          bodyText,
      );
    }
  }

  function toRoomRow(roomInput) {
    const room = roomInput && typeof roomInput === "object" ? roomInput : {};
    const status = String(room.status || "lobby");
    return {
      room_code: String(room.code || "").trim().toUpperCase(),
      display_name: String(room.displayName || ""),
      status,
      host_player_id: String(room.hostPlayerId || "") || null,
      max_players: Math.max(1, Number(room.maxPlayers || 5)),
      created_at_ms: Number(room.createdAt || Date.now()),
      updated_at_ms: Number(room.updatedAt || Date.now()),
      archived_at_ms: room.archivedAt ? Number(room.archivedAt) : null,
      last_archive_reason: room.lastArchiveReason ? String(room.lastArchiveReason) : null,
      turn_number: Number(room?.turn?.number || 1),
      turn_day: String(room?.turn?.day || "Friday"),
      turn_roll: Array.isArray(room?.turn?.roll) ? room.turn.roll : null,
      turn_rolled_at_ms: room?.turn?.rolledAt ? Number(room.turn.rolledAt) : null,
    };
  }

  function toRoomPlayers(roomInput) {
    const room = roomInput && typeof roomInput === "object" ? roomInput : {};
    const players = Array.isArray(room.players) ? room.players : [];
    return players.map((player) => ({
      room_code: String(room.code || "").trim().toUpperCase(),
      player_id: String(player?.playerId || ""),
      profile_id: player?.profileId ? String(player.profileId) : null,
      name: String(player?.name || "Player"),
      seat: Math.max(1, Number(player?.seat || 1)),
      is_host: String(player?.playerId || "") === String(room.hostPlayerId || ""),
      connected: Boolean(player?.connected),
      reconnect_token: player?.reconnectToken ? String(player.reconnectToken) : null,
      can_reconnect_until_ms: player?.canReconnectUntil
        ? Number(player.canReconnectUntil)
        : null,
      last_seen_at_ms: Number(player?.lastSeenAt || Date.now()),
      ended_turn: Boolean(player?.endedTurn),
      turn_summary: player?.turnSummary && typeof player.turnSummary === "object"
        ? player.turnSummary
        : null,
      live_state: player?.liveState && typeof player.liveState === "object"
        ? player.liveState
        : null,
    }));
  }

  function toSnapshotRow(roomInput) {
    const room = roomInput && typeof roomInput === "object" ? roomInput : {};
    return {
      room_code: String(room.code || "").trim().toUpperCase(),
      snapshot: room,
      updated_at_ms: Number(room.updatedAt || Date.now()),
    };
  }

  async function syncRoomToSupabase(roomInput) {
    if (!supabaseEnabled) {
      return;
    }
    const room = roomInput && typeof roomInput === "object" ? roomInput : {};
    if (!room.code) {
      return;
    }
    try {
      await postRows("rooms", "room_code", [toRoomRow(room)]);
      await deleteRows("room_players", [{ key: "room_code", value: room.code }]);
      const players = toRoomPlayers(room);
      if (players.length > 0) {
        await postRows("room_players", "room_code,player_id", players);
      }
      await postRows("room_snapshots", "room_code", [toSnapshotRow(room)]);
      lastError = "";
      lastSyncedAt = Date.now();
    } catch (error) {
      lastError = String(error?.message || error || "room_repository_sync_failed");
    }
  }

  async function removeRoomFromSupabase(roomCodeInput) {
    if (!supabaseEnabled) {
      return;
    }
    const roomCode = String(roomCodeInput || "").trim().toUpperCase();
    if (!roomCode) {
      return;
    }
    try {
      await deleteRows("room_players", [{ key: "room_code", value: roomCode }]);
      await deleteRows("room_snapshots", [{ key: "room_code", value: roomCode }]);
      lastError = "";
      lastSyncedAt = Date.now();
    } catch (error) {
      lastError = String(error?.message || error || "room_repository_delete_failed");
    }
  }

  function loadRooms() {
    return Array.from(activeRoomsByCode.values()).map((room) =>
      JSON.parse(JSON.stringify(room)),
    );
  }

  function saveRoom(roomInput) {
    const room = roomInput && typeof roomInput === "object" ? roomInput : null;
    const roomCode = String(room?.code || "").trim().toUpperCase();
    if (!room || !roomCode) {
      return;
    }
    const clone = JSON.parse(JSON.stringify(room));
    clone.code = roomCode;
    activeRoomsByCode.set(roomCode, clone);
    writeSnapshot();
    syncRoomToSupabase(clone).catch(() => {});
  }

  function archiveRoom(archiveInput) {
    const archive =
      archiveInput && typeof archiveInput === "object" ? archiveInput : null;
    const roomCode = String(archive?.code || "").trim().toUpperCase();
    if (!archive || !roomCode) {
      return;
    }
    archivesByCode.set(roomCode, JSON.parse(JSON.stringify(archive)));
    writeSnapshot();
  }

  function removeRoom(roomCodeInput) {
    const roomCode = String(roomCodeInput || "").trim().toUpperCase();
    if (!roomCode) {
      return;
    }
    activeRoomsByCode.delete(roomCode);
    writeSnapshot();
    removeRoomFromSupabase(roomCode).catch(() => {});
  }

  function getStatus() {
    return {
      persistedRooms: activeRoomsByCode.size,
      archivedRooms: archivesByCode.size,
      supabaseEnabled,
      lastSyncedAt: lastSyncedAt || null,
      lastError: lastError || null,
    };
  }

  return {
    loadRooms,
    saveRoom,
    archiveRoom,
    removeRoom,
    getStatus,
  };
}

module.exports = {
  createRoomRepository,
};

#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("./lib/loadEnvFile");

const ROOT = path.resolve(__dirname, "..");
const PROFILE_PATH = path.join(ROOT, "server", "output", "profiles.json");
const EVENTS_PATH = path.join(ROOT, "server", "output", "room-events.ndjson");

function ensureConfig() {
  const loaded = loadEnvFile();
  const fileEnv = loaded.ok ? loaded.env : {};
  const supabaseUrl = String(process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "").trim();
  const supabaseSecret = String(
    process.env.SUPABASE_SECRET_KEY || fileEnv.SUPABASE_SECRET_KEY || "",
  ).trim();
  if (!supabaseUrl || !supabaseSecret) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment/.env");
  }
  return { supabaseUrl, supabaseSecret };
}

function readLegacyProfiles() {
  if (!fs.existsSync(PROFILE_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(PROFILE_PATH, "utf8");
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
  return rows
    .map((row) => {
      const profileId = String(row?.profileId || "").trim();
      if (!profileId) {
        return null;
      }
      return {
        profile_id: profileId,
        profile_token: String(row?.profileToken || "").trim() || null,
        display_name: String(row?.displayName || "Player").slice(0, 24),
        created_at_ms: Number(row?.createdAt || 0) || null,
        updated_at_ms: Number(row?.updatedAt || 0) || null,
        last_seen_at_ms: Number(row?.lastSeenAt || 0) || null,
        rooms: Array.isArray(row?.rooms) ? row.rooms : [],
      };
    })
    .filter(Boolean);
}

function readRoomEvents() {
  if (!fs.existsSync(EVENTS_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(EVENTS_PATH, "utf8");
  if (!raw) {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .map((row) => {
      const eventId = String(row?.eventId || "").trim();
      const roomCode = String(row?.roomCode || "").trim().toUpperCase();
      if (!eventId || !roomCode) {
        return null;
      }
      const actor = row?.actor && typeof row.actor === "object" ? row.actor : {};
      const profileRefs = Array.isArray(row?.profileRefs)
        ? row.profileRefs.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      return {
        event_id: eventId,
        sequence: Math.max(1, Number(row?.sequence || 1)),
        room_code: roomCode,
        timestamp: String(row?.timestamp || new Date().toISOString()),
        timestamp_ms: Math.max(0, Number(row?.timestampMs || Date.now())),
        type: String(row?.type || "event"),
        actor_player_id: actor?.playerId ? String(actor.playerId) : null,
        actor_profile_id: actor?.profileId ? String(actor.profileId) : null,
        profile_refs: profileRefs,
        payload: row?.payload && typeof row.payload === "object" ? row.payload : {},
      };
    })
    .filter(Boolean);
}

async function upsertRows({ supabaseUrl, supabaseSecret, table, conflictColumns, rows }) {
  if (!rows.length) {
    return { count: 0 };
  }
  const chunkSize = 500;
  let total = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const url =
      supabaseUrl.replace(/\/$/, "") +
      "/rest/v1/" +
      encodeURIComponent(table) +
      "?on_conflict=" +
      encodeURIComponent(conflictColumns);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseSecret,
        authorization: "Bearer " + supabaseSecret,
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error("Upsert failed for " + table + ": " + response.status + " " + text);
    }
    total += chunk.length;
  }
  return { count: total };
}

async function main() {
  const { supabaseUrl, supabaseSecret } = ensureConfig();
  const profiles = readLegacyProfiles();
  const events = readRoomEvents();

  console.log("Importing to Supabase...");
  console.log("- profiles:", profiles.length);
  console.log("- room events:", events.length);

  const profileResult = await upsertRows({
    supabaseUrl,
    supabaseSecret,
    table: "legacy_profiles",
    conflictColumns: "profile_id",
    rows: profiles,
  });
  const eventResult = await upsertRows({
    supabaseUrl,
    supabaseSecret,
    table: "room_events",
    conflictColumns: "event_id",
    rows: events,
  });

  console.log("Done.");
  console.log("- upserted profiles:", profileResult.count);
  console.log("- upserted room events:", eventResult.count);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});


const fs = require("node:fs");
const path = require("node:path");

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const eq = trimmed.indexOf("=");
  if (eq <= 0) {
    return null;
  }
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  // Allow quoted values.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadEnvFile(envPathInput) {
  const envPath = envPathInput
    ? path.resolve(process.cwd(), String(envPathInput))
    : path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return { ok: false, error: "env_file_missing", env: {} };
  }
  const raw = fs.readFileSync(envPath, "utf8");
  const env = {};
  raw.split("\n").forEach((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      return;
    }
    env[parsed.key] = parsed.value;
  });
  return { ok: true, env };
}

module.exports = { loadEnvFile };


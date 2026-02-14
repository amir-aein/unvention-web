#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const { createConfiguredHarness } = require('./lib/engineHarness');
const policy = require('./policies/vpGreedyPolicy');

function parseArgs(argv) {
  const parsed = {
    runs: 100,
    players: 1,
    seedBase: 'sim-seed',
    traceRate: 0.1,
    maxSteps: 400,
    outputDir: path.resolve(__dirname, 'output', 'latest'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === '--runs' && next) {
      parsed.runs = Math.max(1, Number(next) || parsed.runs);
      index += 1;
      continue;
    }
    if (current === '--players' && next) {
      parsed.players = Math.max(1, Number(next) || parsed.players);
      index += 1;
      continue;
    }
    if (current === '--seed-base' && next) {
      parsed.seedBase = String(next || parsed.seedBase);
      index += 1;
      continue;
    }
    if (current === '--trace-rate' && next) {
      const rate = Number(next);
      parsed.traceRate = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : parsed.traceRate;
      index += 1;
      continue;
    }
    if (current === '--max-steps' && next) {
      parsed.maxSteps = Math.max(50, Number(next) || parsed.maxSteps);
      index += 1;
      continue;
    }
    if (current === '--output-dir' && next) {
      parsed.outputDir = path.resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }
  }

  return parsed;
}

function toCsvRow(values) {
  return values
    .map((value) => {
      const text = String(value ?? '');
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    })
    .join(',');
}

function createPlayerIds(count) {
  return Array.from({ length: count }, (_item, index) => 'P' + String(index + 1));
}

function summarizePlayers(state) {
  const players = Array.isArray(state.players) ? state.players : [];
  return players.map((player) => ({
    id: player.id,
    totalScore: Number(player.totalScore || 0),
    toolScore: Number(player.toolScore || 0),
    completedJournals: Number(player.completedJournals || 0),
    mechanismsBuilt: Array.isArray(player.mechanisms) ? player.mechanisms.length : 0,
    placements: (Array.isArray(player.inventions) ? player.inventions : []).reduce(
      (sum, invention) => sum + (Array.isArray(invention.placements) ? invention.placements.length : 0),
      0,
    ),
  }));
}

function getActivePlayerId(state) {
  const players = Array.isArray(state.players) ? state.players : [];
  const ids = players.map((player) => String(player?.id || '')).filter(Boolean);
  const configured = String(state.activePlayerId || '').trim();
  if (configured && ids.includes(configured)) {
    return configured;
  }
  return ids[0] || 'P1';
}

function runGame(gameIndex, config) {
  const playerIds = createPlayerIds(config.players);
  const seed = config.seedBase + '-' + String(gameIndex + 1);
  const harness = createConfiguredHarness({
    playerIds,
    seed,
  });

  const trace = [];
  const keepTrace = Math.random() < config.traceRate;
  let stalledCount = 0;

  for (let step = 0; step < config.maxSteps; step += 1) {
    const beforeState = harness.getState();
    const before = JSON.stringify(beforeState);
    const actingPlayerId = getActivePlayerId(beforeState);
    policy.playStep(harness.engine, {
      playerId: actingPlayerId,
      trace: keepTrace ? trace : [],
    });
    const afterState = harness.getState();
    const after = JSON.stringify(afterState);

    if (afterState.gameStatus === 'completed') {
      return {
        gameId: gameIndex + 1,
        seed,
        state: afterState,
        trace: keepTrace ? trace : null,
        didComplete: true,
        warning: null,
      };
    }

    if (before === after) {
      stalledCount += 1;
    } else {
      stalledCount = 0;
    }

    if (stalledCount >= 12) {
      return {
        gameId: gameIndex + 1,
        seed,
        state: afterState,
        trace: keepTrace ? trace : null,
        didComplete: false,
        warning: 'stalled_state',
      };
    }
  }

  return {
    gameId: gameIndex + 1,
    seed,
    state: harness.getState(),
    trace: keepTrace ? trace : null,
    didComplete: false,
    warning: 'max_steps_reached',
  };
}

function writeOutputs(config, summaries, traces) {
  fs.rmSync(config.outputDir, { recursive: true, force: true });
  fs.mkdirSync(config.outputDir, { recursive: true });

  const summaryJsonPath = path.join(config.outputDir, 'summary.json');
  const summaryCsvPath = path.join(config.outputDir, 'summary.csv');
  const gamesNdjsonPath = path.join(config.outputDir, 'games.ndjson');
  const tracesNdjsonPath = path.join(config.outputDir, 'traces.ndjson');

  fs.writeFileSync(summaryJsonPath, JSON.stringify(summaries, null, 2));

  const csvHeader = [
    'game_id',
    'seed',
    'completed',
    'warning',
    'final_day',
    'turn_number',
    'winner_ids',
    'scores_json',
    'p1_total_score',
    'p1_tool_score',
    'p1_completed_journals',
    'p1_mechanisms_built',
    'p1_placements',
  ];
  const csvRows = [toCsvRow(csvHeader)];
  summaries.forEach((summary) => {
    const players = Array.isArray(summary.players) ? summary.players : [];
    const maxScore = players.reduce((max, player) => Math.max(max, Number(player.totalScore || 0)), Number.NEGATIVE_INFINITY);
    const winners = players
      .filter((player) => Number(player.totalScore || 0) === maxScore)
      .map((player) => player.id)
      .join('|');
    const scoresJson = JSON.stringify(
      players.map((player) => ({ id: player.id, totalScore: player.totalScore })),
    );
    const p1 = summary.players.find((player) => player.id === 'P1') || {
      totalScore: 0,
      toolScore: 0,
      completedJournals: 0,
      mechanismsBuilt: 0,
      placements: 0,
    };
    csvRows.push(
      toCsvRow([
        summary.gameId,
        summary.seed,
        summary.completed,
        summary.warning || '',
        summary.currentDay,
        summary.turnNumber,
        winners,
        scoresJson,
        p1.totalScore,
        p1.toolScore,
        p1.completedJournals,
        p1.mechanismsBuilt,
        p1.placements,
      ]),
    );
  });
  fs.writeFileSync(summaryCsvPath, csvRows.join('\n') + '\n');

  const ndjsonLines = summaries.map((summary) => JSON.stringify(summary)).join('\n');
  fs.writeFileSync(gamesNdjsonPath, ndjsonLines + (ndjsonLines ? '\n' : ''));

  if (traces.length > 0) {
    const traceLines = traces.map((entry) => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(tracesNdjsonPath, traceLines + '\n');
  }

  return {
    summaryJsonPath,
    summaryCsvPath,
    gamesNdjsonPath,
    tracesNdjsonPath: traces.length > 0 ? tracesNdjsonPath : null,
  };
}

function main() {
  const config = parseArgs(process.argv.slice(2));

  const summaries = [];
  const traces = [];

  for (let gameIndex = 0; gameIndex < config.runs; gameIndex += 1) {
    const result = runGame(gameIndex, config);
    const state = result.state;

    const summary = {
      gameId: result.gameId,
      seed: result.seed,
      policy: policy.name,
      playerCount: config.players,
      completed: result.didComplete,
      warning: result.warning,
      currentDay: state.currentDay,
      turnNumber: state.turnNumber,
      gameStatus: state.gameStatus,
      players: summarizePlayers(state),
    };
    summaries.push(summary);

    if (result.trace && result.trace.length > 0) {
      traces.push({
        gameId: result.gameId,
        seed: result.seed,
        policy: policy.name,
        actions: result.trace,
      });
    }
  }

  const outputs = writeOutputs(config, summaries, traces);
  const completed = summaries.filter((item) => item.completed).length;
  const meanScore =
    summaries.reduce((sum, item) => {
      const total = (Array.isArray(item.players) ? item.players : [])
        .reduce((playerSum, player) => playerSum + Number(player.totalScore || 0), 0);
      const count = Math.max(1, (Array.isArray(item.players) ? item.players : []).length);
      return sum + total / count;
    }, 0) / summaries.length;

  console.log('Simulation complete');
  console.log('Policy: ' + policy.name);
  console.log('Runs: ' + summaries.length);
  console.log('Completed: ' + completed + '/' + summaries.length);
  console.log('Mean player total score: ' + meanScore.toFixed(2));
  console.log('Summary CSV: ' + outputs.summaryCsvPath);
  console.log('Summary JSON: ' + outputs.summaryJsonPath);
  console.log('Game NDJSON: ' + outputs.gamesNdjsonPath);
  if (outputs.tracesNdjsonPath) {
    console.log('Sampled traces NDJSON: ' + outputs.tracesNdjsonPath);
  }
}

main();

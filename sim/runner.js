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
    personas: Array.isArray(policy.personaNames) && policy.personaNames.length > 0
      ? [...policy.personaNames]
      : ['adaptive_opportunist'],
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
    if (current === '--personas' && next) {
      const personaList = String(next)
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      if (personaList.length > 0) {
        parsed.personas = personaList;
      }
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

function incrementCount(target, key, amount = 1) {
  if (!target[key]) {
    target[key] = 0;
  }
  target[key] += amount;
}

function createPlayerIds(count) {
  return Array.from({ length: count }, (_item, index) => 'P' + String(index + 1));
}

function createSeededRng(seedText) {
  const text = String(seedText || 'sim-seed');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return function nextRandom() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = current;
  }
}

function createPersonaAssignmentsByGame(config) {
  const personas =
    Array.isArray(config.personas) && config.personas.length > 0
      ? config.personas
      : ['adaptive_opportunist'];
  const rng = createSeededRng(config.seedBase + '-persona-plan');
  const gameCount = Math.max(1, Number(config.runs || 1));
  const playerCount = Math.max(1, Number(config.players || 1));
  const byGame = [];
  for (let gameIndex = 0; gameIndex < gameCount; gameIndex += 1) {
    const picks = [];
    const fullCycles = Math.floor(playerCount / personas.length);
    for (let cycle = 0; cycle < fullCycles; cycle += 1) {
      picks.push(...personas);
    }
    const remainder = playerCount % personas.length;
    if (remainder > 0) {
      const remainderPool = [...personas];
      shuffleInPlace(remainderPool, rng);
      picks.push(...remainderPool.slice(0, remainder));
    }
    shuffleInPlace(picks, rng);
    byGame.push(picks);
  }
  return byGame;
}

function assignPersonas(playerIds, gamePersonas) {
  const ids = Array.isArray(playerIds) ? playerIds : [];
  const assignments = {};
  ids.forEach((playerId, index) => {
    assignments[playerId] = gamePersonas[index] || 'adaptive_opportunist';
  });
  return assignments;
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

function getWinnerDetails(players) {
  const list = Array.isArray(players) ? players : [];
  const scores = list.map((player) => Number(player.totalScore || 0));
  const sorted = [...scores].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  return {
    winnerIds: list
      .filter((player) => Number(player.totalScore || 0) === top)
      .map((player) => player.id),
    winnerMargin: top - second,
    topScore: top,
  };
}

function summarizePlayers(state) {
  const players = Array.isArray(state.players) ? state.players : [];
  return players.map((player) => {
    const mechanisms = Array.isArray(player.mechanisms) ? player.mechanisms : [];
    const mechanismSizes = mechanisms.map((mechanism) =>
      Array.isArray(mechanism.path) ? mechanism.path.length : 0,
    );

    const inventions = (Array.isArray(player.inventions) ? player.inventions : []).map((invention) => ({
      id: invention.id,
      completionStatus: invention.completionStatus,
      presentedDay: invention.presentedDay,
      placements: Array.isArray(invention.placements) ? invention.placements.length : 0,
      score: Number(invention.score || invention.scoring?.total || 0),
      scoring: {
        variety: Number(invention.scoring?.variety || 0),
        completion: Number(invention.scoring?.completion || 0),
        unique: Number(invention.scoring?.unique || 0),
        total: Number(invention.scoring?.total || 0),
      },
      uniqueIdeasMarked: Number(invention.uniqueIdeasMarked || invention.multiplier || 1),
      workshopTypeMarks: {
        W1: Boolean(invention.workshopTypeMarks?.W1),
        W2: Boolean(invention.workshopTypeMarks?.W2),
        W3: Boolean(invention.workshopTypeMarks?.W3),
        W4: Boolean(invention.workshopTypeMarks?.W4),
      },
    }));

    const toolUnlocks = (Array.isArray(player.unlockedTools) ? player.unlockedTools : []).map((tool) => ({
      id: String(tool.id || ''),
      name: String(tool.name || ''),
      unlockTier: String(tool.unlockTier || ''),
      pointsAwarded: Number(tool.pointsAwarded || 0),
      unlockedAtTurn: Number(tool.unlockedAtTurn || 0),
      unlockedAtDay: String(tool.unlockedAtDay || ''),
      mechanismId: String(tool.mechanismId || ''),
    }));

    return {
      id: player.id,
      totalScore: Number(player.totalScore || 0),
      toolScore: Number(player.toolScore || 0),
      completedJournals: Number(player.completedJournals || 0),
      mechanismsBuilt: mechanisms.length,
      mechanismSizeHistogram: {
        size2: mechanismSizes.filter((size) => size === 2).length,
        size3to4: mechanismSizes.filter((size) => size >= 3 && size <= 4).length,
        size5plus: mechanismSizes.filter((size) => size >= 5).length,
      },
      mechanismSizes,
      placements: inventions.reduce((sum, invention) => sum + invention.placements, 0),
      inventions,
      toolUnlocks,
      toolUnlockCount: toolUnlocks.length,
    };
  });
}

function analyzeLogs(entries) {
  const logs = Array.isArray(entries) ? entries : [];
  const warningMessageCounts = {};
  const blockedReasonCounts = {};
  const toolUnlockEvents = [];

  logs.forEach((entry) => {
    const level = String(entry?.level || '').toLowerCase();
    const message = String(entry?.message || '');
    const context = entry?.context && typeof entry.context === 'object' ? entry.context : {};

    if (level === 'warn') {
      incrementCount(warningMessageCounts, message || 'unknown_warning');
      if (context.reason) {
        incrementCount(blockedReasonCounts, String(context.reason));
      }
    }

    if (context.toolId) {
      toolUnlockEvents.push({
        toolId: String(context.toolId),
        pointsAwarded: Number(context.pointsAwarded || 0),
        unlockTier: String(context.unlockTier || ''),
        mechanismId: String(context.mechanismId || ''),
        playerId: String(context.playerId || ''),
      });
    }
  });

  return {
    warningMessageCounts,
    blockedReasonCounts,
    toolUnlockEvents,
  };
}

function createMetricsCollector() {
  return {
    totalActionEvents: 0,
    phaseActionCounts: {},
    playerActionCounts: {},
    fallbackEvents: 0,
    forcedPhaseJumps: 0,
    phaseTransitionCounts: {},
    activePlayerTransitionCounts: {},
    stalledSteps: 0,
  };
}

function recordActionMetrics(metrics, event) {
  if (!metrics || !event || typeof event !== 'object') {
    return;
  }
  metrics.totalActionEvents += 1;
  const phase = String(event.phase || 'unknown');
  const action = String(event.action || 'unknown');
  const playerId = String(event.playerId || 'unknown');

  incrementCount(metrics.phaseActionCounts, phase + ':' + action);
  incrementCount(metrics.playerActionCounts, playerId + ':' + phase + ':' + action);

  if (action.includes('fallback')) {
    metrics.fallbackEvents += 1;
  }
  if (action.includes('forced_phase_jump')) {
    metrics.forcedPhaseJumps += 1;
  }
}

function runGame(gameIndex, config, personaAssignmentsByGame) {
  const playerIds = createPlayerIds(config.players);
  const personaAssignments = assignPersonas(playerIds, personaAssignmentsByGame[gameIndex] || []);
  const seed = config.seedBase + '-' + String(gameIndex + 1);
  const harness = createConfiguredHarness({ playerIds, seed });

  const trace = [];
  const keepTrace = Math.random() < config.traceRate;
  const metrics = createMetricsCollector();
  let stalledCount = 0;

  const traceSink = {
    push(event) {
      const normalized = event && typeof event === 'object' ? { ...event } : { action: 'unknown' };
      recordActionMetrics(metrics, normalized);
      if (keepTrace) {
        trace.push(normalized);
      }
    },
  };

  for (let step = 0; step < config.maxSteps; step += 1) {
    const beforeState = harness.getState();
    const before = JSON.stringify(beforeState);
    const actingPlayerId = getActivePlayerId(beforeState);

    policy.playStep(harness.engine, {
      playerId: actingPlayerId,
      persona: personaAssignments[actingPlayerId],
      trace: traceSink,
    });

    const afterState = harness.getState();
    const after = JSON.stringify(afterState);

    incrementCount(metrics.phaseTransitionCounts, String(beforeState.phase) + '->' + String(afterState.phase));
    incrementCount(
      metrics.activePlayerTransitionCounts,
      String(getActivePlayerId(beforeState)) + '->' + String(getActivePlayerId(afterState)),
    );

    if (keepTrace) {
      trace.push({
        type: 'step',
        step,
        actingPlayerId,
        beforePhase: beforeState.phase,
        afterPhase: afterState.phase,
        beforeDay: beforeState.currentDay,
        afterDay: afterState.currentDay,
        beforeTurn: beforeState.turnNumber,
        afterTurn: afterState.turnNumber,
        stateChanged: before !== after,
      });
    }

    if (afterState.gameStatus === 'completed') {
      return {
        gameId: gameIndex + 1,
        seed,
        state: afterState,
        logs: harness.logs,
        trace: keepTrace ? trace : null,
        metrics,
        personaAssignments,
        didComplete: true,
        warning: null,
      };
    }

    if (before === after) {
      stalledCount += 1;
      metrics.stalledSteps += 1;
    } else {
      stalledCount = 0;
    }

    if (stalledCount >= 12) {
      return {
        gameId: gameIndex + 1,
        seed,
        state: afterState,
        logs: harness.logs,
        trace: keepTrace ? trace : null,
        metrics,
        personaAssignments,
        didComplete: false,
        warning: 'stalled_state',
      };
    }
  }

  return {
    gameId: gameIndex + 1,
    seed,
    state: harness.getState(),
    logs: harness.logs,
    trace: keepTrace ? trace : null,
    metrics,
    personaAssignments,
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
    'player_count',
    'completed',
    'warning',
    'final_day',
    'turn_number',
    'winner_ids',
    'winner_margin',
    'persona_assignments_json',
    'scores_json',
    'fallback_events',
    'forced_phase_jumps',
    'tool_unlock_events',
    'blocked_reasons_json',
    'p1_total_score',
    'p1_tool_score',
    'p1_completed_journals',
    'p1_mechanisms_built',
    'p1_placements',
  ];

  const csvRows = [toCsvRow(csvHeader)];
  summaries.forEach((summary) => {
    const scoresJson = JSON.stringify(
      summary.players.map((player) => ({ id: player.id, totalScore: player.totalScore })),
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
        summary.playerCount,
        summary.completed,
        summary.warning || '',
        summary.currentDay,
        summary.turnNumber,
        summary.winnerIds.join('|'),
        summary.winnerMargin,
        JSON.stringify(summary.personaAssignments || {}),
        scoresJson,
        summary.metrics.fallbackEvents,
        summary.metrics.forcedPhaseJumps,
        summary.logInsights.toolUnlockEvents.length,
        JSON.stringify(summary.logInsights.blockedReasonCounts),
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
  const personaAssignmentsByGame = createPersonaAssignmentsByGame(config);

  const summaries = [];
  const traces = [];

  for (let gameIndex = 0; gameIndex < config.runs; gameIndex += 1) {
    const result = runGame(gameIndex, config, personaAssignmentsByGame);
    const state = result.state;
    const players = summarizePlayers(state);
    const winner = getWinnerDetails(players);
    const logInsights = analyzeLogs(result.logs);

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
      activePlayerId: state.activePlayerId || null,
      winnerIds: winner.winnerIds,
      winnerMargin: winner.winnerMargin,
      personaAssignments: result.personaAssignments || {},
      metrics: result.metrics,
      logInsights,
      players,
    };

    summaries.push(summary);

    if (result.trace && result.trace.length > 0) {
      traces.push({
        gameId: result.gameId,
        seed: result.seed,
        policy: policy.name,
        personaAssignments: result.personaAssignments || {},
        actions: result.trace,
      });
    }
  }

  const outputs = writeOutputs(config, summaries, traces);
  const completed = summaries.filter((item) => item.completed).length;
  const meanScore =
    summaries.reduce((sum, item) => {
      const total = item.players.reduce((playerSum, player) => playerSum + Number(player.totalScore || 0), 0);
      const count = Math.max(1, item.players.length);
      return sum + total / count;
    }, 0) / Math.max(1, summaries.length);

  console.log('Simulation complete');
  console.log('Policy: ' + policy.name);
  console.log('Runs: ' + summaries.length);
  console.log('Personas: ' + (config.personas || []).join(', '));
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

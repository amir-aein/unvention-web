# Simulation Runner

This folder is an isolated headless simulation project. It uses only core game services and does not import or modify UI code.

## What it does

- Runs repeated games with a non-random `vp-greedy` policy.
- Writes compact outputs for analysis.
- Optionally stores sampled action traces (not every game by default).

## Usage

```bash
npm run simulate -- --runs 200 --seed-base exp-a --trace-rate 0.1
```

Available flags:

- `--runs <n>`: number of simulated games (default `100`)
- `--players <n>`: number of players (for example `1` to `4`)
- `--seed-base <text>`: seed prefix used to derive per-game seeds (default `sim-seed`)
- `--trace-rate <0..1>`: fraction of games to save full action traces for (default `0.1`)
- `--max-steps <n>`: safety limit to prevent infinite loops (default `400`)
- `--output-dir <path>`: custom output folder (default `sim/output/latest`)

## Output files

Default output directory: `sim/output/latest`

- `summary.csv`: one row per game for fast statistical analysis
- `summary.json`: same data in JSON format
- `games.ndjson`: one JSON object per game
- `traces.ndjson`: sampled per-action traces (only when sampled traces exist)

## Notes

- The policy is deterministic for a given state and seed path.
- The runner is intentionally separate so app runtime/UI behavior is unaffected.
- The runner uses `activePlayerId` turn rotation from core state.

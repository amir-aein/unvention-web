# Staging + Production Workflow

## Branches

- `main`: production branch (live players).
- `staging`: pre-release validation branch.
- `feature/*`: day-to-day work branches.

## One-time setup

1. Push `staging` branch to GitHub:
   ```bash
   git checkout staging
   git -c credential.helper= push -u origin staging
   git checkout main
   ```
2. In Render, create a second web service from the same repo:
   - Service 1 (production): branch `main`
   - Service 2 (staging): branch `staging`
   - Build command: `npm install`
   - Start command: `npm start`

## Daily development flow

1. Start from latest `staging`:
   ```bash
   git checkout staging
   git pull
   ```
2. Create feature branch:
   ```bash
   git checkout -b feature/short-description
   ```
3. Develop locally and test:
   ```bash
   npm test
   ```
4. Push feature branch and open PR into `staging`.
5. After staging verification, merge `staging` into `main`.

## Safety rules

- Never commit directly to Render servers.
- Never deploy untested code to `main`.
- Treat staging as required gate before production.

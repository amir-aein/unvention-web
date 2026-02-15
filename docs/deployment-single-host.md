# Single-Host Deployment Guide (Beginner Friendly)

This project is now set up so one Node service hosts both:
- the game website (`/`)
- the multiplayer websocket backend (same domain, `ws`/`wss`)

## What you need first

1. A GitHub account.
2. A Render account (free tier works for testing).
3. Your code pushed to a GitHub repository.

## 1) Push your code to GitHub

From this project folder:

```bash
git add .
git commit -m "Prepare single-host deployment"
git push
```

If your repo is not connected yet, create one on GitHub and follow GitHub's "push an existing repository" commands.

## 2) Create the server on Render

1. Log in to Render.
2. Click `New` -> `Web Service`.
3. Connect your GitHub account (if prompted).
4. Select this repository.
5. Fill in:
   - Name: `unvention-web` (or any name)
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
6. Click `Create Web Service`.

Render will build and deploy automatically.

## 3) Verify it is live

After deployment finishes, open your Render URL:

1. `https://YOUR-SERVICE.onrender.com/`
   - You should see the game UI.
2. `https://YOUR-SERVICE.onrender.com/health`
   - You should see JSON with `"ok": true`.
3. `https://YOUR-SERVICE.onrender.com/api/rooms`
   - You should see JSON with room list data.
4. `https://YOUR-SERVICE.onrender.com/api/rooms/ABC123/history` (replace with real room code after a game)
   - You should see room history events for that room.

## 4) Test multiplayer

1. Open the site in one normal browser window.
2. Open the same site in one incognito window.
3. Create a room in the first window.
4. Join it in the second window.
5. Start game and confirm both windows stay in sync.

## 5) Normal update flow later

Every time you want to deploy changes:

```bash
npm test
git add .
git commit -m "Describe your change"
git push
```

Render will auto-deploy the new commit.

## Notes

- Free hosting tiers can sleep after inactivity. First load may be slow.
- Active room state is in memory. If server restarts, active rooms are lost, but profile snapshots and room event history remain in `server/output/`.

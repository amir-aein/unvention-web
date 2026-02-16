# Development Workflow

Use this loop for every UI-facing change.

1. Implement the change.
2. Run tests: `npm test`
3. Capture current UI output: `npm run ui:screenshot`
4. Review screenshots before declaring done:
   - `sim/output/latest/ui-home-desktop.png`
   - `sim/output/latest/ui-home-mobile.png`
5. If layout or hierarchy is off, adjust and repeat from step 2.

Optional combined command:

- `npm run ui:check`

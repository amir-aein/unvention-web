const test = require('node:test');
const assert = require('node:assert/strict');

function loadGameStateService() {
  delete globalThis.Unvention;
  delete require.cache[require.resolve('../../src/core/services/gameStateService.js')];
  require('../../src/core/services/gameStateService.js');
  return globalThis.Unvention.GameStateService;
}

test('GameStateService loads, merges defaults, and persists updates', () => {
  const GameStateService = loadGameStateService();

  const saves = [];
  const store = {
    loadState() {
      return {
        currentDay: 'Saturday',
        logs: [{ message: 'restored' }],
      };
    },
    saveState(state) {
      saves.push(state);
    },
  };

  const service = new GameStateService(store);
  const loaded = service.load();

  assert.equal(loaded.currentDay, 'Saturday');
  assert.equal(loaded.turnNumber, 1);
  assert.equal(loaded.phase, 'roll_and_group_dice');
  assert.equal(loaded.gameStatus, 'active');
  assert.deepEqual(loaded.players, []);
  assert.equal(loaded.logs.length, 1);

  const updated = service.update({ turnNumber: 2 });
  assert.equal(updated.turnNumber, 2);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].turnNumber, 2);

  const reset = service.reset();
  assert.equal(reset.currentDay, 'Friday');
  assert.equal(reset.turnNumber, 1);
  assert.equal(reset.logs.length, 0);
  assert.equal(saves.length, 2);
});

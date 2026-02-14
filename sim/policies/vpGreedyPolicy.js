function getPlayer(state, playerId) {
  return (Array.isArray(state.players) ? state.players : []).find((player) => player.id === playerId) || null;
}

function countNulls(values) {
  return (Array.isArray(values) ? values : []).filter((value) => value === null).length;
}

function getEmptyJournalCells(journal) {
  const cells = [];
  const grid = Array.isArray(journal?.grid) ? journal.grid : [];
  grid.forEach((row, rowIndex) => {
    (Array.isArray(row) ? row : []).forEach((value, colIndex) => {
      if (value === null) {
        cells.push({ row: rowIndex, col: colIndex });
      }
    });
  });
  return cells;
}

function getOpenWorkshopCells(workshop) {
  const cells = [];
  const rows = Array.isArray(workshop?.cells) ? workshop.cells : [];
  rows.forEach((row, rowIndex) => {
    (Array.isArray(row) ? row : []).forEach((cell, colIndex) => {
      if (!cell || cell.kind === 'empty' || cell.circled) {
        return;
      }
      cells.push({ row: rowIndex, col: colIndex, cell });
    });
  });
  return cells;
}

function estimateJournalPlacementValue(journal, rowIndex, colIndex, value) {
  const grid = Array.isArray(journal.grid) ? journal.grid : [];
  const row = Array.isArray(grid[rowIndex]) ? grid[rowIndex] : [];
  const col = grid.map((item) => (Array.isArray(item) ? item[colIndex] : null));

  const rowNullsBefore = countNulls(row);
  const colNullsBefore = countNulls(col);
  const allNullsBefore = grid.reduce((sum, currentRow) => sum + countNulls(currentRow), 0);
  let score = Number(value || 0);

  if (rowNullsBefore === 1) {
    score += 7;
  }
  if (colNullsBefore === 1) {
    score += 7;
  }
  if (allNullsBefore === 1) {
    score += 12;
  }
  if (journal.completionStatus !== 'complete' && allNullsBefore <= 3) {
    score += 3;
  }

  return score;
}

function selectBestJournalingGroup(engine, playerId) {
  const options = engine.getJournalingOptions(playerId);
  const state = engine.getState();
  const player = getPlayer(state, playerId);
  if (!player || !Array.isArray(options) || options.length === 0) {
    return false;
  }

  let best = null;
  options.forEach((option) => {
    const values = Array.isArray(option.values) ? option.values : [];
    let possiblePlacements = 0;
    let bestPlacementScore = Number.NEGATIVE_INFINITY;

    (Array.isArray(player.journals) ? player.journals : []).forEach((journal) => {
      getEmptyJournalCells(journal).forEach((cell) => {
        values.forEach((value) => {
          const validation = engine.validateJournalPlacement(journal, cell.row, cell.col, Number(value));
          if (!validation.ok) {
            return;
          }
          possiblePlacements += 1;
          bestPlacementScore = Math.max(
            bestPlacementScore,
            estimateJournalPlacementValue(journal, cell.row, cell.col, value),
          );
        });
      });
    });

    const candidate = {
      key: option.key,
      score: possiblePlacements * 10 + (Number.isFinite(bestPlacementScore) ? bestPlacementScore : -1000),
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  });

  if (!best) {
    return false;
  }
  engine.selectJournalingGroup(playerId, best.key);
  return true;
}

function findBestJournalPlacement(engine, playerId) {
  const state = engine.getState();
  const player = getPlayer(state, playerId);
  if (!player) {
    return null;
  }
  const choices = engine.getJournalNumberChoices(playerId);
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  let best = null;
  (Array.isArray(player.journals) ? player.journals : []).forEach((journal) => {
    getEmptyJournalCells(journal).forEach((cell) => {
      choices.forEach((choice) => {
        const value = Number(choice.usedValue);
        const validation = engine.validateJournalPlacement(journal, cell.row, cell.col, value);
        if (!validation.ok) {
          return;
        }
        const candidate = {
          journalId: journal.id,
          row: cell.row,
          col: cell.col,
          choice,
          score: estimateJournalPlacementValue(journal, cell.row, cell.col, value),
        };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      });
    });
  });

  return best;
}

function chooseIdeaTargetInvention(player) {
  const inventions = (Array.isArray(player.inventions) ? player.inventions : []).filter((item) => !item.presentedDay);
  let best = null;
  inventions.forEach((invention) => {
    const placements = Array.isArray(invention.placements) ? invention.placements.length : 0;
    const currentMultiplier = Number(invention.uniqueIdeasMarked || invention.multiplier || 1);
    const candidate = {
      inventionId: invention.id,
      score: placements * 5 + currentMultiplier * 2,
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  });
  return best;
}

function assignPendingIdeas(engine, playerId) {
  let assigned = 0;
  for (let guard = 0; guard < 8; guard += 1) {
    const state = engine.getState();
    const player = getPlayer(state, playerId);
    if (!player) {
      break;
    }
    const pending = engine.getPendingJournalIdeaJournals(playerId);
    if (!Array.isArray(pending) || pending.length === 0) {
      break;
    }

    const target = chooseIdeaTargetInvention(player);
    if (!target) {
      break;
    }

    const result = engine.assignJournalIdeaToInvention(playerId, pending[0].id, target.inventionId);
    if (!result.ok) {
      break;
    }
    assigned += 1;
  }
  return assigned;
}

function assignPendingIdeasFirstLegal(engine, playerId) {
  let assigned = 0;
  for (let guard = 0; guard < 10; guard += 1) {
    const state = engine.getState();
    const player = getPlayer(state, playerId);
    if (!player) {
      break;
    }
    const pending = engine.getPendingJournalIdeaJournals(playerId);
    if (!Array.isArray(pending) || pending.length === 0) {
      break;
    }
    const invention = (Array.isArray(player.inventions) ? player.inventions : []).find((item) => !item.presentedDay);
    if (!invention) {
      break;
    }
    const result = engine.assignJournalIdeaToInvention(playerId, pending[0].id, invention.id);
    if (!result.ok) {
      break;
    }
    assigned += 1;
  }
  return assigned;
}

function forceReleasePendingIdeas(engine, playerId) {
  const state = engine.getState();
  const player = getPlayer(state, playerId);
  if (!player) {
    return false;
  }
  const pending = engine.getPendingJournalIdeaJournals(playerId);
  if (!Array.isArray(pending) || pending.length === 0) {
    return false;
  }

  const playerClone = JSON.parse(JSON.stringify(player));
  let changed = false;
  (Array.isArray(playerClone.journals) ? playerClone.journals : []).forEach((journal) => {
    if (journal.ideaStatus === 'completed' && !journal.ideaAssignedToInventionId) {
      journal.ideaAssignedToInventionId = 'UNASSIGNED_FALLBACK';
      changed = true;
    }
  });
  if (!changed) {
    return false;
  }

  const players = (Array.isArray(state.players) ? state.players : []).map((item) =>
    item.id === playerId ? playerClone : item,
  );
  engine.gameStateService.update({ players });
  return true;
}

function placeFirstLegalJournalNumber(engine, playerId) {
  const state = engine.getState();
  const player = getPlayer(state, playerId);
  if (!player) {
    return false;
  }
  const choices = engine.getJournalNumberChoices(playerId);
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }

  const journals = Array.isArray(player.journals) ? player.journals : [];
  for (const journal of journals) {
    const cells = getEmptyJournalCells(journal);
    for (const cell of cells) {
      for (const choice of choices) {
        engine.selectJournal(playerId, journal.id);
        engine.selectActiveJournalNumber(
          playerId,
          choice.usedValue,
          choice.consumeValue,
          String(Boolean(choice.adjusted)),
        );
        const result = engine.placeJournalNumber(playerId, cell.row, cell.col, journal.id);
        if (result.ok) {
          return true;
        }
      }
    }
  }
  return false;
}

function playJournalPhase(engine, playerId, trace) {
  const state = engine.getState();
  const selection = state.journalSelections?.[playerId];
  if (!selection?.selectedGroupKey) {
    selectBestJournalingGroup(engine, playerId);
  }

  let placed = 0;
  for (let guard = 0; guard < 8; guard += 1) {
    let action = findBestJournalPlacement(engine, playerId);
    const currentSelection = engine.getState().journalSelections?.[playerId];
    if (!action && Number(currentSelection?.placementsThisTurn || 0) < 1) {
      if (selectBestJournalingGroup(engine, playerId)) {
        action = findBestJournalPlacement(engine, playerId);
      }
    }
    if (!action) {
      break;
    }

    engine.selectJournal(playerId, action.journalId);
    engine.selectActiveJournalNumber(
      playerId,
      action.choice.usedValue,
      action.choice.consumeValue,
      String(Boolean(action.choice.adjusted)),
    );

    const result = engine.placeJournalNumber(playerId, action.row, action.col, action.journalId);
    if (!result.ok) {
      break;
    }

    placed += 1;
    trace.push({ phase: 'journal', action: 'placeJournalNumber', detail: action });
  }

  const assigned = assignPendingIdeas(engine, playerId);
  if (assigned > 0) {
    trace.push({ phase: 'journal', action: 'assignJournalIdea', count: assigned });
  }

  engine.advancePhase();
  return placed;
}

function couldPlaceFromValues(cell, values) {
  if (cell.kind === 'wild') {
    return values.length > 0;
  }
  return values.includes(Number(cell.value));
}

function scoreWorkshopCell(workshop, row, col) {
  const ideas = Array.isArray(workshop.ideas) ? workshop.ideas : [];
  let ideaBonus = 0;
  ideas.forEach((idea) => {
    if (idea.status === 'unlocked') {
      return;
    }
    const points = [
      { row: idea.row, col: idea.col },
      { row: idea.row, col: idea.col + 1 },
      { row: idea.row + 1, col: idea.col },
      { row: idea.row + 1, col: idea.col + 1 },
    ];
    if (points.some((point) => point.row === row && point.col === col)) {
      ideaBonus += 4;
    }
  });
  return 2 + ideaBonus;
}

function selectBestWorkshopGroup(engine, playerId) {
  const options = engine.getWorkshoppingOptions(playerId);
  const state = engine.getState();
  const player = getPlayer(state, playerId);
  if (!player || !Array.isArray(options) || options.length === 0) {
    return false;
  }

  let best = null;
  options.forEach((option) => {
    const values = (Array.isArray(option.values) ? option.values : []).map((item) => Number(item));
    let possible = 0;

    (Array.isArray(player.workshops) ? player.workshops : []).forEach((workshop) => {
      getOpenWorkshopCells(workshop).forEach((entry) => {
        if (couldPlaceFromValues(entry.cell, values)) {
          possible += 1;
        }
      });
    });

    const candidate = {
      key: option.key,
      score: possible * 10,
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  });

  if (!best) {
    return false;
  }
  engine.selectWorkshoppingGroup(playerId, best.key);
  return true;
}

function findBestWorkshopPlacement(engine, playerId) {
  const state = engine.getState();
  const player = getPlayer(state, playerId);
  if (!player) {
    return null;
  }
  const choices = engine.getWorkshopNumberChoices(playerId);
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  let best = null;
  (Array.isArray(player.workshops) ? player.workshops : []).forEach((workshop) => {
    getOpenWorkshopCells(workshop).forEach((entry) => {
      choices.forEach((choice) => {
        if (entry.cell.kind === 'number' && Number(choice.usedValue) !== Number(entry.cell.value)) {
          return;
        }
        const candidate = {
          workshopId: workshop.id,
          row: entry.row,
          col: entry.col,
          choice,
          score: scoreWorkshopCell(workshop, entry.row, entry.col),
        };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      });
    });
  });

  return best;
}

function placeFirstLegalWorkshopPart(engine, playerId) {
  const state = engine.getState();
  const player = getPlayer(state, playerId);
  if (!player) {
    return false;
  }
  const choices = engine.getWorkshopNumberChoices(playerId);
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }

  const workshops = Array.isArray(player.workshops) ? player.workshops : [];
  for (const workshop of workshops) {
    const cells = getOpenWorkshopCells(workshop);
    for (const entry of cells) {
      for (const choice of choices) {
        engine.selectActiveWorkshopNumber(
          playerId,
          choice.usedValue,
          choice.consumeValue,
          String(Boolean(choice.adjusted)),
        );
        const result = engine.placeWorkshopPart(playerId, workshop.id, entry.row, entry.col);
        if (result.ok) {
          return true;
        }
      }
    }
  }
  return false;
}

function playWorkshopPhase(engine, playerId, trace) {
  const state = engine.getState();
  const selection = state.workshopSelections?.[playerId];
  if (!selection?.selectedGroupKey) {
    selectBestWorkshopGroup(engine, playerId);
  }

  for (let guard = 0; guard < 8; guard += 1) {
    const action = findBestWorkshopPlacement(engine, playerId);
    if (!action) {
      break;
    }

    engine.selectActiveWorkshopNumber(
      playerId,
      action.choice.usedValue,
      action.choice.consumeValue,
      String(Boolean(action.choice.adjusted)),
    );

    const result = engine.placeWorkshopPart(playerId, action.workshopId, action.row, action.col);
    if (!result.ok) {
      break;
    }
    trace.push({ phase: 'workshop', action: 'placeWorkshopPart', detail: action });
  }

  engine.advancePhase();
}

function pointKey(point) {
  return String(point.row) + ':' + String(point.col);
}

function collectCommittedMechanismCells(player, workshopId) {
  const committed = new Set();
  (Array.isArray(player.mechanisms) ? player.mechanisms : [])
    .filter((mechanism) => mechanism.workshopId === workshopId)
    .forEach((mechanism) => {
      (Array.isArray(mechanism.path) ? mechanism.path : []).forEach((point) => {
        committed.add(pointKey(point));
      });
    });
  return committed;
}

function getLargestWorkshopComponent(state, playerId) {
  const player = getPlayer(state, playerId);
  if (!player) {
    return null;
  }

  let best = null;
  (Array.isArray(player.workshops) ? player.workshops : []).forEach((workshop) => {
    const committed = collectCommittedMechanismCells(player, workshop.id);
    const rows = Array.isArray(workshop.cells) ? workshop.cells : [];
    const eligible = new Set();

    rows.forEach((row, rowIndex) => {
      (Array.isArray(row) ? row : []).forEach((cell, colIndex) => {
        if (!cell || cell.kind === 'empty' || !cell.circled) {
          return;
        }
        const key = pointKey({ row: rowIndex, col: colIndex });
        if (!committed.has(key)) {
          eligible.add(key);
        }
      });
    });

    const seen = new Set();
    eligible.forEach((key) => {
      if (seen.has(key)) {
        return;
      }
      const [startRow, startCol] = key.split(':').map(Number);
      const queue = [{ row: startRow, col: startCol }];
      const component = [];
      seen.add(key);

      while (queue.length > 0) {
        const current = queue.shift();
        component.push(current);
        const neighbors = [
          { row: current.row - 1, col: current.col },
          { row: current.row + 1, col: current.col },
          { row: current.row, col: current.col - 1 },
          { row: current.row, col: current.col + 1 },
        ];
        neighbors.forEach((neighbor) => {
          const neighborKey = pointKey(neighbor);
          if (!eligible.has(neighborKey) || seen.has(neighborKey)) {
            return;
          }
          seen.add(neighborKey);
          queue.push(neighbor);
        });
      }

      if (!best || component.length > best.path.length) {
        best = {
          workshopId: workshop.id,
          path: component,
        };
      }
    });
  });

  if (!best || best.path.length < 2) {
    return null;
  }
  return best;
}

function playBuildPhase(engine, playerId, trace) {
  const state = engine.getState();
  if (engine.canBuildThisTurn(state, playerId)) {
    const component = getLargestWorkshopComponent(state, playerId);
    if (component) {
      engine.clearMechanismDraft(playerId);
      component.path.forEach((point) => {
        engine.updateMechanismDraft(playerId, component.workshopId, point.row, point.col);
      });
      const result = engine.finishBuildingMechanism(playerId);
      if (result.ok) {
        trace.push({
          phase: 'build',
          action: 'finishBuildingMechanism',
          workshopId: component.workshopId,
          size: component.path.length,
        });
      }
    }
  }
  engine.advancePhase();
}

function getPatternBounds(pattern) {
  const rows = Array.isArray(pattern) ? pattern.map((row) => String(row)) : [];
  const rowCount = rows.length;
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return { rowCount, colCount, rows };
}

function countOpenCells(patternRows) {
  return patternRows.reduce((sum, row) => sum + row.split('').filter((cell) => cell === '1').length, 0);
}

function findBestInventPlacement(engine, playerId) {
  const state = engine.getState();
  const player = getPlayer(state, playerId);
  if (!player) {
    return null;
  }
  const mechanism = engine.getPendingMechanismForInvent(playerId);
  if (!mechanism) {
    return null;
  }

  const allowTransform = engine.hasTool(playerId, 'T1');
  const transforms = allowTransform
    ? [
        { rotation: 0, mirrored: false },
        { rotation: 1, mirrored: false },
        { rotation: 2, mirrored: false },
        { rotation: 3, mirrored: false },
        { rotation: 0, mirrored: true },
        { rotation: 1, mirrored: true },
        { rotation: 2, mirrored: true },
        { rotation: 3, mirrored: true },
      ]
    : [{ rotation: 0, mirrored: false }];

  let best = null;
  (Array.isArray(player.inventions) ? player.inventions : []).forEach((invention) => {
    if (invention.presentedDay) {
      return;
    }
    const bounds = getPatternBounds(invention.pattern);
    const occupied = new Set(
      (Array.isArray(invention.placements) ? invention.placements : [])
        .flatMap((placement) => (Array.isArray(placement.cells) ? placement.cells : []))
        .map((cell) => pointKey(cell)),
    );
    const openCellCount = countOpenCells(bounds.rows);
    const filledNow = occupied.size;

    transforms.forEach((transform) => {
      const shape = engine.transformMechanismShape(mechanism.path, transform);
      if (!Array.isArray(shape) || shape.length === 0) {
        return;
      }

      for (let row = 0; row < bounds.rowCount; row += 1) {
        for (let col = 0; col < bounds.colCount; col += 1) {
          const placementCells = shape.map((point) => ({ row: row + Number(point.row), col: col + Number(point.col) }));
          const allOpen = placementCells.every((cell) => engine.isInventionPatternOpen(invention, cell.row, cell.col));
          if (!allOpen) {
            continue;
          }
          const noOverlap = placementCells.every((cell) => !occupied.has(pointKey(cell)));
          if (!noOverlap) {
            continue;
          }

          const nextFilled = filledNow + placementCells.length;
          const completionBonus = nextFilled >= openCellCount ? 25 : (nextFilled / Math.max(1, openCellCount)) * 10;
          const newWorkshopMark = invention.workshopTypeMarks?.[mechanism.workshopId] ? 0 : 6;
          const candidate = {
            inventionId: invention.id,
            anchorRow: row,
            anchorCol: col,
            transform,
            score: completionBonus + newWorkshopMark + Number(mechanism.ideaCount || 0) * 8,
          };

          if (!best || candidate.score > best.score) {
            best = candidate;
          }
        }
      }
    });
  });

  return best;
}

function playInventPhase(engine, playerId, trace) {
  const action = findBestInventPlacement(engine, playerId);
  if (action) {
    if (engine.hasTool(playerId, 'T1')) {
      engine.resetPendingMechanismTransform(playerId);
      for (let turn = 0; turn < action.transform.rotation; turn += 1) {
        engine.rotatePendingMechanismForInvent(playerId, 'cw');
      }
      if (action.transform.mirrored) {
        engine.toggleMirrorPendingMechanismForInvent(playerId);
      }
    }

    const result = engine.placeMechanismInInvention(playerId, action.inventionId, action.anchorRow, action.anchorCol);
    if (result.ok) {
      trace.push({ phase: 'invent', action: 'placeMechanismInInvention', detail: action });
    }
  }

  engine.advancePhase();
}

function forceProgressIfStuck(engine, phase, playerId, trace) {
  if (phase === 'journal') {
    selectBestJournalingGroup(engine, playerId);
    if (!placeFirstLegalJournalNumber(engine, playerId)) {
      assignPendingIdeasFirstLegal(engine, playerId);
      if (!placeFirstLegalJournalNumber(engine, playerId)) {
        forceReleasePendingIdeas(engine, playerId);
      }
    }
    engine.advancePhase();
    const after = engine.getState();
    if (after.phase === 'journal') {
      const nextJournalSelections = { ...(after.journalSelections || {}) };
      const nextWorkshopContext = { ...(after.workshopPhaseContext || {}) };
      const selection = nextJournalSelections[playerId] || {};
      nextWorkshopContext[playerId] = {
        excludedGroupKey: selection.selectedGroupKey || null,
        journalChosenNumber: Number(selection.selectedGroupValues?.[0] ?? NaN),
      };
      delete nextJournalSelections[playerId];
      engine.gameStateService.update({
        phase: 'workshop',
        journalSelections: nextJournalSelections,
        workshopPhaseContext: nextWorkshopContext,
      });
      trace.push({ phase: 'journal', action: 'fallback_forced_phase_jump' });
      return;
    }
    trace.push({ phase: 'journal', action: 'fallback_force_progress' });
    return;
  }

  if (phase === 'workshop') {
    selectBestWorkshopGroup(engine, playerId);
    placeFirstLegalWorkshopPart(engine, playerId);
    engine.advancePhase();
    const after = engine.getState();
    if (after.phase === 'workshop') {
      const nextWorkshopSelections = { ...(after.workshopSelections || {}) };
      delete nextWorkshopSelections[playerId];
      engine.gameStateService.update({
        phase: 'build',
        workshopSelections: nextWorkshopSelections,
      });
      trace.push({ phase: 'workshop', action: 'fallback_forced_phase_jump' });
      return;
    }
    trace.push({ phase: 'workshop', action: 'fallback_force_progress' });
    return;
  }

  engine.advancePhase();
}

function playStep(engine, options = {}) {
  const playerId = options.playerId || 'P1';
  const trace = Array.isArray(options.trace) ? options.trace : [];
  const state = engine.getState();

  if (state.gameStatus === 'completed') {
    return;
  }

  const beforeFingerprint = JSON.stringify(state);
  const phase = state.phase;

  if (phase === 'roll_and_group') {
    engine.advancePhase();
    trace.push({ phase: 'roll_and_group', action: 'advancePhase' });
  } else if (phase === 'journal') {
    playJournalPhase(engine, playerId, trace);
  } else if (phase === 'workshop') {
    playWorkshopPhase(engine, playerId, trace);
  } else if (phase === 'build') {
    playBuildPhase(engine, playerId, trace);
  } else if (phase === 'invent') {
    playInventPhase(engine, playerId, trace);
  } else {
    engine.advancePhase();
  }

  const afterFingerprint = JSON.stringify(engine.getState());
  if (afterFingerprint === beforeFingerprint) {
    forceProgressIfStuck(engine, phase, playerId, trace);
  }
}

module.exports = {
  name: 'vp-greedy',
  playStep,
};

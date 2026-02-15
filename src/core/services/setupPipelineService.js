(function attachSetupPipelineService(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  const DEFAULT_MOD_ID = "classic";
  const DEFAULT_MOD_PRESETS = {
    classic: {
      id: "classic",
      label: "Classic",
      setupSteps: [],
    },
    variable_setup: {
      id: "variable_setup",
      label: "Variable Setup",
      setupSteps: [
        {
          id: "workshop_layout_order",
          enabled: true,
          params: {},
        },
        {
          id: "random_workshop_ideas",
          enabled: true,
          params: {},
        },
        {
          id: "random_invention_multiplier",
          enabled: true,
          params: {
            multiplier: 2,
          },
        },
        {
          id: "remove_parts_by_value",
          enabled: true,
          params: {
            count: 2,
          },
        },
      ],
    },
  };

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
  }

  function normalizeModId(value) {
    const text = String(value || "").trim().toLowerCase();
    return text || DEFAULT_MOD_ID;
  }

  function normalizeStepDescriptor(input) {
    const candidate = input && typeof input === "object" ? input : {};
    const id = String(candidate.id || "").trim();
    if (!id) {
      return null;
    }
    const hasEnabledFlag = Object.prototype.hasOwnProperty.call(candidate, "enabled");
    const params = candidate.params && typeof candidate.params === "object"
      ? deepClone(candidate.params)
      : {};
    return {
      id,
      enabled: hasEnabledFlag ? Boolean(candidate.enabled) : true,
      params,
    };
  }

  function normalizeSetupSteps(input) {
    if (!Array.isArray(input)) {
      return [];
    }
    return input
      .map((entry) => normalizeStepDescriptor(entry))
      .filter(Boolean);
  }

  function createSeedRng(seedText) {
    const seed = String(seedText || "");
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
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

  function pickIndex(rng, length) {
    if (!Number.isInteger(length) || length <= 0) {
      return 0;
    }
    return Math.floor(rng() * length);
  }

  function shuffleCopy(items, rng) {
    const copy = Array.isArray(items) ? [...items] : [];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1));
      const current = copy[index];
      copy[index] = copy[swapIndex];
      copy[swapIndex] = current;
    }
    return copy;
  }

  function normalizeIdeaAnchor(anchorInput) {
    const anchor = anchorInput && typeof anchorInput === "object" ? anchorInput : null;
    if (!anchor) {
      return null;
    }
    const row = Number(anchor.row);
    const col = Number(anchor.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return null;
    }
    return { row, col };
  }

  function dedupeIdeaAnchors(anchorsInput) {
    const anchors = Array.isArray(anchorsInput) ? anchorsInput : [];
    const byKey = new Map();
    anchors.forEach((anchor) => {
      const normalized = normalizeIdeaAnchor(anchor);
      if (!normalized) {
        return;
      }
      const key = String(normalized.row) + ":" + String(normalized.col);
      if (!byKey.has(key)) {
        byKey.set(key, normalized);
      }
    });
    return Array.from(byKey.values());
  }

  function sortIdeaAnchors(anchorsInput) {
    const anchors = dedupeIdeaAnchors(anchorsInput);
    anchors.sort((left, right) => {
      if (left.row !== right.row) {
        return left.row - right.row;
      }
      return left.col - right.col;
    });
    return anchors;
  }

  function areIdeaAnchorsAdjacent(anchorAInput, anchorBInput) {
    const anchorA = normalizeIdeaAnchor(anchorAInput);
    const anchorB = normalizeIdeaAnchor(anchorBInput);
    if (!anchorA || !anchorB) {
      return false;
    }
    const rowDelta = Math.abs(anchorA.row - anchorB.row);
    const colDelta = Math.abs(anchorA.col - anchorB.col);
    return rowDelta <= 1 && colDelta <= 1 && (rowDelta + colDelta > 0);
  }

  function getCandidateIdeaAnchorsForWorkshopCells(cellsInput) {
    const rows = Array.isArray(cellsInput) ? cellsInput : [];
    const rowCount = rows.length;
    if (rowCount < 2) {
      return [];
    }
    const candidates = [];
    for (let row = 0; row < rowCount - 1; row += 1) {
      const current = Array.isArray(rows[row]) ? rows[row] : [];
      const next = Array.isArray(rows[row + 1]) ? rows[row + 1] : [];
      const maxColumn = Math.min(current.length, next.length) - 1;
      for (let col = 0; col < maxColumn; col += 1) {
        const points = [
          current[col],
          current[col + 1],
          next[col],
          next[col + 1],
        ];
        const isValid = points.every((cell) => {
          if (!cell || typeof cell !== "object") {
            return false;
          }
          return String(cell.kind || "") !== "empty";
        });
        if (!isValid) {
          continue;
        }
        candidates.push({ row, col });
      }
    }
    return dedupeIdeaAnchors(candidates);
  }

  function pickUniqueIdeaAnchors(candidatesInput, desiredCount, rng) {
    const candidates = dedupeIdeaAnchors(candidatesInput);
    if (!Number.isInteger(desiredCount) || desiredCount <= 0 || candidates.length === 0) {
      return [];
    }
    const shuffled = shuffleCopy(candidates, rng);
    return sortIdeaAnchors(shuffled.slice(0, Math.min(desiredCount, shuffled.length)));
  }

  function chooseIdeaPatternTwoPairsAndSingleton(candidatesInput, rng) {
    const candidates = dedupeIdeaAnchors(candidatesInput);
    if (candidates.length < 5) {
      return [];
    }
    const adjacentPairs = [];
    for (let left = 0; left < candidates.length - 1; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        if (!areIdeaAnchorsAdjacent(candidates[left], candidates[right])) {
          continue;
        }
        adjacentPairs.push([left, right]);
      }
    }
    if (adjacentPairs.length < 2) {
      return [];
    }
    const validSelections = [];
    for (let first = 0; first < adjacentPairs.length - 1; first += 1) {
      const pairA = adjacentPairs[first];
      for (let second = first + 1; second < adjacentPairs.length; second += 1) {
        const pairB = adjacentPairs[second];
        const used = new Set([...pairA, ...pairB]);
        if (used.size < 4) {
          continue;
        }
        const pairAAnchors = pairA.map((index) => candidates[index]);
        const pairBAnchors = pairB.map((index) => candidates[index]);
        const pairsConnected = pairAAnchors.some((aAnchor) =>
          pairBAnchors.some((bAnchor) => areIdeaAnchorsAdjacent(aAnchor, bAnchor)),
        );
        if (pairsConnected) {
          continue;
        }
        for (let singleIndex = 0; singleIndex < candidates.length; singleIndex += 1) {
          if (used.has(singleIndex)) {
            continue;
          }
          const singleton = candidates[singleIndex];
          const touchesOther = [...pairAAnchors, ...pairBAnchors].some((anchor) =>
            areIdeaAnchorsAdjacent(anchor, singleton),
          );
          if (touchesOther) {
            continue;
          }
          validSelections.push([
            pairAAnchors[0],
            pairAAnchors[1],
            pairBAnchors[0],
            pairBAnchors[1],
            singleton,
          ]);
        }
      }
    }
    if (validSelections.length === 0) {
      return [];
    }
    return sortIdeaAnchors(validSelections[pickIndex(rng, validSelections.length)]);
  }

  function createWorkshopIdeasFromAnchors(workshopIdInput, anchorsInput) {
    const workshopId = String(workshopIdInput || "");
    const anchors = sortIdeaAnchors(anchorsInput);
    return anchors.map((anchor, index) => ({
      id: workshopId + "-I" + String(index + 1),
      row: Number(anchor.row),
      col: Number(anchor.col),
      status: "locked",
      unlockedAtTurn: null,
      unlockedAtDay: null,
    }));
  }

  const STEP_DEFINITIONS = {
    workshop_layout_order: {
      id: "workshop_layout_order",
      plan(_params, context, rng) {
        const workshopIds = Array.isArray(context.workshopIds) ? context.workshopIds : [];
        return {
          sourceWorkshopIdsByTarget: shuffleCopy(workshopIds, rng),
        };
      },
      apply(player, artifact, context) {
        const workshops = Array.isArray(player?.workshops) ? player.workshops : [];
        const sourceById = new Map(workshops.map((workshop) => [workshop.id, workshop]));
        const sourceByTarget = Array.isArray(artifact?.sourceWorkshopIdsByTarget)
          ? artifact.sourceWorkshopIdsByTarget
          : [];
        const nextWorkshops = workshops.map((workshop, index) => {
          const sourceWorkshopId = sourceByTarget[index];
          const sourceWorkshop = sourceById.get(sourceWorkshopId);
          if (!sourceWorkshop) {
            return workshop;
          }
          const nextCells = deepClone(sourceWorkshop.cells);
          const countFn = typeof context?.countWorkshopPartsByNumber === "function"
            ? context.countWorkshopPartsByNumber
            : null;
          return {
            ...workshop,
            cells: nextCells,
            partsByNumber: countFn ? countFn(nextCells) : workshop.partsByNumber,
            setupSourceWorkshopId: String(sourceWorkshopId),
          };
        });
        return {
          ...player,
          workshops: nextWorkshops,
        };
      },
    },
    random_workshop_ideas: {
      id: "random_workshop_ideas",
      plan(_params, context, rng) {
        const workshopIds = Array.isArray(context.workshopIds) ? context.workshopIds : [];
        const workshopSeedsById = {};
        workshopIds.forEach((workshopId) => {
          workshopSeedsById[String(workshopId)] = Math.floor(rng() * 1000000000);
        });
        return {
          workshopSeedsById,
        };
      },
      apply(player, artifact) {
        const workshops = Array.isArray(player?.workshops) ? player.workshops : [];
        if (workshops.length === 0) {
          return player;
        }
        const seedMap = artifact?.workshopSeedsById && typeof artifact.workshopSeedsById === "object"
          ? artifact.workshopSeedsById
          : {};
        const nextWorkshops = workshops.map((workshop, index) => {
          const workshopId = String(workshop?.id || "W" + String(index + 1));
          const existingIdeas = Array.isArray(workshop?.ideas) ? workshop.ideas : [];
          const desiredCount = Math.max(0, existingIdeas.length || 5);
          if (desiredCount === 0) {
            return workshop;
          }
          const candidates = getCandidateIdeaAnchorsForWorkshopCells(workshop?.cells);
          if (candidates.length < desiredCount) {
            return workshop;
          }
          const seed = String(seedMap[workshopId] ?? index);
          const workshopRng = createSeedRng("idea-layout|" + workshopId + "|" + seed);
          const selectedAnchors = desiredCount === 5
            ? chooseIdeaPatternTwoPairsAndSingleton(candidates, workshopRng)
            : [];
          const anchors = selectedAnchors.length === desiredCount
            ? selectedAnchors
            : pickUniqueIdeaAnchors(candidates, desiredCount, workshopRng);
          if (anchors.length !== desiredCount) {
            return workshop;
          }
          return {
            ...workshop,
            ideas: createWorkshopIdeasFromAnchors(workshopId, anchors),
          };
        });
        return {
          ...player,
          workshops: nextWorkshops,
        };
      },
    },
    random_invention_multiplier: {
      id: "random_invention_multiplier",
      plan(params, context, rng) {
        const inventionIds = Array.isArray(context.inventionIds) ? context.inventionIds : [];
        if (inventionIds.length === 0) {
          return {
            inventionId: null,
            multiplier: 2,
          };
        }
        const multiplier = clampInteger(params?.multiplier, 2, 1, 6);
        return {
          inventionId: inventionIds[pickIndex(rng, inventionIds.length)],
          multiplier,
        };
      },
      apply(player, artifact) {
        const inventionId = String(artifact?.inventionId || "");
        if (!inventionId) {
          return player;
        }
        const multiplier = clampInteger(artifact?.multiplier, 2, 1, 6);
        const inventions = Array.isArray(player?.inventions) ? player.inventions : [];
        return {
          ...player,
          inventions: inventions.map((invention) => {
            if (String(invention?.id) !== inventionId) {
              return invention;
            }
            return {
              ...invention,
              uniqueIdeasMarked: multiplier,
              multiplier,
            };
          }),
        };
      },
    },
    remove_parts_by_value: {
      id: "remove_parts_by_value",
      plan(params, context, rng) {
        const workshopIds = Array.isArray(context.workshopIds) ? context.workshopIds : [];
        const desiredCount = clampInteger(params?.count, 2, 1, 8);
        const maxCombos = workshopIds.length * 6;
        const removalCount = Math.max(0, Math.min(desiredCount, maxCombos));
        const removals = [];
        const usedKeys = new Set();
        while (removals.length < removalCount && workshopIds.length > 0) {
          const workshopId = workshopIds[pickIndex(rng, workshopIds.length)];
          const value = clampInteger(Math.floor(rng() * 6) + 1, 1, 1, 6);
          const key = String(workshopId) + ":" + String(value);
          if (usedKeys.has(key)) {
            continue;
          }
          usedKeys.add(key);
          removals.push({
            workshopId,
            value,
          });
        }
        return { removals };
      },
      apply(player, artifact, context) {
        const countFn = typeof context?.countWorkshopPartsByNumber === "function"
          ? context.countWorkshopPartsByNumber
          : null;
        const removals = Array.isArray(artifact?.removals) ? artifact.removals : [];
        if (!Array.isArray(player?.workshops) || removals.length === 0) {
          return player;
        }
        let workshops = player.workshops;
        removals.forEach((removal) => {
          const targetWorkshopId = String(removal?.workshopId || "");
          const targetValue = clampInteger(removal?.value, 1, 1, 6);
          workshops = workshops.map((workshop) => {
            if (String(workshop?.id) !== targetWorkshopId) {
              return workshop;
            }
            let changed = false;
            const nextCells = (Array.isArray(workshop.cells) ? workshop.cells : []).map((row) =>
              (Array.isArray(row) ? row : []).map((cell) => {
                const isMatch = cell?.kind === "number" && Number(cell.value) === targetValue;
                if (!isMatch) {
                  return cell;
                }
                changed = true;
                return {
                  kind: "empty",
                  value: null,
                  circled: false,
                  removedBySetup: true,
                  removedPartValue: targetValue,
                };
              }),
            );
            if (!changed) {
              return workshop;
            }
            return {
              ...workshop,
              cells: nextCells,
              partsByNumber: countFn ? countFn(nextCells) : workshop.partsByNumber,
            };
          });
        });
        return {
          ...player,
          workshops,
        };
      },
    },
  };

  class SetupPipelineService {
    getModPresets() {
      return deepClone(DEFAULT_MOD_PRESETS);
    }

    normalizeGameSetupConfig(input) {
      const candidate = input && typeof input === "object" ? input : {};
      return {
        modId: normalizeModId(candidate.modId),
        setupSteps: normalizeSetupSteps(candidate.setupSteps),
      };
    }

    resolveSetupSteps(gameConfigInput) {
      const normalized = this.normalizeGameSetupConfig(gameConfigInput);
      const presets = this.getModPresets();
      const selectedPreset = presets[normalized.modId] || presets[DEFAULT_MOD_ID] || { setupSteps: [] };
      const baseSteps = normalizeSetupSteps(selectedPreset.setupSteps);
      const byId = new Map(baseSteps.map((step, index) => [step.id, { ...step, _index: index }]));
      const ordered = [...baseSteps];
      normalized.setupSteps.forEach((override) => {
        const existing = byId.get(override.id);
        if (!existing) {
          ordered.push({
            id: override.id,
            enabled: override.enabled,
            params: deepClone(override.params || {}),
          });
          byId.set(override.id, { ...override, _index: ordered.length - 1 });
          return;
        }
        const next = {
          id: existing.id,
          enabled: override.enabled,
          params: {
            ...(existing.params || {}),
            ...(override.params || {}),
          },
        };
        ordered[existing._index] = next;
        byId.set(override.id, { ...next, _index: existing._index });
      });

      return {
        modId: String(selectedPreset.id || DEFAULT_MOD_ID),
        steps: ordered.filter((step) => String(step.id || "").trim().length > 0),
      };
    }

    getPlanFingerprint(payload) {
      const input = payload && typeof payload === "object" ? payload : {};
      const resolved = this.resolveSetupSteps(input.gameConfig || {});
      const basis = {
        modId: resolved.modId,
        steps: resolved.steps.map((step) => ({
          id: step.id,
          enabled: Boolean(step.enabled),
          params: step.params || {},
        })),
        seed: String(input.rngSeed || ""),
        workshopIds: Array.isArray(input.workshopIds) ? input.workshopIds.map(String) : [],
        inventionIds: Array.isArray(input.inventionIds) ? input.inventionIds.map(String) : [],
      };
      return JSON.stringify(basis);
    }

    createPlan(payload) {
      const input = payload && typeof payload === "object" ? payload : {};
      const resolved = this.resolveSetupSteps(input.gameConfig || {});
      const workshopIds = Array.isArray(input.workshopIds) ? input.workshopIds.map(String) : [];
      const inventionIds = Array.isArray(input.inventionIds) ? input.inventionIds.map(String) : [];
      const fingerprint = this.getPlanFingerprint({
        rngSeed: input.rngSeed,
        gameConfig: input.gameConfig,
        workshopIds,
        inventionIds,
      });
      const rng = createSeedRng(String(input.rngSeed || "") + "|setup|" + resolved.modId + "|" + fingerprint);
      const context = {
        workshopIds,
        inventionIds,
      };
      const steps = [];
      resolved.steps.forEach((step) => {
        if (!step.enabled) {
          return;
        }
        const definition = STEP_DEFINITIONS[step.id];
        if (!definition) {
          return;
        }
        const artifact = definition.plan(step.params || {}, context, rng);
        steps.push({
          id: definition.id,
          params: deepClone(step.params || {}),
          artifact: artifact || {},
        });
      });
      return {
        modId: resolved.modId,
        fingerprint,
        steps,
      };
    }

    applyPlanToPlayer(playerInput, planInput, contextInput) {
      let player = playerInput && typeof playerInput === "object" ? deepClone(playerInput) : {};
      const plan = planInput && typeof planInput === "object" ? planInput : {};
      const steps = Array.isArray(plan.steps) ? plan.steps : [];
      const context = contextInput && typeof contextInput === "object" ? contextInput : {};
      steps.forEach((step) => {
        const definition = STEP_DEFINITIONS[String(step?.id || "")];
        if (!definition || typeof definition.apply !== "function") {
          return;
        }
        player = definition.apply(player, step.artifact || {}, context) || player;
      });
      return player;
    }
  }

  root.SetupPipelineService = SetupPipelineService;
  root.createDefaultModPresets = function createDefaultModPresets() {
    return deepClone(DEFAULT_MOD_PRESETS);
  };
})(typeof window !== "undefined" ? window : globalThis);

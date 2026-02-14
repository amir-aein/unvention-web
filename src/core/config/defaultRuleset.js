(function attachDefaultRuleset(globalScope) {
  const root = globalScope.Unvention || (globalScope.Unvention = {});

  const DEFAULT_RULESET = {
    inventionTemplates: [
      {
        id: "I1",
        name: "The Integron Assembly",
        criterionKey: "intricacy",
        criterionLabel: "Intricacy",
        pattern: [
          "0001000",
          "0011100",
          "1111111",
          "1111111",
        ],
      },
      {
        id: "I2",
        name: "The Unison Motorworks",
        criterionKey: "synchrony",
        criterionLabel: "Synchrony",
        pattern: [
          "00110011",
          "11111111",
          "11111111",
          "11001100",
        ],
      },
      {
        id: "I3",
        name: "The Lateral Arc Engine",
        criterionKey: "modularity",
        criterionLabel: "Modularity",
        pattern: [
          "01000010",
          "11100111",
          "11111111",
          "11111111",
          "11100111",
          "01000010",
        ],
      },
    ],
    varietyBonusByTypeCount: {
      1: 0,
      2: 3,
      3: 7,
      4: 12,
    },
    completionBonusByInventionAndDay: {
      I1: { Friday: 10, Saturday: 8, Sunday: 5 },
      I2: { Friday: 13, Saturday: 11, Sunday: 8 },
      I3: { Friday: 18, Saturday: 16, Sunday: 12 },
    },
    toolTemplates: [
      {
        id: "T1",
        name: "Torque",
        firstUnlockPoints: 4,
        laterUnlockPoints: 2,
        abilityText: "You may rotate and/or mirror shapes.",
        pattern: [
          "010",
          "111",
          "010",
        ],
      },
      {
        id: "T2",
        name: "Flywheel",
        firstUnlockPoints: 3,
        laterUnlockPoints: 1,
        abilityText: "Building mechanisms costs 1 wrench.",
        pattern: [
          "0010",
          "1110",
          "0111",
          "0100",
        ],
      },
      {
        id: "T3",
        name: "Ball Bearing",
        firstUnlockPoints: 3,
        laterUnlockPoints: 1,
        abilityText: "Once per turn, you may modify a single die by ±1.",
        pattern: [
          "1100",
          "1111",
          "0011",
        ],
      },
      {
        id: "T4",
        name: "Reamer",
        firstUnlockPoints: 5,
        laterUnlockPoints: 2,
        abilityText: "You may mark multiple workshops or journals in a single turn.",
        pattern: [
          "101",
          "111",
          "101",
        ],
      },
    ],
    workshopLayouts: [
      [
        [5, 3, 5, 4, 2],
        [6, 2, "?", 1, 6],
        [3, 6, 4, 3, "?"],
        ["?", 5, 1, 3, 1],
        [1, 5, 2, 4, null],
      ],
      [
        [4, 3, "?", 1, 5],
        [1, 4, 5, 4, 3],
        ["?", 2, 3, 6, 1],
        [3, 6, 1, "?", 2],
        [null, 5, 4, 2, 6],
      ],
      [
        [2, 6, 1, 4, null],
        [1, 5, "?", 3, 1],
        [5, 2, 4, 5, "?"],
        [3, "?", 5, 2, 6],
        [6, 4, 2, 6, 3],
      ],
      [
        [null, 4, 3, 2, 5],
        ["?", 2, 6, "?", 3],
        [6, 2, 1, 4, 6],
        [4, 3, "?", 1, 2],
        [1, 6, 5, 5, 4],
      ],
    ],
    workshopIdeaAnchors: {
      W1: [
        { row: 0, col: 1 },
        { row: 0, col: 3 },
        { row: 1, col: 3 },
        { row: 2, col: 0 },
        { row: 3, col: 1 },
      ],
      W2: [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 2, col: 0 },
        { row: 2, col: 3 },
        { row: 3, col: 2 },
      ],
      W3: [
        { row: 0, col: 1 },
        { row: 1, col: 0 },
        { row: 2, col: 2 },
        { row: 3, col: 0 },
        { row: 3, col: 3 },
      ],
      W4: [
        { row: 0, col: 3 },
        { row: 1, col: 1 },
        { row: 1, col: 3 },
        { row: 3, col: 1 },
        { row: 3, col: 2 },
      ],
    },
  };

  root.createDefaultRuleset = function createDefaultRuleset() {
    return JSON.parse(JSON.stringify(DEFAULT_RULESET));
  };
})(typeof window !== "undefined" ? window : globalThis);

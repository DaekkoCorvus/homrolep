export const gameSystems = {
  gmDirector: { status: 'placeholder', observe() { return []; } },
  npcEngine: { status: 'placeholder', tick() { return []; } },
  missionGenerator: { status: 'placeholder', generate() { return null; } },
  missionEvaluator: { status: 'placeholder', evaluate() { return null; } },
  worldSimulation: { status: 'placeholder', tick() { return []; } },
  canonLoader: { status: 'placeholder' }
};

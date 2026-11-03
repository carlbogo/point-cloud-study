export type Stimulus = {
  id: string;
  image_path: string;
  dataset: string;
  difficulty: number;
  label: string;
  source_index: string;
  stimulus_source: string;
  exposures?: number;
};
// Khajuria et al. (2025), Fig. 8: https://doi.org/10.1371/journal.pcbi.1012968
export const DIFFICULTIES = [9, 11, 13, 17] as const;
export const DATASETS = ['mnist', 'fashion', 'cifar10'] as const;
export const DISTRIBUTIONS = {
  '2211': [2, 2, 1, 1],
  '3211': [3, 2, 1, 1],
  '3221': [3, 2, 2, 1],
  '2222': [2, 2, 2, 2],
} as const;
export type Plan = {
  id: string;
  name: string;
  dataset: string;
  difficulty: number;
  datasets: readonly string[];
  counts: readonly number[];
  demoOnly?: boolean;
};
export const plans: Plan[] = [
  {
    id: 'study-3211-v2',
    name: 'Full study · 21 images',
    dataset: 'mixed',
    difficulty: 0,
    datasets: DATASETS,
    counts: DISTRIBUTIONS['3211'],
  },
  {
    id: 'mnist-preview-v1',
    name: 'MNIST demo · 7 images',
    dataset: 'mnist',
    difficulty: 0,
    datasets: ['mnist'],
    counts: DISTRIBUTIONS['3211'],
    demoOnly: true,
  },
];
export const trialCount = (plan: Plan) =>
  plan.datasets.length * plan.counts.reduce((a, b) => a + b, 0);
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function samplePlan(pool: Stimulus[], plan: Plan): Stimulus[] {
  if (plan.counts.length !== 4 || plan.counts.some((n) => !Number.isInteger(n) || n < 0))
    throw new Error('Invalid study plan.');
  const chosen: Stimulus[] = [];
  for (const dataset of plan.datasets) {
    const slots = DIFFICULTIES.flatMap((difficulty, level) =>
      Array.from({ length: plan.counts[level] }, () =>
        shuffle(
          pool.filter(
            (s) =>
              s.dataset === dataset &&
              s.difficulty === difficulty &&
              (dataset !== 'mnist' || /^[1-9]$/.test(s.label)),
          ),
        ),
      ),
    );
    slots.sort((a, b) => a.length - b.length);
    const owner = new Map<string, number>(),
      assigned = new Map<number, Stimulus>();
    // Bipartite matching can move an earlier choice to another source. This avoids
    // random failures when difficulty levels share only part of their source pool.
    function assign(slot: number, seen: Set<string>): boolean {
      const labelCount = (label: string) =>
        [...assigned.values()].filter((s) => s.label === label).length;
      const candidates = [...slots[slot]].sort(
        (a, b) =>
          labelCount(a.label) - labelCount(b.label) || (a.exposures ?? 0) - (b.exposures ?? 0),
      );
      for (const item of candidates) {
        if (seen.has(item.source_index)) continue;
        seen.add(item.source_index);
        const previous = owner.get(item.source_index);
        if (previous === undefined || assign(previous, seen)) {
          owner.set(item.source_index, slot);
          assigned.set(slot, item);
          return true;
        }
      }
      return false;
    }
    for (let slot = 0; slot < slots.length; slot++) {
      if (!assign(slot, new Set()))
        throw new Error(`Not enough independent images across all four levels for ${dataset}.`);
    }
    chosen.push(...assigned.values());
  }
  // Never decrease difficulty. Begin with MNIST at the lowest level.
  const opening = chosen.filter((s) => s.dataset === 'mnist' && s.difficulty === DIFFICULTIES[0]);
  const remaining = chosen.filter((s) => s.dataset !== 'mnist' || s.difficulty !== DIFFICULTIES[0]);
  return [
    ...shuffle(opening),
    ...DIFFICULTIES.flatMap((d) => shuffle(remaining.filter((s) => s.difficulty === d))),
  ];
}

export type AnswerMode = 'hybrid' | 'choices' | 'legacy';
export const options: Record<string, string[]> = {
  mnist: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
  fashion: ['T-shirt', 'Bag', 'Dress', 'Trousers', 'Sneakers'],
  quickdraw: ['guitar', 'fish', 'butterfly', 'tree', 'umbrella', 'bicycle'],
};
export const normalise = (answer: string) =>
  answer
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[_\-/]/g, ' ')
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(a|an|the) /, '');
// Dataset metadata retains the original FashionMNIST labels. Map these to the
// participant-facing class names without changing historical ground truth.
export function className(label: string) {
  const value = normalise(label);
  return (
    (
      { 't shirt top': 't shirt', trouser: 'trousers', sneaker: 'sneakers' } as Record<
        string,
        string
      >
    )[value] ?? value
  );
}
export function allowedClass(dataset: string, label: string) {
  return (options[dataset] ?? []).some((option) => className(option) === className(label));
}
const synonyms: Record<string, string[]> = {
  't shirt top': [
    't shirt',
    't shirts',
    'tshirt',
    'tshirts',
    'tee',
    'tee shirt',
    't shirt top',
    'top',
  ],
  trouser: ['trouser', 'trousers', 'pant', 'pants', 'slacks'],
  pullover: ['pullover', 'pullovers', 'sweater', 'sweaters', 'jumper', 'jumpers'],
  dress: ['dress', 'dresses'],
  coat: ['coat', 'coats', 'overcoat'],
  sandal: ['sandal', 'sandals'],
  shirt: ['shirt', 'shirts', 'button up shirt', 'button down shirt'],
  sneaker: [
    'sneaker',
    'sneakers',
    'trainer',
    'trainers',
    'shoe',
    'shoes',
    'tennis shoe',
    'tennis shoes',
  ],
  bag: ['bag', 'bags', 'handbag', 'handbags', 'purse'],
  'ankle boot': ['ankle boot', 'ankle boots', 'boot', 'boots', 'bootie', 'booties'],
  airplane: [
    'airplane',
    'airplanes',
    'aeroplane',
    'aeroplanes',
    'plane',
    'planes',
    'aircraft',
    'air plane',
    'air planes',
  ],
  automobile: ['automobile', 'automobiles', 'car', 'cars', 'auto', 'motorcar'],
  bird: ['bird', 'birds'],
  cat: ['cat', 'cats'],
  deer: ['deer'],
  dog: ['dog', 'dogs'],
  frog: ['frog', 'frogs'],
  horse: ['horse', 'horses'],
  ship: ['ship', 'ships', 'boat', 'boats'],
  truck: ['truck', 'trucks', 'lorry', 'lorries'],
  bicycle: ['bicycle', 'bicycles', 'bike', 'bikes'],
  butterfly: ['butterfly', 'butterflies'],
  fish: ['fish', 'fishes'],
  guitar: ['guitar', 'guitars'],
  sailboat: [
    'sailboat',
    'sailboats',
    'sailing boat',
    'sailing boats',
    'sail boat',
    'sail boats',
    'sailing ship',
    'boat',
  ],
  tree: ['tree', 'trees'],
  umbrella: ['umbrella', 'umbrellas'],
};
export function answerType(dataset: string, _mode: AnswerMode) {
  if (dataset === 'mnist') return 'digit';
  return dataset === 'fashion' ? 'choice' : 'text';
}
export function grade(
  dataset: string,
  label: string,
  answer: string,
  mode: AnswerMode,
  skipped = false,
): { correct: number | null; method: string } {
  if (skipped) return { correct: null, method: 'skipped' };
  if (answerType(dataset, mode) !== 'text')
    return { correct: Number(className(answer) === className(label)), method: 'choice-v1' };
  const expected = normalise(label),
    actual = normalise(answer);
  if (
    actual === expected ||
    (synonyms[expected] ?? []).some((synonym) => normalise(synonym) === actual)
  )
    return { correct: 1, method: 'synonyms-v1' };
  // Unknown wording stays available for manual review rather than an automatic wrong mark.
  return { correct: null, method: 'review-v1' };
}

import { expect } from 'vitest';
import { describeEval, toolCalls } from 'vitest-evals';
import {
  papershelfHarness,
  type PapershelfEvalDocument,
  type PapershelfEvalInput,
  type PapershelfEvalResult,
} from './papershelf-search-harness.js';

const mrrFloor = 0.85;

const documents = [
  {
    path: 'semantic/01-slow-irrigation.md',
    text: 'Tomato seedlings thrived after the grower switched to clay ollas that release water slowly near roots. The buried jars kept leaves dry and cut watering trips during the heat wave.',
  },
  {
    path: 'semantic/02-library-van.md',
    text: 'The library van now parks outside the clinic every Tuesday. Patients can borrow large-print novels and return them at the pharmacy counter.',
  },
  {
    path: 'semantic/03-cabbage-crock.md',
    text: 'Cabbage packed with salt began bubbling by the third day. The crock smelled pleasantly sour once lactic bacteria took hold.',
  },
  {
    path: 'semantic/04-island-school-power.md',
    text: 'The island school replaced its diesel generator with roof panels and a battery shed. Evening classes continued even when fuel boats were delayed.',
  },
  {
    path: 'semantic/05-coral-moon.md',
    text: 'Divers waited until the full moon, then watched coral colonies release pink bundles into the current. The reef survey team collected spawn nets before sunrise.',
  },
  {
    path: 'semantic/06-cargo-cycle.md',
    text: 'The courier swapped a delivery truck for an e-cargo bike on downtown routes. Narrow lanes became faster, and bakery orders arrived without exhaust fumes.',
  },
  {
    path: 'semantic/07-hive-scale.md',
    text: 'Tiny hive scales reported weight changes through a cellular modem. Beekeepers saw nectar flows without opening the boxes.',
  },
  {
    path: 'semantic/08-rain-garden.md',
    text: createLongRainGardenDocument(),
  },
  {
    path: 'semantic/09-memory-music.md',
    text: 'In the memory ward, residents sang familiar choruses while a guitarist kept a steady tempo. Nurses noted calmer evenings after the sessions.',
  },
  {
    path: 'semantic/10-ash-layer.md',
    text: 'At the dig, students brushed ash from a cooking hearth and labeled pottery shards by layer. The oldest charcoal sample came from the north trench.',
  },
  {
    path: 'semantic/11-glacier-camera.md',
    text: 'A time-lapse camera showed the glacier front retreating past the painted survey stake. Meltwater carved a new channel across the moraine.',
  },
  {
    path: 'semantic/12-shiitake-broth.md',
    text: 'The chef dried shiitake stems and simmered them into broth. What looked like kitchen scraps became a deep umami base for noodles.',
  },
] satisfies PapershelfEvalDocument[];

const queries = [
  {
    name: 'porous garden watering',
    query: 'Which note is about porous pots feeding moisture underground to garden plants?',
    expectedPath: 'semantic/01-slow-irrigation.md',
    quote: 'clay ollas that release water slowly near roots',
  },
  {
    name: 'books brought to patients',
    query: 'Where is a roving reading service stopping near a healthcare waiting area?',
    expectedPath: 'semantic/02-library-van.md',
    quote: 'borrow large-print novels',
  },
  {
    name: 'tangy preserved greens',
    query: 'Which passage describes microbes making shredded vegetables acidic in a vessel?',
    expectedPath: 'semantic/03-cabbage-crock.md',
    quote: 'lactic bacteria took hold',
  },
  {
    name: 'stored sunshine for lessons',
    query: 'Which report says pupils kept lights on with stored sunshine instead of an engine?',
    expectedPath: 'semantic/04-island-school-power.md',
    quote: 'Evening classes continued',
  },
  {
    name: 'reef reproduction timing',
    query: 'Which account covers marine polyps releasing eggs and sperm according to a lunar cue?',
    expectedPath: 'semantic/05-coral-moon.md',
    quote: 'release pink bundles into the current',
  },
  {
    name: 'low emission city freight',
    query: 'Where did urban deliveries move by pedal-assist cycle rather than a polluting van?',
    expectedPath: 'semantic/06-cargo-cycle.md',
    quote: 'bakery orders arrived without exhaust fumes',
  },
  {
    name: 'remote apiary weighing',
    query: 'Which note lets apiarists infer blossom intake from remote colony mass readings?',
    expectedPath: 'semantic/07-hive-scale.md',
    quote: 'nectar flows without opening the boxes',
  },
  {
    name: 'vegetated runoff capture',
    query: 'Which passage says a paved area uses planted depressions to absorb street water?',
    expectedPath: 'semantic/08-rain-garden.md',
    quote: 'runoff soaked into planted basins',
  },
];

describeEval('papershelf semantic search', { harness: papershelfHarness }, (it) => {
  it('retrieves paraphrased queries from a 12-document corpus with one multi-chunk document', async ({ run }) => {
    const reciprocalRanks: number[] = [];

    for (const queryCase of queries) {
      const input = createInput(queryCase);
      const result = await run(input);
      const expectedRank = resultRank(result.output.results, input.expected.topDocId);
      const expectedResult = result.output.results[expectedRank];
      const replayedToolCalls = toolCalls(result.session);

      expect(result.output.exitCode, `${queryCase.name}: search exits successfully`).toBe(0);
      expect(
        replayedToolCalls.some((call) => call.name === 'zeroentropy.rerank'),
        `${queryCase.name}: reranker is applied`,
      ).toBe(true);
      expect(expectedRank, `${queryCase.name}: expected document appears in returned results`).toBeGreaterThanOrEqual(
        0,
      );
      expect(expectedResult?.snippet, `${queryCase.name}: expected snippet`).toContain(input.expected.quote);

      reciprocalRanks.push(reciprocalRank(expectedRank));
    }

    expect(mean(reciprocalRanks), 'mean reciprocal rank').toBeGreaterThanOrEqual(mrrFloor);
  });
});

function createInput(queryCase: (typeof queries)[number]): PapershelfEvalInput {
  return {
    name: queryCase.name,
    documents: [...documents],
    query: queryCase.query,
    expected: {
      topDocId: toDocId(queryCase.expectedPath),
      quote: queryCase.quote,
    },
  };
}

function toDocId(documentPath: string): string {
  return `.papershelf/docs/${documentPath}`;
}

function createLongRainGardenDocument(): string {
  // The target sentence starts after 450 filler words. With the default chunk size it lands near the
  // start of the second chunk; if chunking grows too large and merges it into the first chunk, the
  // 700-character snippet will not reach the expected quote.
  return [
    repeatFixtureSentence(
      'Crews mapped curb grades and soil beds after storms while noting drains, slopes, mulch, roots, stones, and flow.',
      25,
    ),
    'During storms, runoff soaked into planted basins beside the curb after the parking lot retrofit. Inspectors described the planted depressions as shallow rain gardens that slow street water, feed sedges and switchgrass, and keep oil grit from rushing into the drain.',
    repeatFixtureSentence(
      'Maintenance notes listed pruning dates, sediment depth, inlet checks, seed mixes, volunteer days, and repair tasks for each basin.',
      18,
    ),
  ].join('\n\n');
}

function repeatFixtureSentence(sentence: string, count: number): string {
  return Array.from({ length: count }, () => sentence).join(' ');
}

function resultRank(results: readonly PapershelfEvalResult[], expectedDocId: string): number {
  return results.findIndex((result) => result.docId === expectedDocId);
}

function reciprocalRank(rankIndex: number): number {
  return rankIndex === -1 ? 0 : 1 / (rankIndex + 1);
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

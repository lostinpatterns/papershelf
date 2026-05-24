import { describeEval } from 'vitest-evals';
import { papershelfEvals } from '../helpers.js';

describeEval(
  'retrieval quality',
  {
    ...papershelfEvals,
    skipIf: () => true,
  },
  (it) => {
    it('TODO: ranks relevant corpus passages for a natural-language query', async ({ run }) => {
      await run({
        name: 'TODO retrieval quality fixture',
        documents: [],
        query: 'TODO',
        expected: {
          topDocId: '.papershelf/docs/TODO.md',
        },
      });
    });
  },
);

import { expect, it } from 'vitest';
import { DEMO_CHUNKS } from '../../data/demoWorkspace';
import { demoWelcomeMessage, retrieveDemoCitations } from './AskResearchPage';

it('cites verbatim fixture passages on the recorded page in the welcome and every sample answer', () => {
  const examples = [
    demoWelcomeMessage,
    retrieveDemoCitations('Why is Gini importance biased?'),
    retrieveDemoCitations('How does conditional importance work?'),
    retrieveDemoCitations('How does Boruta use shadow attributes?'),
  ];

  for (const example of examples) {
    expect(example.citations?.length).toBeGreaterThan(0);
    for (const citation of example.citations ?? []) {
      const chunk = DEMO_CHUNKS[citation.chunkId];
      expect(citation.sourceId).toBe(chunk.sourceId);
      expect(citation.sourceTitle).toBe(chunk.sourceTitle);
      expect(citation.page).toBe(chunk.page);
      expect(chunk.text).toContain(citation.quote);
    }
  }
});

import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../../fixtures/hero-spec';
import { ApprovalModal } from './ApprovalModal';

const EXPERIMENT_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_RUN_ID = '22222222-2222-4222-8222-222222222222';

function render(repair: { parentRunId: string; attempt?: number | null } | null): string {
  return renderToStaticMarkup(
    React.createElement(ApprovalModal, {
      isOpen: true,
      onClose: () => undefined,
      onApprove: () => undefined,
      onReject: () => undefined,
      experimentId: EXPERIMENT_ID,
      gateSeq: 7,
      spec: HERO_EXPERIMENT_SPEC_RUN_A,
      repair,
    }),
  );
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

describe('ApprovalModal repair identity', () => {
  it('names a repair gate and its parent run', () => {
    const text = visibleText(render({ parentRunId: PARENT_RUN_ID, attempt: 2 }));

    expect(text).toContain('REPAIR APPROVAL');
    expect(text).toContain('Repair candidate for failed run');
    expect(text).toContain(PARENT_RUN_ID);
    expect(text).toContain('next attempt 2');
  });

  it('keeps the initial plan gate labelled as AWAIT_APPROVAL', () => {
    const text = visibleText(render(null));

    expect(text).toContain('AWAIT_APPROVAL');
    expect(text).not.toContain('Repair candidate for failed run');
  });
});

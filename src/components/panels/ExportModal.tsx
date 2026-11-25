import React from 'react';
import { X, Download } from 'lucide-react';
import rawWorkspace from '../../../fixtures/workspace.json';
import {
  HERO_EXPERIMENT_SPEC_RUN_A,
  HERO_RECORDED_RUN_RESULT,
} from '../../../fixtures/hero-spec';
import { buildNotebookDocument } from '../../shared/notebook';

function buildReproducibleNotebook(spec = HERO_EXPERIMENT_SPEC_RUN_A) {
  const claimNode = (rawWorkspace.nodes as any[]).find((n) => n.type === 'claim');
  const claimText =
    claimNode?.data?.text ||
    'Gini importance favours high-cardinality features; permutation does not';
  const claimQuote = claimNode?.data?.locator?.quote || '';
  const claimPage = claimNode?.data?.locator?.page ?? null;

  const doc = buildNotebookDocument({
    spec,
    environment: HERO_RECORDED_RUN_RESULT.environment,
    paperTitle:
      'Bias in random forest variable importance measures: Illustrations, sources and a solution',
    doi: '10.1186/1471-2105-8-25',
    claim: {
      text: claimText,
      quote: claimQuote,
      page: claimPage,
      reported: claimNode?.data?.reported ?? null,
    },
    verdict: null,
  });

  return JSON.stringify(doc, null, 2);
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
}) => {
  if (!isOpen) return null;

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(rawWorkspace, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'researchgraph-workspace.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onShowToast('Downloaded complete workspace.json fixture');
    onClose();
  };

  const handleDownloadNotebook = () => {
    const notebookContent = buildReproducibleNotebook();
    const blob = new Blob([notebookContent], { type: 'application/x-ipynb+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strobl_rf_reproducibility.ipynb';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onShowToast('Downloaded reproducible Jupyter notebook (.ipynb)');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-fade-in font-mono">
      <div className="w-full max-w-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] p-4">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase">
              Export Workspace
            </h3>
            <p className="text-[10px] text-[var(--text-dim)] font-sans mt-0.5">
              Select an export format for independent reproducibility verification.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* Option 1: Jupyter Notebook */}
          <div className="flex items-center justify-between p-3.5 border border-[var(--border-primary)] bg-[var(--card-bg)] hover:border-[var(--border-secondary)] transition gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-10 border border-[#f97316] bg-[#f97316]/10 text-[#f97316] flex items-center justify-center font-bold text-xs flex-shrink-0">
                IPYNB
              </div>
              <div>
                <div className="text-xs font-bold text-[var(--text-primary)]">
                  Reproducibility Notebook
                </div>
                <div className="text-[10px] text-[var(--text-dim)] font-sans mt-0.5">
                  Pre-configured Python script runnable in Google Colab
                </div>
              </div>
            </div>
            <button
              onClick={handleDownloadNotebook}
              className="px-3 py-1.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition flex items-center gap-1"
            >
              <Download className="h-3 w-3" />
              <span>Export</span>
            </button>
          </div>

          {/* Option 2: Workspace JSON */}
          <div className="flex items-center justify-between p-3.5 border border-[var(--border-primary)] bg-[var(--card-bg)] hover:border-[var(--border-secondary)] transition gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-10 border border-sky-400 bg-sky-950/30 text-sky-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                JSON
              </div>
              <div>
                <div className="text-xs font-bold text-[var(--text-primary)]">
                  Workspace JSON Fixture
                </div>
                <div className="text-[10px] text-[var(--text-dim)] font-sans mt-0.5">
                  Complete graph: sources, claims, methods, datasets, runs
                </div>
              </div>
            </div>
            <button
              onClick={handleDownloadJson}
              className="px-3 py-1.5 border border-[var(--border-primary)] bg-[var(--bg-surface)] hover:text-[#f97316] transition text-xs font-mono flex items-center gap-1"
            >
              <Download className="h-3 w-3" />
              <span>Export</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

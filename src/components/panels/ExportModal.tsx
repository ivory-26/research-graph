import React from 'react';
import { X, Download } from 'lucide-react';

const DEFAULT_NOTEBOOK = JSON.stringify({
  cells: [
    {
      cell_type: 'markdown',
      metadata: {},
      source: [
        '# Strobl et al. 2007 - Reproducibility Audit\n',
        'Comparing Gini impurity vs Permutation Importance on OpenML:52350 (breast-w + 3 synthetic noise columns).'
      ]
    },
    {
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: [
        'from sklearn.ensemble import RandomForestClassifier\n',
        'from sklearn.inspection import permutation_importance\n',
        'print("Running replication...")\n'
      ]
    }
  ],
  metadata: {
    language_info: { name: 'python' }
  },
  nbformat: 4,
  nbformat_minor: 2
}, null, 2);

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
    fetch('/fixtures/workspace.json')
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.blob();
      })
      .catch(() => {
        return new Blob(
          [
            JSON.stringify(
              {
                workspace: {
                  name: 'Random Forest Study',
                  mode: 'adapted',
                  dataset: 'OpenML:52350',
                },
                claim: 'Gini importance favours high-cardinality features; permutation does not',
                sources: 3,
                runs: ['Run A', 'Run B'],
              },
              null,
              2
            ),
          ],
          { type: 'application/json' }
        );
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'researchgraph-workspace.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        onShowToast('Downloaded workspace.json fixture');
        onClose();
      });
  };

  const handleDownloadNotebook = () => {
    const blob = new Blob([DEFAULT_NOTEBOOK], { type: 'application/x-ipynb+json' });
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
              <span>Download</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
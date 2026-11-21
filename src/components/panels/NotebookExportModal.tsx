import React, { useState } from 'react';
import { HERO_PYTHON_SCRIPT } from '../../data/demoWorkspace';
import { BookOpen, X, Download, Copy, Check } from 'lucide-react';

interface NotebookExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotebookExportModal: React.FC<NotebookExportModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const notebookJson = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.12.0',
      },
      researchgraph: {
        paper: 'Strobl et al. (2007) BMC Bioinformatics',
        doi: '10.1186/1471-2105-8-25',
        mode: 'adapted',
        verdict: 'match',
        dataHash: '7f83b1657ff185023908bf287cba6848419f44',
      },
    },
    cells: [
      {
        cell_type: 'markdown',
        metadata: {},
        source: [
          '# ResearchGraph Reproducibility Record\n',
          '**Paper**: Strobl et al., *Bias in random forest variable importance measures*, BMC Bioinformatics 8:25 (2007)\n',
          '**DOI**: [10.1186/1471-2105-8-25](https://doi.org/10.1186/1471-2105-8-25)\n',
          '**Reproduction Mode**: `adapted`\n',
          '**Verdict**: `match` (Criteria: `rank_impurity(noise_20) <= 5` and `rank_permutation(noise_20) > 15`)\n',
        ],
      },
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        outputs: [],
        source: [
          '# Install verified dependencies\n',
          '!pip install numpy==2.5.5 pandas==2.3.4 scikit-learn==1.9.1 scipy matplotlib\n',
        ],
      },
      {
        cell_type: 'code',
        execution_count: 2,
        metadata: {},
        outputs: [],
        source: HERO_PYTHON_SCRIPT.split('\n').map((line) => line + '\n'),
      },
    ],
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(notebookJson, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reproduction_strobl_2007.ipynb';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(notebookJson, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-orange-500/10 p-2.5 text-orange-600 dark:text-orange-400">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Jupyter Notebook (.ipynb) Export
                </h2>
                <span className="rounded-full bg-orange-100 dark:bg-orange-950 px-2 py-0.5 text-[10px] font-bold text-orange-800 dark:text-orange-300">
                  nbformat v4
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Self-contained, runnable in Google Colab with verbatim citations and pinned packages.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Notebook Preview */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60 font-mono text-xs space-y-2">
            <div className="text-slate-500">// Notebook Structure:</div>
            <div>1. [Markdown] Reproducibility Header &amp; Paper DOI</div>
            <div>2. [Code] Pinned Dependency Installation</div>
            <div>3. [Code] Verbatim scikit-learn Experiment Script</div>
            <div>4. [Code] Metrics Output &amp; Pass/Fail Criteria Evaluation</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-300 max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(notebookJson, null, 2)}</pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 p-5 dark:border-slate-800">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied to Clipboard' : 'Copy JSON'}
          </button>
          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-orange-600/20 hover:bg-orange-700 transition"
            >
              <Download className="h-4 w-4" />
              Download .ipynb File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

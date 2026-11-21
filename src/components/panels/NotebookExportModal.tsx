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
        paper: 'Strobl et al. 2007',
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
        source: HERO_PYTHON_SCRIPT.split('\n').map((l) => l + '\n'),
      },
    ],
  };

  const formattedJson = JSON.stringify(notebookJson, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([formattedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'researchgraph_strobl_2007.ipynb';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded bg-[#f97316]/10 p-2 text-[#f97316] border border-[#f97316]/30">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[var(--text-primary)] font-mono uppercase tracking-tight">
                  Export Self-Contained Notebook (.ipynb)
                </h2>
                <span className="badge-solid-white">COLAB READY</span>
              </div>
              <p className="text-xs text-[var(--text-dim)] mt-0.5 font-mono">
                One-click executable reproduction notebook with verified packages and pinned SHA-256 data.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="c p-4 bg-[var(--card-bg)] border border-[var(--border-primary)] text-xs space-y-1.5 font-mono">
            <div className="flex items-center justify-between">
              <span className="l">Target Paper:</span>
              <span className="text-[var(--text-primary)] font-bold">Strobl et al. 2007 (BMC Bioinformatics)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Kernel:</span>
              <span className="text-[var(--text-primary)]">Python 3.12 (scikit-learn 1.9.1)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Reproduction Criteria:</span>
              <span className="text-[#f97316]">rank_impurity(noise_20) ≤ 5 &amp; rank_permutation(noise_20) &gt; 15</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="l">Notebook JSON Preview</span>
              <span className="font-mono text-[10px] text-[var(--text-dim)]">Valid Jupyter nbformat 4.5</span>
            </div>
            <pre className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--card-bg)] p-4 font-mono text-[10px] text-[var(--text-muted)] leading-relaxed">
              <code>{formattedJson.slice(0, 1800)}...</code>
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-primary)] p-4 bg-[var(--bg-surface)]">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 h-8 px-3 rounded border border-[var(--border-primary)] bg-transparent text-xs font-mono uppercase text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] transition"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[#f97316]" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? 'Copied' : 'Copy JSON'}</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 h-8 px-4 rounded bg-[#f97316] text-black font-mono uppercase text-xs font-bold hover:bg-[#ea580c] transition shadow-[0_0_15px_rgba(249,115,22,0.3)]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download .ipynb</span>
          </button>
        </div>
      </div>
    </div>
  );
};

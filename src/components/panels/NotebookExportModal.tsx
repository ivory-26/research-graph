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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-[#252C36] bg-[#0E1116] text-[#E6EAF0] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#252C36] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#F5A524]/10 p-2 text-[#F5A524]">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#E6EAF0]">
                  Share: Jupyter Notebook (.ipynb) Export
                </h2>
                <span className="b text-[#3DD6B5] border-[#3DD6B5]/40 bg-[#3DD6B5]/10">
                  nbformat v4
                </span>
              </div>
              <p className="text-xs text-[#9AA4B2] mt-0.5">
                Self-contained, runnable in Google Colab with pre-pinned seeds and dataset hash.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#9AA4B2] hover:text-[#E6EAF0] hover:bg-[#161B22] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="c p-4 bg-[#161B22] text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="l">Kernel Specification:</span>
              <span className="m text-[#E6EAF0]">python3 (Python 3.12)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Dependencies:</span>
              <span className="m text-[#3DD6B5]">scikit-learn==1.9.1, numpy==2.5.5, pandas==2.3.4</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="l">Colab 1-Click Ready:</span>
              <span className="b text-[#3DD6B5] border-[#3DD6B5]/40 text-[10px]">Verified</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="l">Preview ipynb schema structure</span>
              <span className="m text-[10px] text-[#9AA4B2]">{formattedJson.length} bytes</span>
            </div>
            <div className="c max-h-60 overflow-y-auto p-4 bg-[#0E1116] border-[#252C36]">
              <pre className="font-mono text-[11px] leading-relaxed text-[#9AA4B2]">
                <code>{formattedJson.slice(0, 1200)}...</code>
              </pre>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-[#252C36] p-5">
          <div className="text-[11px] text-[#9AA4B2]">
            Target: Open directly in Google Colab or JupyterLab.
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-[#3A4452] bg-transparent text-[#E6EAF0] text-xs font-medium hover:bg-[#161B22] transition"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[#3DD6B5]" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copied' : 'Copy JSON'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#3DD6B5] text-[#0E1116] text-xs font-semibold hover:bg-[#34c4a4] transition"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download .ipynb</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

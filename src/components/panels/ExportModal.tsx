import React from 'react';
import { X, Download } from 'lucide-react';
import rawWorkspace from '../../../fixtures/workspace.json';
import { HERO_EXPERIMENT_SPEC_RUN_A } from '../../server/planner';

function buildReproducibleNotebook(spec = HERO_EXPERIMENT_SPEC_RUN_A) {
  const scriptCode = spec.files['main.py'] || '';
  const dataset = spec.datasets[0];
  const checks = spec.criteria.checks;

  return JSON.stringify(
    {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: [
            '# Reproducibility Record: Strobl et al. (2007)\n',
            '**Paper:** Strobl et al. (2007) *Bias in random forest variable importance measures: Illustrations, sources and a solution*\n',
            '**DOI:** `10.1186/1471-2105-8-25`\n',
            '**Claim (Verbatim):** "the variable importance measure of the original random forest method ... is artificially preferred for variables with many categories"\n',
            `**Mode:** ${spec.mode}\n`,
            '**Verdict Status:** Specification Preview\n',
          ],
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: [
            '# 1. Pinned dependencies install\n',
            '!pip install -q "scikit-learn==1.9.1" "pandas==2.2.0" "numpy==1.26.4"\n',
          ],
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: [
            '# 2. Dataset retrieval and verification\n',
            'import pathlib, urllib.request, hashlib\n',
            'data_dir = pathlib.Path("data")\n',
            'data_dir.mkdir(exist_ok=True)\n',
            `data_url = "${dataset?.url || 'https://raw.githubusercontent.com/datasets/breast-cancer/master/data/data.csv'}"\n`,
            `dest_path = data_dir / "${dataset?.name || 'breast-w'}.csv"\n`,
            'if not dest_path.exists():\n',
            '    urllib.request.urlretrieve(data_url, dest_path)\n',
            'data_bytes = dest_path.read_bytes()\n',
            'print(f"Cached {dest_path}: {len(data_bytes)} bytes, sha256={hashlib.sha256(data_bytes).hexdigest()[:16]}...")\n',
          ],
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: scriptCode.split('\n').map((line) => line + '\n'),
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: [
            '# 4. Display generated metrics\n',
            'import json, pathlib\n',
            'metrics_path = pathlib.Path("/output/metrics.json")\n',
            'if not metrics_path.exists():\n',
            '    metrics_path = pathlib.Path("metrics.json")\n',
            'if metrics_path.exists():\n',
            '    with open(metrics_path) as f:\n',
            '        metrics = json.load(f)\n',
            '    print(json.dumps(metrics, indent=2))\n',
            'else:\n',
            '    print("metrics.json not found")\n',
          ],
        },
        {
          cell_type: 'markdown',
          metadata: {},
          source: [
            '### Evaluation Criteria\n',
            ...checks.map(
              (c) =>
                `- Target check: \`${c.metric}\` ${c.op === 'lte' ? '<=' : c.op} ${c.value} -> evaluates whether high-cardinality noise is ranked among top predictors.\n`
            ),
          ],
        },
      ],
      metadata: {
        language_info: { name: 'python' },
      },
      nbformat: 4,
      nbformat_minor: 2,
    },
    null,
    2
  );
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

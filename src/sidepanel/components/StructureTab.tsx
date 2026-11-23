import { ChevronDown, ChevronRight, Code2, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  generateFaithfulSnapshot,
  generateStandaloneHtmlFile,
} from '../../core/faithfulSnapshot';
import {
  generateSimplifiedHtml,
  generateStructureReport,
} from '../../core/specGenerator';
import type { UiLanguage } from '../../storage/aiSettingsStore';
import type { CaptureRecord, ExtractedNode } from '../../types/capture';
import { getTranslations } from '../i18n/translations';
import { downloadText } from '../utils/download';
import { CopyButton } from './CopyButton';
import { Disclosure } from './Disclosure';

interface StructureTabProps {
  record: CaptureRecord;
  language?: UiLanguage;
}

export function StructureTab({ record, language = 'en' }: StructureTabProps) {
  const t = getTranslations(language);
  const [selectedNode, setSelectedNode] = useState<ExtractedNode | null>(record.roots[0] ?? null);
  const [codeMode, setCodeMode] = useState<'faithful' | 'skeleton'>('faithful');

  useEffect(() => {
    setSelectedNode(record.roots[0] ?? null);
  }, [record.id, record.roots]);

  const faithful = useMemo(() => generateFaithfulSnapshot(record), [record]);
  const skeleton = useMemo(() => generateSimplifiedHtml(record.roots), [record.roots]);
  const structureReport = useMemo(() => generateStructureReport(record), [record]);

  const handleDownloadStandaloneHtml = async () => {
    const htmlDoc = generateStandaloneHtmlFile(record);
    await downloadText(htmlDoc, `stylelens-${record.page.hostname}-recreation.html`, 'text/html');
  };

  if (record.roots.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[15px] font-semibold tracking-tight text-white">{t.codeTitle}</h1>
          <CopyButton text={structureReport} label={t.copyReport} copiedLabel={t.copied} />
        </div>
        <div className="sl-card rounded-xl p-4 text-[13px] text-zinc-400">{t.noHtmlExposed}</div>
      </div>
    );
  }

  const displayedCode = codeMode === 'faithful' ? faithful.combinedSnippet : skeleton;

  return (
    <div className="space-y-4 p-4">
      {/* Clean Header + Copy Report */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-white">{t.codeTitle}</h1>
          <p className="text-[12px] text-zinc-500">
            {t.elementsCount(record.totalNodesScanned, record.truncated)}
          </p>
        </div>
        <CopyButton
          text={structureReport}
          label={t.copyReport}
          copiedLabel={t.copied}
          title={t.copyReport}
        />
      </div>

      {/* Primary View: Runnable 1-to-1 HTML + CSS Recreation */}
      <section className="sl-card overflow-hidden rounded-xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2">
          <div className="inline-flex rounded-md border border-white/[0.08] bg-[#0b0b0d] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setCodeMode('faithful')}
              className={`rounded px-2 py-1 font-medium transition ${
                codeMode === 'faithful' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t.faithfulCodeBtn}
            </button>
            <button
              type="button"
              onClick={() => setCodeMode('skeleton')}
              className={`rounded px-2 py-1 font-medium transition ${
                codeMode === 'skeleton' ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t.cleanHtmlBtn}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <CopyButton
              text={displayedCode}
              label={t.copyBtn}
              copiedLabel={t.copied}
              className="py-1 text-[11.5px]"
            />
            <button
              type="button"
              onClick={() => void handleDownloadStandaloneHtml()}
              className="sl-btn-carbon flex h-[28px] items-center gap-1 rounded-lg px-2 text-[11px]"
              title="Download standalone runnable .html file with exact fonts & CSS"
            >
              <Download className="h-3 w-3" />
              .html
            </button>
          </div>
        </div>
        <pre className="sl-mono max-h-64 overflow-auto bg-[#0b0b0d] p-4 text-[11px] leading-relaxed text-zinc-300">
          {displayedCode}
        </pre>
      </section>

      {/* Progressive Disclosure: Full Interactive Element Tree & Computed CSS Inspector */}
      <Disclosure title={t.inspectElementsTitle} subtitle={t.inspectElementsSub}>
        <div className="space-y-3.5">
          <div className="max-h-52 overflow-auto rounded-lg border border-white/[0.07] bg-[#0b0b0d] p-2.5">
            {record.roots.map((root) => (
              <TreeNodeRow
                key={root.id}
                node={root}
                depth={0}
                selectedId={selectedNode?.id ?? null}
                onSelect={setSelectedNode}
              />
            ))}
          </div>

          {selectedNode && (
            <div className="space-y-3 rounded-lg border border-white/[0.07] bg-[#0b0b0d] p-3">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] pb-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5 shrink-0 text-white" />
                  <span className="sl-mono truncate text-[12px] font-semibold text-white">
                    &lt;{selectedNode.tag}&gt;
                  </span>
                </div>
                <span className="sl-mono shrink-0 text-[11px] text-zinc-400">
                  {selectedNode.rect.width}×{selectedNode.rect.height}px
                </span>
              </div>

              {(selectedNode.cleanClasses.length > 0 || selectedNode.omittedHashedClassCount > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedNode.cleanClasses.map((cls) => (
                    <span
                      key={cls}
                      className="sl-mono rounded border border-white/[0.08] bg-[#141418] px-1.5 py-0.5 text-[10.5px] text-zinc-200"
                    >
                      .{cls}
                    </span>
                  ))}
                  {selectedNode.omittedHashedClassCount > 0 && (
                    <span className="sl-mono text-[10.5px] text-zinc-500">
                      +{selectedNode.omittedHashedClassCount} hashed removed
                    </span>
                  )}
                </div>
              )}

              <div className="divide-y divide-white/[0.05]">
                {Object.entries(selectedNode.styles)
                  .filter(([, val]) => val !== undefined && val !== '')
                  .map(([prop, val]) => (
                    <div
                      key={prop}
                      className="sl-mono flex items-start justify-between gap-3 py-1.5 text-[11px]"
                    >
                      <span className="shrink-0 text-zinc-500">{prop}</span>
                      <span className="break-all text-right text-zinc-200">{val}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}

interface TreeNodeRowProps {
  node: ExtractedNode;
  depth: number;
  selectedId: string | null;
  onSelect: (node: ExtractedNode) => void;
}

function TreeNodeRow({ node, depth, selectedId, onSelect }: TreeNodeRowProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelect(node)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(node);
          }
        }}
        className={`sl-mono flex cursor-pointer items-center gap-1 rounded py-1 pr-2 text-[11.5px] transition ${
          isSelected
            ? 'bg-white/12 text-white'
            : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500 hover:text-white"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <span className="text-zinc-100">{node.tag}</span>
        {node.cleanClasses[0] && (
          <span className="truncate text-zinc-500">.{node.cleanClasses[0]}</span>
        )}
        {(node.styles.display === 'flex' || node.styles.display === 'grid') && (
          <span className="ml-auto shrink-0 text-[10px] text-zinc-500">{node.styles.display}</span>
        )}
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

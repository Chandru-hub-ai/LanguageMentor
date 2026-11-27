import React, { useState } from 'react';
import type { DiagramSpec } from '../types';

interface DiagramRendererProps {
  diagram: DiagramSpec;
}

const DiagramRenderer: React.FC<DiagramRendererProps> = ({ diagram }) => {
  const [activeIndex, setActiveIndex] = useState<number>(0);

  if (!diagram?.nodes || diagram.nodes.length === 0) return null;

  const nodes = diagram.nodes;
  const activeNode = nodes[activeIndex] || nodes[0];

  const boxWidth = 170;
  const boxHeight = 64;
  const gapX = 48;
  const startX = 24;
  const svgWidth = Math.max(540, nodes.length * (boxWidth + gapX));
  const svgHeight = 148;

  return (
    <div className="my-4 rounded-2xl lm-inset p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-ui font-semibold uppercase tracking-wider lm-accent-text">
            Visual Model • {diagram.kind}
          </div>
          <h5 className="font-display font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
            {diagram.title}
          </h5>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveIndex((prev) => (prev - 1 + nodes.length) % nodes.length)}
            className="px-3 py-1 rounded-full lm-btn-outline text-xs font-medium"
            aria-label="Previous step"
          >
            Prev
          </button>
          <span className="text-xs font-mono tabular-nums px-2" style={{ color: 'var(--text-muted)' }}>
            {activeIndex + 1}/{nodes.length}
          </span>
          <button
            type="button"
            onClick={() => setActiveIndex((prev) => (prev + 1) % nodes.length)}
            className="px-3.5 py-1 rounded-full lm-btn-primary text-xs font-medium"
            aria-label="Next step"
          >
            Step Forward
          </button>
        </div>
      </div>

      {/* Interactive Horizontal SVG Schematic */}
      <div className="overflow-x-auto pb-1 rounded-xl bg-black/90 border border-white/10 p-2">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full min-w-[520px] h-36 select-none"
          role="img"
          aria-label={diagram.title}
        >
          <defs>
            <marker
              id="lm-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#39FF14" />
            </marker>
          </defs>

          {nodes.map((node, idx) => {
            const x = startX + idx * (boxWidth + gapX);
            const y = 36;
            const isActive = idx === activeIndex;
            const nextX = x + boxWidth + gapX;

            const matchingEdge = diagram.edges.find(
              (e) =>
                e.from === node.id &&
                nodes[idx + 1] &&
                e.to === nodes[idx + 1].id
            );

            return (
              <g key={node.id}>
                {idx < nodes.length - 1 && (
                  <g>
                    <line
                      x1={x + boxWidth + 4}
                      y1={y + boxHeight / 2}
                      x2={nextX - 6}
                      y2={y + boxHeight / 2}
                      stroke={isActive ? '#39FF14' : 'rgba(255,255,255,0.38)'}
                      strokeWidth="1.75"
                      strokeDasharray={isActive ? undefined : '4 3'}
                      markerEnd="url(#lm-arrow)"
                    />
                    {matchingEdge?.label && (
                      <text
                        x={x + boxWidth + gapX / 2}
                        y={y + boxHeight / 2 - 10}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.6)"
                        fontSize="10"
                        fontWeight="600"
                      >
                        {matchingEdge.label.slice(0, 14)}
                      </text>
                    )}
                  </g>
                )}

                <g
                  onClick={() => setActiveIndex(idx)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={boxWidth}
                    height={boxHeight}
                    rx="12"
                    fill={isActive ? 'rgba(57, 255, 20, 0.12)' : 'rgba(255, 255, 255, 0.04)'}
                    stroke={isActive ? '#39FF14' : 'rgba(255, 255, 255, 0.22)'}
                    strokeWidth={isActive ? '2' : '1.1'}
                  />
                  <text
                    x={x + 12}
                    y={y + 22}
                    fill={isActive ? '#39FF14' : 'rgba(255, 255, 255, 0.5)'}
                    fontSize="10"
                    fontWeight="700"
                  >
                    {node.role ? node.role.toUpperCase() : `STAGE ${idx + 1}`}
                  </text>
                  <text
                    x={x + 12}
                    y={y + 44}
                    fill="#ffffff"
                    fontSize="12.5"
                    fontWeight="600"
                  >
                    {node.label.length > 21 ? `${node.label.slice(0, 19)}..` : node.label}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Node Detail Bar */}
      <div className="p-3 rounded-xl lm-surface flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div>
          <span className="font-bold lm-accent-text">{activeNode.label}: </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {activeNode.detail || diagram.caption || 'Click any node or use Step Forward to trace the flow.'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default DiagramRenderer;

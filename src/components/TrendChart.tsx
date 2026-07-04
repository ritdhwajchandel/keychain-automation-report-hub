import React, { useState } from 'react';
import type { WorkflowRunReport } from '../services/github';
import { getRunStats, isRunAnalyzed } from '../services/insights';

interface TrendChartProps {
  runs: WorkflowRunReport[]; // newest first, as fetched
  onSelectRun: (run: WorkflowRunReport) => void;
}

const SERIES = [
  { key: 'failed' as const, name: 'Failed', color: 'var(--color-failure)' },
  { key: 'passed' as const, name: 'Passed', color: 'var(--color-success)' },
  { key: 'skipped' as const, name: 'Skipped', color: 'var(--color-skipped)' }
];

const CHART_HEIGHT = 120;

export const TrendChart: React.FC<TrendChartProps> = ({ runs, onSelectRun }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Oldest on the left so time reads left-to-right
  const ordered = [...runs].reverse();
  const stats = ordered.map(run => ({ run, stats: getRunStats(run), analyzed: isRunAnalyzed(run) }));
  const maxTotal = Math.max(...stats.map(s => s.stats.total), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Test results across runs
        </h3>
        <div className="legend-row">
          {SERIES.map(s => (
            <span key={s.key} className="legend-key">
              <span className="legend-key__swatch" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '0.5rem',
        height: CHART_HEIGHT + 30,
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '1.4rem',
        position: 'relative'
      }}>
        {stats.map(({ run, stats: s, analyzed }) => {
          const isHovered = hoveredId === run.id;
          const columnHeight = analyzed ? Math.max((s.total / maxTotal) * CHART_HEIGHT, 4) : CHART_HEIGHT * 0.4;

          return (
            <button
              key={run.id}
              onClick={() => onSelectRun(run)}
              onMouseEnter={() => setHoveredId(run.id)}
              onMouseLeave={() => setHoveredId(null)}
              title={analyzed ? undefined : `Run #${run.runNumber} not analyzed yet`}
              style={{
                flex: 1,
                maxWidth: '48px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.35rem',
                alignSelf: 'flex-end',
                position: 'relative',
                cursor: 'pointer'
              }}
            >
              {/* Column: stacked statuses, failed anchored at the baseline */}
              <div style={{
                width: '20px',
                height: `${columnHeight}px`,
                display: 'flex',
                flexDirection: 'column-reverse',
                gap: '2px',
                borderRadius: '4px 4px 2px 2px',
                overflow: 'hidden',
                border: analyzed ? 'none' : '1px dashed var(--border-color)',
                background: analyzed ? 'transparent' : 'rgba(255,255,255,0.015)',
                transition: 'transform 0.15s ease',
                transform: isHovered ? 'scaleX(1.2)' : 'none'
              }}>
                {analyzed && SERIES.map(series => {
                  const value = s[series.key];
                  if (value === 0) return null;
                  return (
                    <div
                      key={series.key}
                      style={{
                        height: `${(value / s.total) * 100}%`,
                        minHeight: '3px',
                        backgroundColor: series.color
                      }}
                    />
                  );
                })}
              </div>

              <span className="tabular-nums" style={{
                fontSize: '0.65rem',
                color: isHovered ? 'var(--text-primary)' : 'var(--text-muted)',
                position: 'absolute',
                bottom: '-1.3rem'
              }}>
                #{run.runNumber}
              </span>

              {isHovered && (
                <div className="hbar-tooltip" style={{ left: '50%', transform: 'translateX(-50%)', bottom: `${columnHeight + 12}px` }}>
                  <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'white', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.25rem', marginBottom: '0.1rem' }}>
                    Run #{run.runNumber}{analyzed && s.passRate !== null ? ` · ${s.passRate}% pass` : ''}
                  </div>
                  {analyzed ? SERIES.map(series => (
                    <div key={series.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: series.color, flexShrink: 0 }} />
                      <span style={{ color: 'var(--text-secondary)' }}>{series.name}:</span>
                      <span className="tabular-nums" style={{ fontWeight: 600, color: 'white' }}>{s[series.key]}</span>
                    </div>
                  )) : (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Not analyzed yet — click Analyze history</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

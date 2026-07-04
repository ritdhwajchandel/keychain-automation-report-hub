import React, { useState } from 'react';

interface ChartData {
  name: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: ChartData[];
  title?: string;
  size?: number;
}

export const DonutChart: React.FC<PieChartProps> = ({ data, title, size = 200 }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total = data.reduce((sum, item) => sum + item.value, 0);

  const radius = size * 0.35;
  const strokeWidth = size * 0.09;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Surface gap between segments (arc pixels); no gap when only one segment shows
  const visibleSegments = data.filter(d => d.value > 0);
  const gapPx = visibleSegments.length > 1 ? 3 : 0;

  const passedItem = data.find(d => d.name.toLowerCase() === 'passed');
  const passRate = total > 0 && passedItem ? Math.round((passedItem.value / total) * 100) : null;

  let accumulated = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', width: '100%' }}>
      {title && <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</h3>}

      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          {total === 0 ? (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke="var(--border-color)"
              strokeWidth={strokeWidth}
            />
          ) : (
            data.map((item, index) => {
              if (item.value === 0) return null;
              const segmentLength = (item.value / total) * circumference;
              const drawnLength = Math.max(segmentLength - gapPx, 2);
              const strokeDashoffset = -(accumulated + gapPx / 2);
              accumulated += segmentLength;

              const isHovered = activeIndex === index;

              return (
                <circle
                  key={item.name}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="transparent"
                  stroke={item.color}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={`${drawnLength} ${circumference - drawnLength}`}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="butt"
                  style={{
                    transition: 'stroke-width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                />
              );
            })
          )}
        </svg>

        {/* Center label */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}>
          {activeIndex !== null ? (
            <>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                {data[activeIndex].name}
              </span>
              <span style={{ fontSize: '1.6rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {data[activeIndex].value}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {total > 0 ? `${Math.round((data[activeIndex].value / total) * 100)}%` : '0%'}
              </span>
            </>
          ) : passRate !== null ? (
            <>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                Pass rate
              </span>
              <span style={{ fontSize: '1.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {passRate}%
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {total} tests
              </span>
            </>
          ) : (
            <>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                Total tests
              </span>
              <span style={{ fontSize: '1.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {total}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="legend-row" style={{ justifyContent: 'center' }}>
        {data.map((item, index) => (
          <div
            key={item.name}
            className="legend-key"
            style={{
              cursor: 'pointer',
              opacity: activeIndex === null || activeIndex === index ? 1 : 0.5,
              transition: 'opacity 0.2s ease'
            }}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            <span className="legend-key__swatch" style={{ backgroundColor: item.color }} />
            <span>{item.name}</span>
            <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface BarChartProps {
  data: {
    label: string;
    passed: number;
    failed: number;
    skipped: number;
  }[];
  title?: string;
}

const SERIES: { key: 'failed' | 'passed' | 'skipped'; name: string; color: string }[] = [
  { key: 'failed', name: 'Failed', color: 'var(--color-failure)' },
  { key: 'passed', name: 'Passed', color: 'var(--color-success)' },
  { key: 'skipped', name: 'Skipped', color: 'var(--color-skipped)' }
];

export const BarChart: React.FC<BarChartProps> = ({ data, title }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Failures are the story: sort failing projects to the top, then by size.
  // Anchoring the failed segment at the left baseline keeps failure magnitude
  // comparable across rows.
  const rows = [...data].sort((a, b) =>
    b.failed - a.failed ||
    (b.passed + b.failed + b.skipped) - (a.passed + a.failed + a.skipped)
  );

  const maxTotal = Math.max(...rows.map(r => r.passed + r.failed + r.skipped), 1);
  const allEmpty = rows.every(r => r.passed + r.failed + r.skipped === 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        {title && <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</h3>}
        <div className="legend-row">
          {SERIES.map(s => (
            <span key={s.key} className="legend-key">
              <span className="legend-key__swatch" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>

      {allEmpty ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No test results parsed for this run yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {rows.map((row, idx) => {
            const total = row.passed + row.failed + row.skipped;
            const isHovered = hoveredIndex === idx;

            return (
              <div
                key={row.label}
                className="hbar-row"
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <span className="hbar-row__label" title={row.label}>{row.label}</span>

                <div className="hbar-row__track">
                  {SERIES.map(s => {
                    const value = row[s.key];
                    if (value === 0) return null;
                    return (
                      <div
                        key={s.key}
                        className="hbar-row__segment"
                        style={{
                          width: `${(value / maxTotal) * 100}%`,
                          backgroundColor: s.color
                        }}
                      />
                    );
                  })}
                </div>

                <span className="hbar-row__value">{total}</span>

                {isHovered && (
                  <div className="hbar-tooltip">
                    <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--surface-3)', paddingBottom: '0.25rem', marginBottom: '0.1rem' }}>
                      {row.label} · {total} tests
                    </div>
                    {SERIES.map(s => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: s.color, flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-secondary)' }}>{s.name}:</span>
                        <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row[s.key]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

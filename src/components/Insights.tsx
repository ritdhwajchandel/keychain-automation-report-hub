import React, { useMemo, useState } from 'react';
import type { WorkflowRunReport, TestCase } from '../services/github';
import {
  clusterFailures, findFlakyTests, getSlowestTests, getAllTests, isRunAnalyzed, isPlaceholderTest, displayTestName
} from '../services/insights';
import {
  Layers, Repeat, Timer, Search, CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronRight
} from 'lucide-react';

interface InsightsProps {
  run: WorkflowRunReport;
  runs: WorkflowRunReport[];
}

const STATUS_ICON: Record<TestCase['status'], { Icon: React.ElementType; color: string }> = {
  passed: { Icon: CheckCircle2, color: 'var(--color-success)' },
  failed: { Icon: XCircle, color: 'var(--color-failure)' },
  skipped: { Icon: MinusCircle, color: 'var(--color-skipped)' }
};

const formatMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

const SectionCard: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string; className?: string; children: React.ReactNode }> =
  ({ icon, title, subtitle, className, children }) => (
    <div className={`card ${className || ''}`} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.6rem', marginBottom: '0.9rem' }}>
        <h3 style={{ fontSize: '0.95rem', color: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {icon} {title}
        </h3>
        {subtitle && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );

export const Insights: React.FC<InsightsProps> = ({ run, runs }) => {
  const [expandedCluster, setExpandedCluster] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TestCase['status']>('all');

  const clusters = useMemo(() => clusterFailures(run), [run]);
  const flaky = useMemo(() => findFlakyTests(runs), [runs]);
  const slowest = useMemo(() => getSlowestTests(run), [run]);
  const allTests = useMemo(() => getAllTests(run), [run]);
  const analyzedRunCount = useMemo(() => runs.filter(isRunAnalyzed).length, [runs]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTests.filter(t =>
      (statusFilter === 'all' || t.status === statusFilter) &&
      (!q || t.name.toLowerCase().includes(q) || t.project.toLowerCase().includes(q))
    );
  }, [allTests, query, statusFilter]);

  const RESULT_CAP = 150;
  const hasRealNames = allTests.some(t => !isPlaceholderTest(t.name));

  if (!isRunAnalyzed(run)) {
    return (
      <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        Test results for this run are still being parsed — insights will appear once counts are available.
      </div>
    );
  }

  return (
    <div className="insights-grid">

      {/* Defect categories (Allure-style failure grouping) */}
      <SectionCard
        className="insights-grid__full"
        icon={<Layers size={16} style={{ color: 'var(--color-failure)' }} />}
        title={`Categories (${clusters.length})`}
        subtitle="Failures grouped by error signature — one category spanning many projects usually means a shared root cause (environment, auth, data), not individual test bugs."
      >
        {clusters.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-success)' }}>No failures in this run. 🎉</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {clusters.map((cluster, idx) => {
              const isOpen = expandedCluster === idx;
              return (
                <div key={idx} style={{ border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.02)' }}>
                  <button
                    onClick={() => setExpandedCluster(isOpen ? null : idx)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', padding: '0.75rem', textAlign: 'left' }}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cluster.signature}>
                      {cluster.signature}
                    </span>
                    <span className="count-pill count-pill--failure" style={{ flexShrink: 0 }}>{cluster.count} test{cluster.count > 1 ? 's' : ''}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {cluster.projects.length} project{cluster.projects.length > 1 ? 's' : ''}
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 0.75rem 0.75rem 2.1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {cluster.projects.map(p => (
                          <span key={p} className="badge badge-indigo" style={{ fontSize: '0.65rem', textTransform: 'none' }}>{p}</span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '160px', overflowY: 'auto' }}>
                        {cluster.tests.map((t, i) => (
                          <span key={i} style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${t.project} › ${t.name}`}>
                            <span style={{ color: 'var(--text-muted)' }}>{t.project} ›</span> {t.name}
                          </span>
                        ))}
                      </div>
                      {cluster.sampleError && (
                        <pre className="test-row__error" style={{ margin: 0 }}>{cluster.sampleError}</pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Flaky candidates */}
      <SectionCard
        icon={<Repeat size={16} style={{ color: 'var(--color-skipped)' }} />}
        title={`Flaky Candidates (${flaky.length})`}
        subtitle={`Tests that both passed and failed across the analyzed run history (${analyzedRunCount} run${analyzedRunCount === 1 ? '' : 's'} analyzed). Fix or quarantine these before trusting red builds.`}
      >
        {analyzedRunCount < 2 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Needs at least two analyzed runs — go back to the runs list and click <strong>Analyze history</strong> to build cross-run data.
          </p>
        ) : flaky.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-success)' }}>No flaky tests detected across the analyzed runs.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '300px', overflowY: 'auto' }}>
            {flaky.slice(0, 20).map((t, i) => (
              <div key={i} className="test-row" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
                <span className="test-row__main">
                  <Repeat size={13} style={{ color: 'var(--color-skipped)', flexShrink: 0 }} />
                  <span className="test-row__name" title={`${t.project} › ${t.name}`}>
                    <span style={{ color: 'var(--text-muted)' }}>{t.project} › </span>{displayTestName(t.name)}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', paddingLeft: '1.35rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {/* Status timeline: oldest → newest */}
                  {[...t.history].reverse().map((h, hi) => (
                    <span
                      key={hi}
                      title={`Run #${h.runNumber}: ${h.status}`}
                      style={{
                        width: '8px', height: '8px', borderRadius: '2px', display: 'inline-block',
                        backgroundColor: h.status === 'passed' ? 'var(--color-success)' : h.status === 'failed' ? 'var(--color-failure)' : 'var(--color-skipped)'
                      }}
                    />
                  ))}
                  <span className="tabular-nums" style={{ marginLeft: '0.35rem' }}>{t.failCount}/{t.history.length} failed</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Slowest tests */}
      <SectionCard
        icon={<Timer size={16} style={{ color: 'var(--color-info)' }} />}
        title="Slowest Tests"
        subtitle="Longest-running tests in this run — the first place to look when the pipeline gets slower."
      >
        {slowest.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No per-test durations were found in this run's logs.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {slowest.map((t, i) => (
              <div key={i} className="test-row" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
                <span className="test-row__name" title={`${t.project} › ${t.name}`}>
                  <span style={{ color: 'var(--text-muted)' }}>{t.project} › </span>{displayTestName(t.name)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div className="hbar-row__track" style={{ height: '8px', flex: 1 }}>
                    <div className="hbar-row__segment" style={{ width: `${(t.duration / slowest[0].duration) * 100}%`, backgroundColor: 'var(--color-info)', borderRadius: '2px 4px 4px 2px' }} />
                  </div>
                  <span className="hbar-row__value tabular-nums" style={{ flexShrink: 0, minWidth: '44px', textAlign: 'right' }}>{formatMs(t.duration)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Cross-project test explorer */}
      <SectionCard
        className="insights-grid__full"
        icon={<Search size={16} style={{ color: 'var(--color-accent)' }} />}
        title={`Test Explorer (${allTests.length})`}
        subtitle="Search every test in this run across all projects."
      >
        {!hasRealNames && allTests.length > 0 && (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-skipped)', marginBottom: '0.6rem' }}>
            ⚠ This run's logs contained counts but no per-test names — names shown are placeholders.
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search test name or project…"
              className="input-field"
              style={{ paddingLeft: '2rem', padding: '0.5rem 0.75rem 0.5rem 2rem', fontSize: '0.8rem' }}
            />
          </div>
          {(['all', 'failed', 'passed', 'skipped'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`filter-chip ${statusFilter === f ? 'is-active' : ''} ${f !== 'all' ? `filter-chip--${f}` : ''}`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '380px', overflowY: 'auto', paddingRight: '0.25rem' }}>
          {searchResults.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem' }}>No tests match.</p>
          ) : searchResults.slice(0, RESULT_CAP).map((t, i) => {
            const { Icon, color } = STATUS_ICON[t.status];
            return (
              <div key={i} className="test-row" style={{ cursor: 'default' }}>
                <span className="test-row__main">
                  <Icon size={14} style={{ color, flexShrink: 0 }} />
                  <span className="test-row__name" title={`${t.project} › ${t.name}`}>
                    <span style={{ color: 'var(--text-muted)' }}>{t.project} › </span>{displayTestName(t.name)}
                  </span>
                </span>
                <span className="test-row__meta">
                  {t.duration > 0 && <span className="tabular-nums">{formatMs(t.duration)}</span>}
                </span>
              </div>
            );
          })}
          {searchResults.length > RESULT_CAP && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.4rem 0.5rem' }}>
              Showing first {RESULT_CAP} of {searchResults.length} — refine the search to narrow down.
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );
};

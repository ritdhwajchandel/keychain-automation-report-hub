import React, { useMemo, useState } from 'react';
import type { TestCase } from '../services/github';
import { displayTestName } from '../services/insights';
import { CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronRight, Search } from 'lucide-react';

type Filter = 'all' | 'passed' | 'failed' | 'skipped';

const STATUS_ICON: Record<TestCase['status'], { Icon: React.ElementType; color: string }> = {
  passed: { Icon: CheckCircle2, color: 'var(--color-success)' },
  failed: { Icon: XCircle, color: 'var(--color-failure)' },
  skipped: { Icon: MinusCircle, color: 'var(--color-skipped)' }
};

const formatTestDuration = (ms: number): string => {
  if (ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

interface TestListProps {
  tests: TestCase[];
}

export const TestList: React.FC<TestListProps> = ({ tests }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const counts = useMemo(() => ({
    all: tests.length,
    passed: tests.filter(t => t.status === 'passed').length,
    failed: tests.filter(t => t.status === 'failed').length,
    skipped: tests.filter(t => t.status === 'skipped').length
  }), [tests]);

  // Failures first so problems surface without scrolling; log order within groups
  const ordered = useMemo(() => {
    const rank: Record<TestCase['status'], number> = { failed: 0, skipped: 1, passed: 2 };
    return tests
      .map((test, index) => ({ test, index }))
      .sort((a, b) => rank[a.test.status] - rank[b.test.status] || a.index - b.index)
      .map(x => x.test);
  }, [tests]);

  const q = query.trim().toLowerCase();
  const visible = ordered.filter(t =>
    (filter === 'all' || t.status === filter) &&
    (!q || t.name.toLowerCase().includes(q))
  );

  const toggleExpanded = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'failed', label: 'Failed' },
    { key: 'passed', label: 'Passed' },
    { key: 'skipped', label: 'Skipped' }
  ];

  if (tests.length === 0) {
    return (
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
        No individual test results were found in this job's logs.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Search this project's tests */}
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          className="input-field"
          placeholder="Search tests in this project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: '2.1rem', fontSize: '0.8rem', padding: '0.5rem 0.75rem 0.5rem 2.1rem' }}
        />
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`filter-chip ${filter === f.key ? 'is-active' : ''} filter-chip--${f.key}`}
          >
            {f.label}
            <span className="filter-chip__count">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {/* Test rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '420px', overflowY: 'auto', paddingRight: '0.25rem' }}>
        {visible.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem' }}>
            {q ? `No tests match "${query.trim()}"` : `No ${filter} tests in this project.`}
          </p>
        ) : visible.map(test => {
          const { Icon, color } = STATUS_ICON[test.status];
          const hasDetails = test.status === 'failed' && !!test.error;
          const isOpen = expanded.has(test.name);
          const duration = formatTestDuration(test.duration);

          return (
            <div key={test.name}>
              <button
                onClick={() => hasDetails && toggleExpanded(test.name)}
                className="test-row"
                style={{ cursor: hasDetails ? 'pointer' : 'default', alignItems: 'flex-start' }}
                aria-expanded={hasDetails ? isOpen : undefined}
              >
                <span className="test-row__main" style={{ alignItems: 'flex-start' }}>
                  {hasDetails && (isOpen
                    ? <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
                    : <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />)}
                  <Icon size={14} style={{ color, flexShrink: 0, marginTop: '1px' }} />
                  <span className="test-row__name test-row__name--wrap" title={test.name}>{displayTestName(test.name)}</span>
                </span>
                <span className="test-row__meta">
                  {duration && <span className="tabular-nums">{duration}</span>}
                </span>
              </button>

              {hasDetails && isOpen && (
                <pre className="test-row__error">{test.error}</pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import type { WorkflowRunReport } from '../services/github';
import { ShieldAlert, CheckCircle } from 'lucide-react';

interface CompareRunsProps {
  runA: WorkflowRunReport; // Active Run
  runB: WorkflowRunReport; // Compare Run
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

// Commit messages can carry a full multi-paragraph body; clamp to a few lines
// and reveal the rest on demand
const ClampedText: React.FC<{ text: string; lines?: number }> = ({ text, lines = 6 }) => {
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  useEffect(() => {
    if (!expanded && ref.current) {
      setIsClamped(ref.current.scrollHeight > ref.current.clientHeight + 1);
    }
  }, [text, expanded, lines]);

  return (
    <span style={{ display: 'block', minWidth: 0 }}>
      <span
        ref={ref}
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          ...(expanded ? {} : {
            display: '-webkit-box',
            WebkitLineClamp: lines,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden'
          })
        }}
      >
        {text}
      </span>
      {(isClamped || expanded) && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ color: 'var(--color-accent)', fontSize: '0.72rem', fontWeight: 600, padding: '0.15rem 0', display: 'block' }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  );
};

export const CompareRuns: React.FC<CompareRunsProps> = ({ runA, runB }) => {
  const getTotals = (run: WorkflowRunReport) => {
    let passed = 0, failed = 0, skipped = 0, total = 0;
    run.jobs.forEach(j => {
      passed += j.allureReport.passed;
      failed += j.allureReport.failed;
      skipped += j.allureReport.skipped;
      total += j.allureReport.total;
    });
    return { passed, failed, skipped, total };
  };

  const statsA = getTotals(runA);
  const statsB = getTotals(runB);

  // Compute Regressions & Fixes
  const regressions: { suite: string; test: string; prevStatus: string; error?: string }[] = [];
  const fixes: { suite: string; test: string; prevError?: string }[] = [];

  runA.jobs.forEach(jobA => {
    const jobB = runB.jobs.find(j => j.name === jobA.name);
    if (jobB) {
      jobA.allureReport.tests.forEach(testA => {
        const testB = jobB.allureReport.tests.find(t => t.name === testA.name);
        if (testB) {
          if (testA.status === 'failed' && testB.status !== 'failed') {
            regressions.push({
              suite: jobA.name,
              test: testA.name,
              prevStatus: testB.status,
              error: testA.error
            });
          } else if (testA.status === 'passed' && testB.status === 'failed') {
            fixes.push({
              suite: jobA.name,
              test: testA.name,
              prevError: testB.error
            });
          }
        }
      });
    }
  });

  const durationDiff = runA.durationSeconds - runB.durationSeconds;
  const passedDiff = statsA.passed - statsB.passed;
  const failedDiff = statsA.failed - statsB.failed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'fadeIn 0.3s' }}>
      
      {/* Run A vs Run B Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        
        {/* Run A Info */}
        <div style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1rem',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '4px', backgroundColor: runA.conclusion === 'success' ? 'var(--color-success)' : 'var(--color-failure)' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Active Run A</span>
          <h3 style={{ fontSize: '1.1rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Run #{runA.runNumber}
            <span className={`badge ${runA.conclusion === 'success' ? 'badge-success' : 'badge-failure'}`} style={{ fontSize: '0.65rem' }}>
              {runA.conclusion}
            </span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span>📝 Commit: <code>{runA.commitSha}</code></span>
            <ClampedText text={runA.commitMessage} />
            <span>👤 Author: @{runA.triggerer}</span>
            <span>🕒 Executed: {new Date(runA.createdAt).toLocaleString()}</span>
          </div>
        </div>

        {/* Run B Info */}
        <div style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1rem',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '4px', backgroundColor: runB.conclusion === 'success' ? 'var(--color-success)' : 'var(--color-failure)' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Comparison Run B</span>
          <h3 style={{ fontSize: '1.1rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Run #{runB.runNumber}
            <span className={`badge ${runB.conclusion === 'success' ? 'badge-success' : 'badge-failure'}`} style={{ fontSize: '0.65rem' }}>
              {runB.conclusion}
            </span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span>📝 Commit: <code>{runB.commitSha}</code></span>
            <ClampedText text={runB.commitMessage} />
            <span>👤 Author: @{runB.triggerer}</span>
            <span>🕒 Executed: {new Date(runB.createdAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Comparisons Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        
        {/* Total Tests comparison */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL TESTS</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0' }}>{statsA.total} vs {statsB.total}</div>
          <span style={{ fontSize: '0.75rem', color: statsA.total - statsB.total >= 0 ? 'var(--color-success)' : 'var(--color-failure)' }}>
            {statsA.total - statsB.total >= 0 ? `+${statsA.total - statsB.total}` : statsA.total - statsB.total} tests
          </span>
        </div>

        {/* Passed comparison */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>PASSED TESTS</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0', color: 'var(--color-success)' }}>{statsA.passed} vs {statsB.passed}</div>
          <span style={{ fontSize: '0.75rem', color: passedDiff >= 0 ? 'var(--color-success)' : 'var(--color-failure)' }}>
            {passedDiff >= 0 ? `+${passedDiff}` : passedDiff} passed
          </span>
        </div>

        {/* Failed comparison */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>FAILED TESTS</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0', color: 'var(--color-failure)' }}>{statsA.failed} vs {statsB.failed}</div>
          <span style={{ fontSize: '0.75rem', color: failedDiff <= 0 ? 'var(--color-success)' : 'var(--color-failure)' }}>
            {failedDiff > 0 ? `+${failedDiff} regressions` : `${failedDiff} fixed`}
          </span>
        </div>

        {/* Duration comparison */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>EXECUTION DURATION</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0' }}>{formatDuration(runA.durationSeconds)} vs {formatDuration(runB.durationSeconds)}</div>
          <span style={{ fontSize: '0.75rem', color: durationDiff <= 0 ? 'var(--color-success)' : 'var(--color-failure)' }}>
            {durationDiff > 0 ? `${formatDuration(durationDiff)} slower` : durationDiff < 0 ? `${formatDuration(-durationDiff)} faster` : 'same duration'}
          </span>
        </div>

      </div>

      {/* Regressions list */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldAlert style={{ color: 'var(--color-failure)' }} size={20} /> Regressions in Run #{runA.runNumber} ({regressions.length})
        </h3>
        
        {regressions.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
            🎉 Excellent! No test regressions detected. No tests failed in Run #{runA.runNumber} that were previously passing/skipped in Run #{runB.runNumber}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {regressions.map((reg, index) => (
              <div 
                key={index}
                style={{
                  background: 'rgba(225, 29, 72, 0.03)',
                  border: '1px solid rgba(225, 29, 72, 0.15)',
                  borderRadius: '6px',
                  padding: '0.75rem 1rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{reg.suite} &gt; <code style={{ color: 'var(--color-failure)' }}>{reg.test}</code></span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Was previously: <strong style={{ textTransform: 'uppercase' }}>{reg.prevStatus}</strong></span>
                </div>
                {reg.error && (
                  <pre style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    background: '#070A12',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    color: '#FCA5A5',
                    overflowX: 'auto',
                    marginTop: '0.5rem',
                    border: '1px solid var(--surface-1)'
                  }}>{reg.error}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fixes List */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle style={{ color: 'var(--color-success)' }} size={20} /> Resolved Failures in Run #{runA.runNumber} ({fixes.length})
        </h3>
        
        {fixes.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
            No previously failed tests were fixed in this run.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {fixes.map((fix, index) => (
              <div 
                key={index}
                style={{
                  background: 'rgba(21, 128, 61, 0.03)',
                  border: '1px solid rgba(21, 128, 61, 0.15)',
                  borderRadius: '6px',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                  {fix.suite} &gt; <code style={{ color: 'var(--color-success)' }}>{fix.test}</code>
                </span>
                <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>FIXED</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

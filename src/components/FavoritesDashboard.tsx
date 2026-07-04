import React, { useEffect, useState } from 'react';
import { githubService } from '../services/github';
import type { GitHubRepo, GitHubWorkflow, WorkflowRunReport } from '../services/github';
import { applyRunHistory } from '../services/history';
import { getRunStats, isRunAnalyzed } from '../services/insights';
import { TrendChart } from './TrendChart';
import {
  Star, RefreshCw, CheckCircle2, XCircle, AlertTriangle, GitCompareArrows, ArrowRight, Calendar
} from 'lucide-react';

interface FavoritesDashboardProps {
  repos: GitHubRepo[]; // bookmarked repos
  favoriteWorkflows: Record<string, number[]>;
  onOpen: (repo: GitHubRepo, workflow: GitHubWorkflow, opts?: { runId?: string; compare?: boolean }) => void;
}

interface DashboardEntry {
  key: string;
  repo: GitHubRepo;
  workflow: GitHubWorkflow;
  runs: WorkflowRunReport[];
}

const RECENT_RUNS = 5;

const conclusionIcon = (conclusion: string) => {
  switch (conclusion) {
    case 'success': return <CheckCircle2 size={15} style={{ color: 'var(--color-success)' }} />;
    case 'failure': return <XCircle size={15} style={{ color: 'var(--color-failure)' }} />;
    default: return <AlertTriangle size={15} style={{ color: 'var(--color-skipped)' }} />;
  }
};

export const FavoritesDashboard: React.FC<FavoritesDashboardProps> = ({ repos, favoriteWorkflows, onOpen }) => {
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const favSignature = JSON.stringify(
    repos.map(r => [r.fullName, favoriteWorkflows[r.fullName] || []])
  );

  useEffect(() => {
    const targets = repos.filter(r => (favoriteWorkflows[r.fullName] || []).length > 0);
    if (targets.length === 0) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const next: DashboardEntry[] = [];
      for (const repo of targets) {
        try {
          const workflows = await githubService.getWorkflows(repo.fullName);
          const favIds = favoriteWorkflows[repo.fullName] || [];
          for (const wfId of favIds) {
            const workflow = workflows.find(w => w.id === wfId);
            if (!workflow) continue;
            const runs = applyRunHistory(
              repo.fullName, workflow.id,
              await githubService.getWorkflowRuns(repo.fullName, workflow.id)
            );
            next.push({ key: `${repo.fullName}:${workflow.id}`, repo, workflow, runs });
            if (!cancelled) setEntries([...next]);
          }
        } catch (e) {
          console.error('Favorites dashboard load failed for', repo.fullName, e);
        }
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favSignature]);

  const hasFavorites = repos.some(r => (favoriteWorkflows[r.fullName] || []).length > 0);
  if (!hasFavorites) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Star size={18} fill="var(--color-skipped)" style={{ color: 'var(--color-skipped)' }} />
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
          Favorite Workflows
        </h2>
        {isLoading && <RefreshCw className="animate-spin" size={15} style={{ color: 'var(--color-accent)' }} />}
      </div>

      {entries.length === 0 && isLoading ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Loading favorite workflow health…
        </div>
      ) : entries.map(entry => {
        const analyzed = entry.runs.filter(isRunAnalyzed);
        const latest = entry.runs[0];
        const latestStats = latest ? getRunStats(latest) : null;
        const rates = analyzed.map(r => getRunStats(r).passRate).filter((r): r is number => r !== null);
        const avgRate = rates.length ? Math.round(rates.reduce((s, r) => s + r, 0) / rates.length) : null;

        return (
          <div key={entry.key} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Card header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
                <h3 style={{ fontSize: '1.05rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Star size={14} fill="var(--color-skipped)" style={{ color: 'var(--color-skipped)', flexShrink: 0 }} />
                  {entry.workflow.name}
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{entry.repo.fullName}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                {latest && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {conclusionIcon(latest.conclusion)}
                    Last run {latestStats && latestStats.passRate !== null ? `· ${latestStats.passRate}% pass` : ''}
                  </div>
                )}
                {avgRate !== null && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Avg <strong className="tabular-nums" style={{ color: 'var(--color-highlight)' }}>{avgRate}%</strong>
                  </div>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                  onClick={() => onOpen(entry.repo, entry.workflow)}
                >
                  Open workflow <ArrowRight size={12} />
                </button>
              </div>
            </div>

            {/* Trend across runs (only meaningful once some runs are analyzed) */}
            {analyzed.length > 0 && (
              <TrendChart runs={entry.runs} onSelectRun={(run) => onOpen(entry.repo, entry.workflow, { runId: run.id })} />
            )}

            {/* Previous runs with compare + details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>
                Previous runs
              </span>
              {entry.runs.slice(0, RECENT_RUNS).map((run, idx) => {
                const stats = getRunStats(run);
                const hasBaseline = idx + 1 < entry.runs.length;
                return (
                  <div
                    key={run.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                      padding: '0.5rem 0.65rem', borderRadius: '6px', background: 'var(--surface-1)',
                      border: '1px solid var(--border-color)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
                      {conclusionIcon(run.conclusion)}
                      <strong style={{ fontSize: '0.82rem', color: 'var(--text-primary)', flexShrink: 0 }}>#{run.runNumber}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                        <Calendar size={11} /> {new Date(run.createdAt).toLocaleDateString()}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {run.commitMessage.split('\n')[0]}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                      {stats.failed > 0 && <span className="count-pill count-pill--failure">{stats.failed} ✕</span>}
                      {stats.passRate !== null && (
                        <span className="tabular-nums" style={{ fontSize: '0.78rem', fontWeight: 600, color: stats.failed > 0 ? 'var(--text-primary)' : 'var(--color-success)' }}>
                          {stats.passRate}%
                        </span>
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem', gap: '0.25rem' }}
                        disabled={!hasBaseline}
                        title={hasBaseline ? `Compare #${run.runNumber} against #${entry.runs[idx + 1].runNumber}` : 'No earlier run to compare against'}
                        onClick={() => onOpen(entry.repo, entry.workflow, { runId: run.id, compare: true })}
                      >
                        <GitCompareArrows size={11} /> Compare
                      </button>
                      <button
                        className="btn"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem', gap: '0.25rem', boxShadow: 'none' }}
                        onClick={() => onOpen(entry.repo, entry.workflow, { runId: run.id })}
                      >
                        Details <ArrowRight size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

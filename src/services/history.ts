import type { WorkflowRunReport, TestCase } from './github';

// Persisted analyzed-run history so trends, flaky detection, and per-run stats
// survive page reloads. Keyed per repo+workflow. Stack traces are stripped
// before saving (they dominate size and the selected run re-parses fresh logs
// with full errors anyway).

const PREFIX = 'run_history_v1:';
const MAX_HISTORIES = 8; // most-recently-saved repo+workflow entries kept

interface StoredTest {
  name: string;
  status: TestCase['status'];
  duration: number;
}

interface StoredReport {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  tests: StoredTest[];
}

interface StoredHistory {
  savedAt: number;
  // runId -> jobId -> report
  runs: Record<string, Record<string, StoredReport>>;
}

const keyFor = (repoFullName: string, workflowId: string | number): string =>
  `${PREFIX}${repoFullName}:${workflowId}`;

function buildHistory(runs: WorkflowRunReport[], includeTests: boolean): StoredHistory | null {
  const data: StoredHistory = { savedAt: Date.now(), runs: {} };
  runs.forEach(run => {
    const jobReports: Record<string, StoredReport> = {};
    run.jobs.forEach(job => {
      const r = job.allureReport;
      if (r.total === 0) return;
      jobReports[job.id] = {
        passed: r.passed,
        failed: r.failed,
        skipped: r.skipped,
        total: r.total,
        tests: includeTests
          ? r.tests.map(t => ({ name: t.name, status: t.status, duration: t.duration }))
          : []
      };
    });
    if (Object.keys(jobReports).length > 0) data.runs[run.id] = jobReports;
  });
  return Object.keys(data.runs).length > 0 ? data : null;
}

// Keep only the most recently saved histories
function pruneOldHistories(keepKey: string): void {
  const entries: { key: string; savedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX) || key === keepKey) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      entries.push({ key, savedAt: parsed.savedAt || 0 });
    } catch {
      localStorage.removeItem(key);
    }
  }
  entries
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(MAX_HISTORIES - 1)
    .forEach(e => localStorage.removeItem(e.key));
}

export function saveRunHistory(repoFullName: string, workflowId: string | number, runs: WorkflowRunReport[]): void {
  const full = buildHistory(runs, true);
  if (!full) return;
  const key = keyFor(repoFullName, workflowId);
  try {
    localStorage.setItem(key, JSON.stringify(full));
    pruneOldHistories(key);
  } catch {
    // Quota exceeded: evict other histories, then retry counts-only (still
    // enough for trends and per-run stats, just not cross-run flaky detection)
    try {
      pruneOldHistories(key);
      const slim = buildHistory(runs, false);
      if (slim) localStorage.setItem(key, JSON.stringify(slim));
    } catch {
      // Storage unavailable - persistence is best-effort
    }
  }
}

export function applyRunHistory(
  repoFullName: string,
  workflowId: string | number,
  runs: WorkflowRunReport[]
): WorkflowRunReport[] {
  let stored: StoredHistory | null = null;
  try {
    const raw = localStorage.getItem(keyFor(repoFullName, workflowId));
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    return runs;
  }
  if (!stored || !stored.runs) return runs;

  return runs.map(run => {
    const jobReports = stored!.runs[run.id];
    if (!jobReports) return run;
    return {
      ...run,
      jobs: run.jobs.map(job => {
        const report = jobReports[job.id];
        // Never clobber data that is already fresher than storage
        if (!report || job.allureReport.total > 0) return job;
        return {
          ...job,
          allureReport: {
            passed: report.passed,
            failed: report.failed,
            skipped: report.skipped,
            total: report.total,
            tests: (report.tests || []).map(t => ({ name: t.name, status: t.status, duration: t.duration }))
          }
        };
      })
    };
  });
}

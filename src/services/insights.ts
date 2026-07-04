import type { WorkflowRunReport, TestCase } from './github';

// Placeholder test entries are synthesized when logs contain counts but no
// per-test lines; they must never feed name-based analysis (flaky detection).
const PLACEHOLDER_TEST_RE = /_(?:passed|failed|skipped)_test_\d+$/;

export function isPlaceholderTest(name: string): boolean {
  return PLACEHOLDER_TEST_RE.test(name);
}

// Reduce a full Playwright test id to its human part for display:
//   "[os-vendor] › tests/os/vendor/vendor-management-p1.spec.ts:23:3 › @P1 Vendor Management › @VND-007 Create a vendor"
//   -> "@P1 Vendor Management › @VND-007 Create a vendor"
// The project is rendered separately in the UI and the file:line stays
// available via the tooltip (which shows the full name).
export function displayTestName(name: string): string {
  const parts = name.split(' › ').filter(part => {
    const seg = part.trim();
    if (/^\[[^\]]+\]$/.test(seg)) return false; // [project] prefix
    if (/\.(spec|test)\.[cm]?[jt]sx?(:\d+(:\d+)?)?$/i.test(seg)) return false; // file.spec.ts:23:3
    return true;
  });
  const result = parts.join(' › ').trim();
  return result || name;
}

export interface RunStats {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  passRate: number | null;
}

export function getRunStats(run: WorkflowRunReport): RunStats {
  let passed = 0, failed = 0, skipped = 0, total = 0;
  run.jobs.forEach(j => {
    passed += j.allureReport.passed;
    failed += j.allureReport.failed;
    skipped += j.allureReport.skipped;
    total += j.allureReport.total;
  });
  return { passed, failed, skipped, total, passRate: total > 0 ? Math.round((passed / total) * 100) : null };
}

// A run counts as analyzed once at least one test job has parsed counts
export function isRunAnalyzed(run: WorkflowRunReport): boolean {
  return run.jobs.some(j => j.allureReport.total > 0);
}

// --- Failure clustering -----------------------------------------------------

export interface FailureCluster {
  signature: string;
  sampleError: string;
  count: number;
  projects: string[];
  tests: { project: string; name: string }[];
}

// Normalize an error message so the "same" failure clusters together even
// when line numbers, ids, or durations differ between tests.
export function normalizeErrorSignature(error: string | undefined): string {
  if (!error || !error.trim()) return 'No error details captured';
  let sig = error.split('\n')[0].trim().replace(/^##\[error\]/, '');
  // Job-level noise that slipped through parsing carries no diagnostic value
  if (/Process completed with exit code/i.test(sig)) return 'No error details captured';
  sig = sig
    .replace(/'[^']*'/g, "'…'")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\/[^\s:,)]+/g, '<path>')
    .replace(/\d+(\.\d+)?(ms|s|m)?/g, '#');
  return sig.length > 140 ? sig.slice(0, 140) + '…' : sig;
}

export function clusterFailures(run: WorkflowRunReport): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();
  run.jobs.forEach(job => {
    job.allureReport.tests.forEach(test => {
      if (test.status !== 'failed') return;
      const signature = normalizeErrorSignature(test.error);
      let cluster = clusters.get(signature);
      if (!cluster) {
        cluster = { signature, sampleError: test.error || '', count: 0, projects: [], tests: [] };
        clusters.set(signature, cluster);
      }
      cluster.count++;
      if (!cluster.projects.includes(job.project)) cluster.projects.push(job.project);
      cluster.tests.push({ project: job.project, name: test.name });
    });
  });
  return Array.from(clusters.values()).sort((a, b) => b.count - a.count);
}

// --- Flaky detection across runs ---------------------------------------------

export interface FlakyCandidate {
  name: string;
  project: string;
  history: { runNumber: number; status: TestCase['status'] }[];
  failCount: number;
  passCount: number;
}

// A test is a flaky candidate when it both passed and failed across the
// analyzed run history (same project + test name).
export function findFlakyTests(runs: WorkflowRunReport[]): FlakyCandidate[] {
  const analyzed = runs.filter(isRunAnalyzed);
  if (analyzed.length < 2) return [];

  const byKey = new Map<string, FlakyCandidate>();
  analyzed.forEach(run => {
    run.jobs.forEach(job => {
      job.allureReport.tests.forEach(test => {
        if (isPlaceholderTest(test.name)) return;
        const key = `${job.project}::${test.name}`;
        let entry = byKey.get(key);
        if (!entry) {
          entry = { name: test.name, project: job.project, history: [], failCount: 0, passCount: 0 };
          byKey.set(key, entry);
        }
        entry.history.push({ runNumber: run.runNumber, status: test.status });
        if (test.status === 'failed') entry.failCount++;
        if (test.status === 'passed') entry.passCount++;
      });
    });
  });

  return Array.from(byKey.values())
    .filter(t => t.failCount > 0 && t.passCount > 0)
    .sort((a, b) => b.failCount - a.failCount || b.history.length - a.history.length);
}

// --- Slowest tests -------------------------------------------------------------

export interface SlowTest {
  name: string;
  project: string;
  duration: number;
}

export function getSlowestTests(run: WorkflowRunReport, limit = 8): SlowTest[] {
  const all: SlowTest[] = [];
  run.jobs.forEach(job => {
    job.allureReport.tests.forEach(test => {
      if (test.duration > 0) all.push({ name: test.name, project: job.project, duration: test.duration });
    });
  });
  return all.sort((a, b) => b.duration - a.duration).slice(0, limit);
}

// --- Cross-project test search ---------------------------------------------------

export interface SearchableTest extends TestCase {
  project: string;
}

export function getAllTests(run: WorkflowRunReport): SearchableTest[] {
  const all: SearchableTest[] = [];
  run.jobs.forEach(job => {
    job.allureReport.tests.forEach(test => {
      all.push({ ...test, project: job.project });
    });
  });
  return all;
}

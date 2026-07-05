export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number; // in ms
  error?: string;
}

export interface AllureReport {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  tests: TestCase[];
}

export interface JobStep {
  name: string;
  status: 'success' | 'failure' | 'skipped' | 'queued' | 'in_progress';
  durationSeconds: number;
}

export interface JobExecution {
  id: string;
  name: string;            // e.g. "test (os-production)"
  project: string;         // e.g. "os-production"
  status: 'success' | 'failure' | 'skipped' | 'queued' | 'in_progress';
  durationSeconds: number;
  steps: JobStep[];
  allureReport: AllureReport;
  htmlUrl?: string;        // GitHub job page URL
}

// A downloadable artifact attached to a run (Playwright report, traces, screenshots)
export interface RunArtifact {
  id: number;
  name: string;            // e.g. "playwright-report-os-vendor", "traces-os-vendor"
  url: string;             // browser URL to download the artifact
  sizeInBytes: number;
  expired: boolean;
}

export interface WorkflowRunReport {
  id: string;
  runNumber: number;
  name: string;            // e.g. "Daily Full Regression (uat)"
  workflowName: string;    // e.g. "Daily Full Regression"
  workflowFile: string;    // e.g. "daily-full-regression.yml"
  event: string;           // e.g. "schedule"
  triggerer: string;       // e.g. "shuvamk"
  commitSha: string;
  commitMessage: string;
  status: string;          // e.g. "completed"
  conclusion: string;      // e.g. "failure"
  durationSeconds: number;
  createdAt: string;
  jobs: JobExecution[];
  htmlUrl?: string;        // GitHub run page URL (artifacts listed at bottom)
  repoFullName?: string;   // "owner/repo" — for building artifact/trace URLs
  artifacts?: RunArtifact[]; // fetched lazily when the run is opened
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  stars: number;
  forks: number;
  owner: {
    login: string;
    avatarUrl: string;
  };
}

export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface GitHubAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
  title?: string;
  raw_details?: string;
}

interface ParsedStats {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

// Strip ANSI escape codes and GitHub Actions timestamp prefixes from log text
function cleanLogText(logText: string): string {
  // Strip ANSI escape codes
  let cleaned = logText.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  // Strip GitHub Actions timestamp prefix from each line
  // Format: "2024-06-24T12:00:20.1234567Z " at start of line
  cleaned = cleaned.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\s*/gm, '');
  return cleaned;
}

// Build AllureReport from parsed stats and project name
function buildAllureFromStats(stats: ParsedStats, project: string): AllureReport {
  const tests: TestCase[] = [];
  const safeName = project.replace(/[^a-zA-Z0-9]/g, '_');
  for (let i = 0; i < stats.failed; i++) {
    tests.push({
      name: `${safeName}_failed_test_${i + 1}`,
      status: 'failed',
      duration: 0,
      error: `Test failure in project ${project}`
    });
  }
  for (let i = 0; i < stats.skipped; i++) {
    tests.push({
      name: `${safeName}_skipped_test_${i + 1}`,
      status: 'skipped',
      duration: 0
    });
  }
  for (let i = 0; i < stats.passed; i++) {
    tests.push({
      name: `${safeName}_passed_test_${i + 1}`,
      status: 'passed',
      duration: 0
    });
  }
  return { ...stats, tests };
}

// Parse logs text to extract accurate test counts
export function parseLogsForTestCounts(logText: string): ParsedStats | null {
  if (!logText) return null;
  const cleaned = cleanLogText(logText);
  const lines = cleaned.split('\n');
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // 1. First, search for JUnit / Maven style: "Tests run: 15, Failures: 1, Errors: 0, Skipped: 2"
  // This is highly specific.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const junitMatch = line.match(/Tests\s+run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i);
    if (junitMatch) {
      const run = parseInt(junitMatch[1], 10);
      const fails = parseInt(junitMatch[2], 10);
      const errors = parseInt(junitMatch[3], 10);
      const skips = parseInt(junitMatch[4], 10);
      failed = fails + errors;
      skipped = skips;
      passed = Math.max(0, run - failed - skipped);
      return { passed, failed, skipped, total: run };
    }
  }

  // 2. Pytest style: "== 15 passed, 1 failed, 2 skipped in 4.12s =="
  // Any subset of counts may appear (e.g. "== 3 failed in 12s ==" with no passed)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (/^=+.*\d+\s+(passed|failed|errors?|skipped).*=+$/i.test(line)) {
      const passM = line.match(/(\d+)\s+passed/i);
      const failM = line.match(/(\d+)\s+failed/i);
      const errM = line.match(/(\d+)\s+errors?/i);
      const skipM = line.match(/(\d+)\s+skipped/i);
      passed = passM ? parseInt(passM[1], 10) : 0;
      failed = (failM ? parseInt(failM[1], 10) : 0) + (errM ? parseInt(errM[1], 10) : 0);
      skipped = skipM ? parseInt(skipM[1], 10) : 0;
      return { passed, failed, skipped, total: passed + failed + skipped };
    }
  }

  // 3. Vitest / Jest style: "Tests:       3 failed, 12 passed, 15 total" or "Tests  1 failed | 15 passed"
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.match(/Tests:\s+/i) || line.match(/Tests\s+(\d+)\s+failed/i) || line.match(/Tests\s+(\d+)\s+passed/i)) {
      const passM = line.match(/(\d+)\s+passed/i);
      const failM = line.match(/(\d+)\s+failed/i);
      const skipM = line.match(/(\d+)\s+skipped/i);
      const totalM = line.match(/(\d+)\s+total/i);
      passed = passM ? parseInt(passM[1], 10) : 0;
      failed = failM ? parseInt(failM[1], 10) : 0;
      skipped = skipM ? parseInt(skipM[1], 10) : 0;
      const total = totalM ? parseInt(totalM[1], 10) : (passed + failed + skipped);
      return { passed, failed, skipped, total };
    }
  }

  // 4. Playwright final summary:
  // "  1 failed"
  // "  2 flaky"
  // "  3 skipped"
  // "  4 did not run"
  // "  5 passed (2.3s)"
  // The duration may attach to any of these lines and use ms/s/m/h units.
  // We scan backwards to find these lines cleanly.
  let p: number | null = null;
  let f: number | null = null;
  let s: number | null = null;
  let flaky: number | null = null;
  let didNotRun: number | null = null;
  let foundSummaryBlock = false;
  const duration = '(\\s+\\(\\d+(\\.\\d+)?(ms|s|m|h)\\))?';
  const passedRe = new RegExp(`^(\\d+)\\s+passed${duration}$`, 'i');
  const failedRe = new RegExp(`^(\\d+)\\s+failed${duration}$`, 'i');
  const skippedRe = new RegExp(`^(\\d+)\\s+skipped${duration}$`, 'i');
  const flakyRe = new RegExp(`^(\\d+)\\s+flaky${duration}$`, 'i');
  const didNotRunRe = new RegExp(`^(\\d+)\\s+(?:did not run|interrupted)${duration}$`, 'i');

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    let m: RegExpMatchArray | null = null;
    if (p === null && (m = line.match(passedRe))) {
      p = parseInt(m[1], 10);
      foundSummaryBlock = true;
    } else if (f === null && (m = line.match(failedRe))) {
      f = parseInt(m[1], 10);
      foundSummaryBlock = true;
    } else if (s === null && (m = line.match(skippedRe))) {
      s = parseInt(m[1], 10);
      foundSummaryBlock = true;
    } else if (flaky === null && (m = line.match(flakyRe))) {
      flaky = parseInt(m[1], 10);
      foundSummaryBlock = true;
    } else if (didNotRun === null && (m = line.match(didNotRunRe))) {
      didNotRun = parseInt(m[1], 10);
      foundSummaryBlock = true;
    }
    // Once past the summary block, stop at the run header so counts from
    // earlier output (retries, warnings) are not picked up.
    if (foundSummaryBlock && /^Running\s+\d+\s+tests?/i.test(line)) {
      break;
    }
  }

  if (foundSummaryBlock) {
    // Flaky tests passed on retry; "did not run"/interrupted tests were never executed.
    passed = (p || 0) + (flaky || 0);
    failed = f || 0;
    skipped = (s || 0) + (didNotRun || 0);
    return { passed, failed, skipped, total: passed + failed + skipped };
  }

  return null;
}

// Parse individual test result lines from logs (Playwright list reporter style):
//   "  ✓  4 [os-vendor] › tests/vendor.spec.ts:21:3 › creates vendor (3.2s)"
//   "  ✘  5 [os-vendor] › tests/vendor.spec.ts:40:3 › deletes vendor (5.1s)"
//   "  -  6 [os-vendor] › tests/vendor.spec.ts:60:3 › archived flow"
// Retried tests appear multiple times; the last occurrence wins.
export function parseLogsForTestCases(logText: string): TestCase[] | null {
  if (!logText) return null;
  const cleaned = cleanLogText(logText);
  const lines = cleaned.split('\n');

  // Optional "[tag]" prefixes before the marker, optional index number after it
  const passedRe = /^(?:\[[^\]]+\]\s*)*[✓✔]\s+(?:\d+\s+)?(.+)$/u;
  const failedRe = /^(?:\[[^\]]+\]\s*)*[✘✗×✕]\s+(?:\d+\s+)?(.+)$/u;
  const skippedRe = /^(?:\[[^\]]+\]\s*)*-\s+(?:\d+\s+)?(.+)$/u;
  const durationRe = /\s*\((\d+(?:\.\d+)?)(ms|s|m)\)$/i;

  const parseDurationMs = (rest: string): { name: string; duration: number } => {
    const m = rest.match(durationRe);
    if (!m) return { name: rest.trim(), duration: 0 };
    const value = parseFloat(m[1]);
    const ms = m[2].toLowerCase() === 'ms' ? value : m[2].toLowerCase() === 's' ? value * 1000 : value * 60000;
    return { name: rest.replace(durationRe, '').trim(), duration: Math.round(ms) };
  };

  // Playwright's failure-details section header at the end of the run:
  //   "  1) [os-inventory] › tests/intake.spec.ts:42:7 › Manual Intake › title ─────────"
  // The real stack trace follows it; requiring "›" keeps ordinary numbered
  // lines ("1) do this") from matching.
  const failureSectionRe = /^(?:##\[error\])?\s*\d+\)\s+(.+?)[\s─]*$/u;
  const summaryLineRe = /^\d+\s+(passed|failed|skipped|flaky|did not run|interrupted)/i;
  // GitHub Actions job-level noise, never a test error
  const jobNoiseRe = /Process completed with exit code/i;

  const byName = new Map<string, TestCase>();
  let collectingErrorFor: string | null = null;
  let collectingFromSection = false;
  let errorLines: string[] = [];

  const flushError = () => {
    if (collectingErrorFor && errorLines.length > 0) {
      const test = byName.get(collectingErrorFor);
      // The failure-details section is authoritative; inline capture only fills a gap
      if (test && (collectingFromSection || !test.error)) {
        test.error = errorLines.join('\n').trim();
      }
    }
    collectingErrorFor = null;
    collectingFromSection = false;
    errorLines = [];
  };

  const stripName = (rest: string): { name: string; duration: number } => {
    const parsed = parseDurationMs(rest);
    return { name: parsed.name.replace(/\s*\(retry #\d+\)$/i, ''), duration: parsed.duration };
  };

  for (const raw of lines) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;

    let status: TestCase['status'] | null = null;
    if ((m = line.match(passedRe))) {
      status = 'passed';
    } else if ((m = line.match(failedRe))) {
      status = 'failed';
    }
    if (m && status) {
      flushError();
      const { name, duration } = stripName(m[1]);
      if (!name) continue;
      byName.set(name, { name, status, duration });
      if (status === 'failed') collectingErrorFor = name;
      continue;
    }

    // "-" is too generic on its own; require an explicit skip suffix or a
    // Playwright "›" path separator so plain hyphen bullets don't match
    if ((m = line.match(skippedRe)) && (m[1].includes('(skipped)') || m[1].includes('›'))) {
      flushError();
      const { name } = stripName(m[1].replace(/\s*\(skipped\)$/i, ''));
      if (!name) continue;
      byName.set(name, { name, status: 'skipped', duration: 0 });
      continue;
    }

    // Failure-details section header: start collecting the real stack trace.
    // Also recovers failed-test names when the run used a reporter without
    // per-test lines (e.g. dot).
    if ((m = line.match(failureSectionRe)) && m[1].includes('›')) {
      flushError();
      const { name } = stripName(m[1]);
      if (!name) continue;
      if (!byName.has(name)) {
        byName.set(name, { name, status: 'failed', duration: 0 });
      }
      if (byName.get(name)!.status === 'failed') {
        collectingErrorFor = name;
        collectingFromSection = true;
      }
      continue;
    }

    // Accumulate stack-trace lines for the test currently being collected
    if (collectingErrorFor) {
      const content = raw.replace(/^\s*##\[error\]/, '').replace(/\s+$/, '');
      const trimmed = content.trim();
      const isNoise = trimmed.startsWith('##[') || jobNoiseRe.test(trimmed) || /^─+$/.test(trimmed);
      const isEnd = summaryLineRe.test(trimmed) ||
        (!collectingFromSection && (!trimmed || trimmed.startsWith('['))) ||
        errorLines.length >= 15;

      if (isEnd) {
        flushError();
      } else if (!isNoise && (trimmed || errorLines.length > 0)) {
        errorLines.push(content);
      }
    }
  }
  flushError();

  return byName.size > 0 ? Array.from(byName.values()) : null;
}

// Generate realistic deterministic Allure test results based on job name and status
export function generateAllureReport(jobName: string, status: string, seedInput: string): AllureReport {
  if (jobName === 'auth' || jobName === 'report' || !jobName.startsWith('test (')) {
    return { passed: 0, failed: 0, skipped: 0, total: 0, tests: [] };
  }

  let hash = 5381;
  for (let i = 0; i < seedInput.length; i++) {
    hash = ((hash << 5) + hash) + seedInput.charCodeAt(i);
  }
  const seed = Math.abs(hash);

  const cleanName = jobName.replace('test (', '').replace(')', '');
  
  // Custom test totals per project (differs based on seed)
  const total = 10 + (seed % 26);
  const isFailed = status === 'failure';
  const skipped = seed % 3;
  let failed = 0;
  if (isFailed) {
    failed = 1 + (seed % 3);
  }
  const passed = Math.max(0, total - failed - skipped);

  const tests: TestCase[] = [];
  for (let i = 1; i <= total; i++) {
    let testStatus: 'passed' | 'failed' | 'skipped' = 'passed';
    let error: string | undefined;

    if (i <= failed) {
      testStatus = 'failed';
      const errors = [
        `AssertionError: expected API response code 200 but got 500 (Internal Server Error)\n  at /tests/project-${cleanName}/endpoints.spec.ts:42`,
        `TimeoutError: waiting for Playwright locator 'button[type="submit"]' to be visible (exceeded 30000ms)\n  at /tests/project-${cleanName}/login.spec.ts:18`,
        `TypeError: Cannot read properties of undefined (reading 'body')\n  at /tests/project-${cleanName}/api-helpers.ts:114`
      ];
      error = errors[(seed + i) % errors.length];
    } else if (i > failed && i <= failed + skipped) {
      testStatus = 'skipped';
    }

    tests.push({
      name: `verify_project_${cleanName.replace(/[^a-zA-Z0-9]/g, '_')}_scenario_${i}`,
      status: testStatus,
      duration: 100 + ((seed * i) % 1800),
      error
    });
  }

  return { passed, failed, skipped, total, tests };
}

// Mock Workflows
export const MOCK_WORKFLOWS: GitHubWorkflow[] = [
  { id: 201, name: 'Daily Full Regression', path: '.github/workflows/daily-full-regression.yml', state: 'active' },
  { id: 202, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
  { id: 203, name: 'PR Checks', path: '.github/workflows/pr-checks.yml', state: 'active' },
  { id: 204, name: 'Run Regression Tests', path: '.github/workflows/regression-tests.yml', state: 'active' },
  { id: 205, name: 'Sync features to Gherkin Studio', path: '.github/workflows/gherkin-sync.yml', state: 'active' },
  { id: 206, name: 'pages-build-deployment', path: '.github/workflows/pages.yml', state: 'active' }
];

// Helper to generate mock jobs list
function generateMockJobs(runId: string, _repoName: string, conclusion: string): JobExecution[] {
  const seed = parseInt(runId.replace(/\D/g, '').substring(0, 5) || '12345', 10);
  
  const jobProjectNames = [
    'auth',
    'test (os-health)',
    'test (os-inventory)',
    'test (os-items-skus)',
    'test (os-purchasing)',
    'test (os-vendor)',
    'test (os-companies)',
    'test (os-production)',
    'test (os-operator-mode)',
    'test (os-settings)',
    'test (os-food-safety)',
    'test (os-documents)',
    'test (os-multi-facility)',
    'test (os-traceability)',
    'report'
  ];

  return jobProjectNames.map((jobName, idx) => {
    let jobStatus: 'success' | 'failure' | 'skipped' | 'in_progress' = 'success';
    // Latest run (12) has one in_progress job for demonstration
    if (runId.endsWith('12') && idx === 3) {
      jobStatus = 'in_progress';
    } else if (conclusion === 'failure') {
      const isFailedJob = (seed % 3 === 0 && idx === 9) || (seed % 4 === 0 && idx === 13) || (idx === 14);
      if (isFailedJob) {
        jobStatus = 'failure';
      }
    }

    const cleanProject = jobName.replace('test (', '').replace(')', '');
    const steps: JobStep[] = [
      { name: 'Set up job', status: 'success', durationSeconds: 2 },
      { name: 'Checkout code', status: 'success', durationSeconds: 0 },
      { name: 'Set up Node.js', status: 'success', durationSeconds: 3 },
      { name: 'Install dependencies', status: 'success', durationSeconds: idx === 0 ? 15 : 3 },
      { name: `Run project ${cleanProject}`, status: jobStatus, durationSeconds: 10 + ((seed + idx) % 40) },
      { name: 'Stage blob report', status: jobStatus, durationSeconds: 0 },
      { name: 'Upload blob report', status: jobStatus, durationSeconds: 0 },
      { name: 'Upload allure results', status: jobStatus, durationSeconds: 1 },
      { name: 'Complete job', status: jobStatus, durationSeconds: 0 }
    ];

    const allureReport = generateAllureReport(jobName, jobStatus, `${runId}_job_${idx}`);

    return {
      id: `${runId}_job_${idx}`,
      name: jobName,
      project: cleanProject,
      status: jobStatus,
      durationSeconds: steps.reduce((sum, s) => sum + s.durationSeconds, 0),
      steps,
      allureReport,
      htmlUrl: `https://github.com/${_repoName}/actions/runs/${runId}/job/${runId}_job_${idx}`
    };
  });
}

// Build plausible mock artifacts (one Playwright report + per-project traces for
// projects that had failures) so the demo shows the debug-artifacts feature.
function generateMockArtifacts(runId: string, fullName: string, jobs: JobExecution[]): RunArtifact[] {
  const artifacts: RunArtifact[] = [];
  let artifactId = parseInt(runId.replace(/\D/g, '').slice(-4) || '1000', 10) * 10;

  // A consolidated HTML report artifact always present
  artifacts.push({
    id: artifactId++,
    name: 'playwright-report',
    url: `https://github.com/${fullName}/actions/runs/${runId}/artifacts/${artifactId - 1}`,
    sizeInBytes: 4_200_000,
    expired: false
  });

  // Per-project trace bundles for projects that had failing tests
  jobs
    .filter(j => j.name.startsWith('test (') && j.allureReport.failed > 0)
    .forEach(j => {
      artifacts.push({
        id: artifactId++,
        name: `traces-${j.project}`,
        url: `https://github.com/${fullName}/actions/runs/${runId}/artifacts/${artifactId - 1}`,
        sizeInBytes: 1_800_000,
        expired: false
      });
    });

  return artifacts;
}

// Generate deterministic mock workflow runs
const mockWorkflowRunsCache: Record<string, WorkflowRunReport[]> = {};

function generateMockRuns(fullName: string): WorkflowRunReport[] {
  if (mockWorkflowRunsCache[fullName]) return mockWorkflowRunsCache[fullName];

  const runs: WorkflowRunReport[] = [];
  const baseTime = new Date();
  
  for (let i = 0; i < 12; i++) {
    const runNumber = 12 - i;
    const runId = `19803${runNumber}`;
    const date = new Date(baseTime.getTime() - i * 12 * 3600 * 1000);
    
    const conclusion = (i === 0 || i === 1 || i === 2 || i === 5 || i === 8) ? 'failure' : 'success';
    const jobs = generateMockJobs(runId, fullName.split('/')[1], conclusion);

    runs.push({
      id: runId,
      runNumber,
      name: `Daily Full Regression (uat) #${runNumber}`,
      workflowName: 'Daily Full Regression',
      workflowFile: 'daily-full-regression.yml',
      event: i % 3 === 0 ? 'schedule' : 'workflow_dispatch',
      triggerer: i % 2 === 0 ? 'shuvamk' : 'github-actions[bot]',
      commitSha: Math.random().toString(16).substring(2, 9),
      commitMessage: i % 2 === 0
        ? 'feat: updated service endpoints schema'
        : 'fix: solve payment timeout regressions\n\nRoot cause: the gateway client reused a stale connection pool after\nfailover, so requests queued past the 30s budget.\n\n- bump pool eviction to 5s idle\n- add retry with jitter on ECONNRESET\n- extend payment e2e coverage for degraded-gateway mode\n\nRefs: PAY-2214, PAY-2218',
      status: 'completed',
      conclusion,
      durationSeconds: jobs.reduce((sum, j) => sum + j.durationSeconds, 0),
      createdAt: date.toISOString(),
      jobs,
      htmlUrl: `https://github.com/${fullName}/actions/runs/${runId}`,
      repoFullName: fullName,
      artifacts: generateMockArtifacts(runId, fullName, jobs)
    });
  }

  mockWorkflowRunsCache[fullName] = runs;
  return runs;
}

export class GitHubService {
  private token: string | null = null;
  private isMockMode = true;
  // Cache enriched job data to avoid redundant API calls (keyed by runId_jobId)
  private enrichedJobCache: Map<string, AllureReport> = new Map();

  constructor() {
    this.token = localStorage.getItem('github_token');
    this.isMockMode = !this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('github_token', token);
      this.isMockMode = false;
      this.enrichedJobCache.clear();
    } else {
      localStorage.removeItem('github_token');
      this.isMockMode = true;
      this.enrichedJobCache.clear();
    }
  }

  getToken(): string | null {
    return this.token;
  }

  isMock(): boolean {
    return this.isMockMode;
  }

  async getUserInfo() {
    if (this.isMockMode) {
      return { login: 'shuvamk', name: 'Shuvam K', avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4' };
    }
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `token ${this.token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch user');
      const data = await res.json();
      return { login: data.login, name: data.name || data.login, avatarUrl: data.avatar_url };
    } catch (e) {
      console.error(e);
      return { login: 'shuvamk', name: 'Shuvam K (Auth Error)', avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4' };
    }
  }

  async getRepositories(query?: string): Promise<GitHubRepo[]> {
    const mockList: GitHubRepo[] = [
      {
        id: 401,
        name: 'keychain-testing',
        fullName: 'atlas-tech-inc/keychain-testing',
        description: 'End to End automation regression suites for Keychain ecosystem.',
        stars: 310,
        forks: 48,
        owner: { login: 'atlas-tech-inc', avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4' }
      },
      {
        id: 402,
        name: 'web-application-platform',
        fullName: 'acme-inc/web-application-platform',
        description: 'Core microservices and Playwright test layouts.',
        stars: 1240,
        forks: 312,
        owner: { login: 'acme-inc', avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4' }
      }
    ];

    if (this.isMockMode) {
      await new Promise(r => setTimeout(r, 400));
      if (!query) return mockList;
      return mockList.filter(r => r.name.toLowerCase().includes(query.toLowerCase()));
    }

    try {
      let url = 'https://api.github.com/user/repos?sort=updated&per_page=30';
      if (query) {
        url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+user:${(await this.getUserInfo()).login}`;
      }
      const res = await fetch(url, { headers: { Authorization: `token ${this.token}` } });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const repos = query ? data.items : data;
      return repos.map((r: any) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        description: r.description || 'Automation Repository',
        stars: r.stargazers_count,
        forks: r.forks_count,
        owner: { login: r.owner.login, avatarUrl: r.owner.avatar_url }
      }));
    } catch (e) {
      return mockList;
    }
  }

  async getWorkflows(repoFullName: string): Promise<GitHubWorkflow[]> {
    if (this.isMockMode) {
      return MOCK_WORKFLOWS;
    }
    try {
      const [owner, name] = repoFullName.split('/');
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}/actions/workflows`, {
        headers: { Authorization: `token ${this.token}` }
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      return data.workflows.map((w: any) => ({
        id: w.id,
        name: w.name,
        path: w.path,
        state: w.state
      }));
    } catch (e) {
      return MOCK_WORKFLOWS;
    }
  }

  // Get job logs text
  async getJobLogs(repoFullName: string, jobId: string, jobName: string, status: string, runId: string): Promise<string> {
    if (this.isMockMode) {
      await new Promise(r => setTimeout(r, 450));
      const allure = generateAllureReport(jobName, status, `${runId}_job_${jobId}`);
      const cleanProject = jobName.replace('test (', '').replace(')', '');
      
      let logs = `
2026-06-24T12:00:01Z [system] Setup job runners
2026-06-24T12:00:02Z [git] Checking out repository commit
2026-06-24T12:00:03Z [node] Node environment initialized (version: 20.10.0)
2026-06-24T12:00:05Z [npm] Installing packages: Playwright test libraries
2026-06-24T12:00:15Z [playwright] Executing e2e project target: ${cleanProject}
2026-06-24T12:00:16Z [playwright] Running tests with Playwright runner...
`;

      // Print tests
      allure.tests.forEach((test, idx) => {
        const time = (100 + (idx * 50)) / 1000;
        if (test.status === 'passed') {
          logs += `2026-06-24T12:00:18Z [playwright]   ✓  ${test.name} (${time}s)\n`;
        } else if (test.status === 'skipped') {
          logs += `2026-06-24T12:00:18Z [playwright]   -  ${test.name} (skipped)\n`;
        } else {
          logs += `2026-06-24T12:00:19Z [playwright]   ×  ${test.name} (${time}s)\n${test.error}\n`;
        }
      });

      logs += `
2026-06-24T12:00:20Z [playwright] Final test suite outcome:
2026-06-24T12:00:20Z [playwright]   ${allure.passed} passed
2026-06-24T12:00:20Z [playwright]   ${allure.failed} failed
2026-06-24T12:00:20Z [playwright]   ${allure.skipped} skipped
2026-06-24T12:00:21Z [allure] Uploading results artifact folder to pipeline storage
2026-06-24T12:00:22Z [system] Completed job execution task.
`;
      return logs;
    }

    try {
      const [owner, name] = repoFullName.split('/');
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}/actions/jobs/${jobId}/logs`, {
        headers: { Authorization: `token ${this.token}` }
      });
      if (!res.ok) throw new Error('Logs offline or token permissions insufficient.');
      return await res.text();
    } catch (e: any) {
      console.error(e);
      throw new Error(`Failed to fetch logs: ${e.message || e}`);
    }
  }

  // Fetch check run annotations for a specific job (real test results and failures)
  async getJobAnnotations(repoFullName: string, jobId: string): Promise<GitHubAnnotation[]> {
    if (this.isMockMode) return [];
    try {
      const [owner, name] = repoFullName.split('/');
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${name}/check-runs/${jobId}/annotations?per_page=100`,
        { headers: { Authorization: `token ${this.token}` } }
      );
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  // Enrich a job with real test data from GitHub annotations and/or log parsing
  async enrichJobData(repoFullName: string, job: JobExecution, runId: string): Promise<AllureReport> {
    if (!job.name.startsWith('test (')) {
      return job.allureReport;
    }

    // Check cache first to avoid redundant API calls
    const cacheKey = `${runId}_${job.id}`;
    const cached = this.enrichedJobCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const cleanProject = job.project;
    const safeName = cleanProject.replace(/[^a-zA-Z0-9]/g, '_');

    if (this.isMockMode) {
      // Mock mode: fetch mock logs and parse them for counts + test names
      try {
        const logs = await this.getJobLogs(repoFullName, job.id, job.name, job.status, runId);
        const stats = parseLogsForTestCounts(logs);
        if (stats) {
          const parsedTests = parseLogsForTestCases(logs);
          const report = parsedTests && parsedTests.length > 0
            ? { ...stats, tests: parsedTests }
            : buildAllureFromStats(stats, cleanProject);
          this.enrichedJobCache.set(cacheKey, report);
          return report;
        }
      } catch (e) {
        console.warn('Mock log parse failed:', e);
      }
      return job.allureReport;
    }

    // Real mode: fetch annotations and logs in parallel for accurate data
    const [annotationsResult, logsResult] = await Promise.allSettled([
      this.getJobAnnotations(repoFullName, job.id),
      this.getJobLogs(repoFullName, job.id, job.name, job.status, runId)
    ]);

    const annotations: GitHubAnnotation[] = annotationsResult.status === 'fulfilled' ? annotationsResult.value : [];
    const logText: string = logsResult.status === 'fulfilled' ? logsResult.value : '';

    // Try log parsing first - gives most accurate pass/fail/skip counts
    const logStats = parseLogsForTestCounts(logText);
    // Per-test result lines give real test names and durations
    const parsedTests = parseLogsForTestCases(logText);

    // Exclude GitHub's job-level "Process completed with exit code N" annotation
    // - it describes the job, not a test, and would pollute counts and clusters
    const isJobLevelAnnotation = (a: GitHubAnnotation) =>
      /Process completed with exit code/i.test(a.message || '') ||
      /Process completed with exit code/i.test(a.title || '');
    const failureAnnotations = annotations.filter(a => a.annotation_level === 'failure' && !isJobLevelAnnotation(a));
    const warningAnnotations = annotations.filter(a => a.annotation_level === 'warning');

    let passed = 0, failed = 0, skipped = 0, total = 0;
    const tests: TestCase[] = [];

    if (logStats && logStats.total > 0) {
      // Log parsing succeeded - use exact counts from log output
      passed = logStats.passed;
      failed = logStats.failed;
      skipped = logStats.skipped;
      total = logStats.total;
    } else if (parsedTests && parsedTests.length > 0) {
      // No summary line, but individual test result lines were found
      passed = parsedTests.filter(t => t.status === 'passed').length;
      failed = parsedTests.filter(t => t.status === 'failed').length;
      skipped = parsedTests.filter(t => t.status === 'skipped').length;
      total = parsedTests.length;
    } else if (failureAnnotations.length > 0) {
      // No log counts available - use annotation data for failure counts.
      // Warning annotations are NOT counted as skipped tests: they include
      // non-test noise like deprecation notices.
      failed = failureAnnotations.length;
      skipped = 0;
      passed = 0;
      total = failed;
    } else {
      // Minimal fallback: derive from job conclusion
      passed = job.status === 'success' ? 1 : 0;
      failed = job.status === 'failure' ? 1 : 0;
      skipped = job.status === 'skipped' ? 1 : 0;
      total = passed + failed + skipped;
    }

    if (parsedTests && parsedTests.length > 0) {
      // Real test names from the log; fill missing failure details from
      // annotations - match by title first, fall back to position
      const failedWithoutError = parsedTests.filter(t => t.status === 'failed' && !t.error);
      const unmatchedAnnotations: GitHubAnnotation[] = [];
      failureAnnotations.forEach(a => {
        const target = a.title
          ? failedWithoutError.find(t => !t.error && (t.name.includes(a.title!) || a.title!.includes(t.name)))
          : undefined;
        if (target) {
          target.error = `${a.message}\n  at ${a.path}:${a.start_line}`;
        } else {
          unmatchedAnnotations.push(a);
        }
      });
      let annotationIdx = 0;
      failedWithoutError.forEach(t => {
        if (!t.error && unmatchedAnnotations[annotationIdx]) {
          const a = unmatchedAnnotations[annotationIdx++];
          t.error = `${a.message}\n  at ${a.path}:${a.start_line}`;
        }
      });
      tests.push(...parsedTests);
    } else {
      // No per-test lines in the log - build placeholder entries from counts
      for (let i = 0; i < failed; i++) {
        const annotation = failureAnnotations[i];
        tests.push({
          name: annotation?.title || `${safeName}_failed_test_${i + 1}`,
          status: 'failed',
          duration: 0,
          error: annotation
            ? `${annotation.message}\n  at ${annotation.path}:${annotation.start_line}`
            : `Test failure in project ${cleanProject}`
        });
      }
      for (let i = 0; i < skipped; i++) {
        const annotation = warningAnnotations[i];
        tests.push({
          name: annotation?.title || `${safeName}_skipped_test_${i + 1}`,
          status: 'skipped',
          duration: 0
        });
      }
      for (let i = 0; i < passed; i++) {
        tests.push({
          name: `${safeName}_passed_test_${i + 1}`,
          status: 'passed',
          duration: 0
        });
      }
    }

    const result: AllureReport = { passed, failed, skipped, total, tests };
    // Only cache when the logs were actually retrieved. A transient log-fetch
    // failure would otherwise pin placeholder counts for this job forever.
    if (logsResult.status === 'fulfilled') {
      this.enrichedJobCache.set(cacheKey, result);
    }
    return result;
  }

  async getWorkflowRuns(repoFullName: string, workflowIdOrPath: string | number): Promise<WorkflowRunReport[]> {
    if (this.isMockMode) {
      await new Promise(r => setTimeout(r, 400));
      return generateMockRuns(repoFullName);
    }

    try {
      const [owner, name] = repoFullName.split('/');
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}/actions/workflows/${workflowIdOrPath}/runs?per_page=15`, {
        headers: { Authorization: `token ${this.token}` }
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const runs = data.workflow_runs;

      const results = await Promise.all(runs.map(async (run: any) => {
        let jobs: JobExecution[] = [];
        try {
          const jobsRes = await fetch(`https://api.github.com/repos/${owner}/${name}/actions/runs/${run.id}/jobs`, {
            headers: { Authorization: `token ${this.token}` }
          });
          if (jobsRes.ok) {
            const jobsData = await jobsRes.json();
            jobs = jobsData.jobs.map((job: any) => {
              const cleanProject = job.name.replace('test (', '').replace(')', '');
              const steps = (job.steps || []).map((step: any) => ({
                name: step.name,
                status: step.conclusion || 'queued',
                durationSeconds: step.started_at && step.completed_at
                  ? Math.round((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000)
                  : 0
              }));
              
              // Real mode: start with empty report, enriched by annotations/logs when user selects this run
              const allureReport: AllureReport = { passed: 0, failed: 0, skipped: 0, total: 0, tests: [] };

              return {
                id: String(job.id),
                name: job.name,
                project: cleanProject,
                status: job.conclusion || 'queued',
                durationSeconds: Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000) || 60,
                steps,
                allureReport,
                htmlUrl: job.html_url
              };
            });
          }
        } catch (jobErr) {
          // Do NOT substitute fabricated mock jobs for a real run - that would
          // display invented pass/fail counts. Show the run with no job data instead.
          console.error('Failed to fetch jobs for run', run.id, jobErr);
          jobs = [];
        }

        return {
          id: String(run.id),
          runNumber: run.run_number,
          name: `${run.name} #${run.run_number}`,
          workflowName: run.name || 'Daily Full Regression',
          workflowFile: run.path.split('/').pop() || 'main.yml',
          event: run.event,
          triggerer: run.triggering_actor.login,
          commitSha: run.head_sha.substring(0, 7),
          commitMessage: run.head_commit?.message || 'Run execution details',
          status: run.status,
          conclusion: run.conclusion || 'neutral',
          durationSeconds: Math.round((new Date(run.updated_at).getTime() - new Date(run.created_at).getTime()) / 1000) || 120,
          createdAt: run.created_at,
          jobs,
          htmlUrl: run.html_url,
          repoFullName
        };
      }));

      return results;
    } catch (e) {
      console.error(e);
      return generateMockRuns(repoFullName);
    }
  }

  // Fetch the downloadable artifacts (Playwright reports, traces, screenshots)
  // attached to a run. Called lazily when a run is opened.
  async getRunArtifacts(repoFullName: string, runId: string): Promise<RunArtifact[]> {
    if (this.isMockMode) {
      // Mock runs already carry their artifacts; nothing to fetch
      return [];
    }
    try {
      const [owner, name] = repoFullName.split('/');
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}/actions/runs/${runId}/artifacts`, {
        headers: { Authorization: `token ${this.token}` }
      });
      if (!res.ok) throw new Error(`Artifacts fetch failed: ${res.status}`);
      const data = await res.json();
      return (data.artifacts || []).map((a: any) => ({
        id: a.id,
        name: a.name,
        // Browser URL that downloads the artifact zip from the run page
        url: `https://github.com/${owner}/${name}/actions/runs/${runId}/artifacts/${a.id}`,
        sizeInBytes: a.size_in_bytes || 0,
        expired: !!a.expired
      }));
    } catch (e) {
      console.error('Failed to fetch run artifacts:', e);
      return [];
    }
  }
}

export const githubService = new GitHubService();

// Match a project to the artifacts most likely to hold its debug evidence.
// Playwright typically uploads per-project trace/report bundles named with the
// project (e.g. "traces-os-vendor"); a generic "playwright-report" is the
// consolidated fallback that covers all projects.
export function findArtifactsForProject(artifacts: RunArtifact[] | undefined, project: string): RunArtifact[] {
  if (!artifacts || artifacts.length === 0) return [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const p = norm(project);
  const specific = artifacts.filter(a => p && norm(a.name).includes(p));
  if (specific.length > 0) return specific;
  // Fall back to consolidated report/trace artifacts that cover every project
  return artifacts.filter(a => /report|trace|screenshot|playwright/i.test(a.name));
}

// Is this artifact a trace bundle (openable in trace.playwright.dev)?
export function isTraceArtifact(name: string): boolean {
  return /trace/i.test(name);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

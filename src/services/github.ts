export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number; // in ms
  error?: string;   // concise error signature (used for clustering + preview)
  log?: string;     // fuller per-test log block from the failure-details section
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
  durationSeconds: number; // final duration once completed; snapshot while running
  startedAt?: string;      // ISO start time — lets the UI tick a live timer while running
  completedAt?: string;    // ISO completion time (absent while running)
  steps: JobStep[];
  allureReport: AllureReport;
  htmlUrl?: string;        // GitHub job page URL
}

// A downloadable artifact attached to a run (Playwright report, traces, screenshots)
export interface RunArtifact {
  id: number;
  name: string;            // e.g. "playwright-report-checkout", "traces-checkout"
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
  triggerer: string;       // e.g. "demo-user"
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
//   "  ✓  4 [checkout] › tests/vendor.spec.ts:21:3 › creates order (3.2s)"
//   "  ✘  5 [checkout] › tests/vendor.spec.ts:40:3 › cancels order (5.1s)"
//   "  -  6 [checkout] › tests/vendor.spec.ts:60:3 › archived flow"
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
        const block = errorLines.join('\n').trim();
        // Full block = the per-test log; concise head = the error signature used
        // for clustering and the row preview.
        test.log = block;
        test.error = errorLines.slice(0, 15).join('\n').trim();
      }
    }
    collectingErrorFor = null;
    collectingFromSection = false;
    errorLines = [];
  };

  // Retry/re-mint attempts of the SAME test are printed as separate lines with
  // a trailing annotation (e.g. "(retry #1)", "(reminting session)",
  // "(session expired, reminting)"). Strip these so every attempt collapses to
  // one name and de-dupes via `byName` — otherwise the project's test list count
  // is inflated above the Allure/summary total, which counts each test once.
  const retryAnnotationRe = /\s*\((?:retry|attempt|re-?mint(?:ing|ed)?|session\s*expired)[^)]*\)\s*$/i;
  const stripName = (rest: string): { name: string; duration: number } => {
    const parsed = parseDurationMs(rest);
    // A test may pick up more than one attempt annotation; strip repeatedly.
    let name = parsed.name;
    let prev;
    do { prev = name; name = name.replace(retryAnnotationRe, ''); } while (name !== prev);
    return { name: name.trim(), duration: parsed.duration };
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
      // Keep the whole per-test failure block (error, code frame, call log) up
      // to a generous cap; inline (non-section) capture stays tighter since it
      // isn't clearly delimited. flushError splits out a concise error head.
      const isEnd = summaryLineRe.test(trimmed) ||
        (!collectingFromSection && (!trimmed || trimmed.startsWith('['))) ||
        errorLines.length >= (collectingFromSection ? 60 : 15);

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
    if (!this.token) {
      return { login: '', name: '', avatarUrl: '' };
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
      return { login: '', name: '', avatarUrl: '' };
    }
  }

  // Normalize a search term into "owner/repo" if the user pasted a full GitHub
  // URL or an "owner/repo" path; otherwise null (treat as a name search).
  private parseRepoRef(input: string): string | null {
    let s = input.trim();
    if (!s) return null;
    s = s.replace(/^git@github\.com:/i, '')
         .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
         .replace(/\.git$/i, '')
         .replace(/\/+$/, '');
    const m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
    return m ? `${m[1]}/${m[2]}` : null;
  }

  private mapRepo(r: any): GitHubRepo {
    return {
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description || 'Automation Repository',
      stars: r.stargazers_count,
      forks: r.forks_count,
      owner: { login: r.owner.login, avatarUrl: r.owner.avatar_url }
    };
  }

  async getRepositories(query?: string): Promise<GitHubRepo[]> {
    if (!this.token) return [];
    const headers = { Authorization: `token ${this.token}` };
    const q = (query || '').trim();

    // 1. Pasted an "owner/repo" or a GitHub URL — fetch that repo directly.
    // This reaches org and private repos that name search / the user-repos
    // listing may not surface (e.g. atlas-tech-inc/qa-automation).
    const ref = this.parseRepoRef(q);
    if (ref) {
      try {
        const res = await fetch(`https://api.github.com/repos/${ref}`, { headers });
        if (res.ok) return [this.mapRepo(await res.json())];
      } catch (e) {
        console.error('Direct repo lookup failed:', e);
      }
      // Not found / no access — fall through to a name search below
    }

    try {
      // List every repo the token can see — owner, collaborator, AND org member
      // — so org repos are included. Paginate up to 200 to cover larger accounts.
      const perPage = 100;
      const all: any[] = [];
      for (let page = 1; page <= 2; page++) {
        const res = await fetch(
          `https://api.github.com/user/repos?sort=updated&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`,
          { headers }
        );
        if (!res.ok) throw new Error('Failed to list repositories');
        const batch = await res.json();
        all.push(...batch);
        if (batch.length < perPage) break; // last page reached
      }

      let repos = all.map(r => this.mapRepo(r));
      if (q) {
        const ql = q.toLowerCase();
        repos = repos.filter(r =>
          r.fullName.toLowerCase().includes(ql) || r.name.toLowerCase().includes(ql)
        );
      }
      return repos;
    } catch (e) {
      console.error('Failed to fetch repositories:', e);
      return [];
    }
  }

  async getWorkflows(repoFullName: string): Promise<GitHubWorkflow[]> {
    if (!this.token) return [];
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
      console.error('Failed to fetch workflows:', e);
      return [];
    }
  }

  // Get job logs text
  async getJobLogs(repoFullName: string, jobId: string, _jobName: string, _status: string, _runId: string): Promise<string> {
    if (!this.token) return '';
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
    if (!this.token) return [];
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

    if (!this.token) {
      return job.allureReport;
    }

    // Fetch annotations and logs in parallel for accurate data
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
    if (!this.token) return [];
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

              // A running/queued job has no conclusion yet — fall back to its
              // live status ('in_progress'/'queued') so the UI can animate it.
              const jobState = job.status === 'completed' ? (job.conclusion || 'neutral') : (job.status || 'queued');
              // Running jobs have no completed_at; measure elapsed time so far
              // instead of subtracting from epoch (which gave huge negatives).
              const jobStartMs = job.started_at ? new Date(job.started_at).getTime() : 0;
              const jobEndMs = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
              const jobDuration = jobStartMs ? Math.max(0, Math.round((jobEndMs - jobStartMs) / 1000)) : 0;

              return {
                id: String(job.id),
                name: job.name,
                project: cleanProject,
                status: jobState,
                durationSeconds: jobDuration,
                startedAt: job.started_at || undefined,
                completedAt: job.completed_at || undefined,
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
      console.error('Failed to fetch workflow runs:', e);
      return [];
    }
  }

  // Fetch the downloadable artifacts (Playwright reports, traces, screenshots)
  // attached to a run. Called lazily when a run is opened.
  async getRunArtifacts(repoFullName: string, runId: string): Promise<RunArtifact[]> {
    if (!this.token) return [];
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
// project (e.g. "traces-checkout"); a generic "playwright-report" is the
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

import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { FavoritesDashboard } from './components/FavoritesDashboard';
import { DonutChart, BarChart } from './components/Charts';
import { CompareRuns } from './components/CompareRuns';
import { TestList } from './components/TestList';
import { TrendChart } from './components/TrendChart';
import { Insights } from './components/Insights';
import { AIChat } from './components/AIChat';
import { githubService, parseLogsForTestCases, findArtifactsForProject, isTraceArtifact, formatBytes } from './services/github';
import type { GitHubRepo, WorkflowRunReport, GitHubWorkflow, JobExecution } from './services/github';
import { getRunStats, isRunAnalyzed, findFlakyTests } from './services/insights';
import { saveRunHistory, applyRunHistory } from './services/history';
import { aiService } from './services/ai';
import type { LLMModel } from './services/ai';
import {
  ArrowLeft, Search, Plus, RefreshCw, MessageSquare, PlayCircle, BarChart2, Terminal,
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, Star, Calendar, Clock, User, ArrowRight,
  ExternalLink, Camera, FileArchive, Package, ShieldCheck
} from 'lucide-react';
import './App.css';

export default function App() {
  // Navigation & Repo Selection State
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [bookmarkedIds, setBookmarkedIds] = useState<number[]>([]);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [showAddRepoModal, setShowAddRepoModal] = useState(false);
  
  // Dashboard Settings
  const [currentModel, setCurrentModel] = useState<LLMModel>('local-llama');
  const [githubRefreshToggle, setGithubRefreshToggle] = useState(false);
  
  // Workflows & Runs
  const [workflows, setWorkflows] = useState<GitHubWorkflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<GitHubWorkflow | null>(null);
  // Favorite workflows per repo (repoFullName -> workflow ids), persisted
  const [favoriteWorkflows, setFavoriteWorkflows] = useState<Record<string, number[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem('favorite_workflows') || '{}');
    } catch {
      return {};
    }
  });
  const [runs, setRuns] = useState<WorkflowRunReport[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRunReport | null>(null);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  
  // Selected Job / Project within a Run (null = Summary / All Projects view)
  const [selectedJob, setSelectedJob] = useState<JobExecution | null>(null);
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'insights' | 'compare'>('overview');
  const [compareRunId, setCompareRunId] = useState<string>('');
  // Cross-run history analysis progress (null = not running)
  const [historyProgress, setHistoryProgress] = useState<{ done: number; total: number } | null>(null);
  // Ticks every second while a job is running so its elapsed timer advances live
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Deep-link target from the favorites dashboard, consumed as each loading
  // stage (workflows -> runs) completes
  const pendingNavRef = useRef<{ workflowId?: number; runId?: string; compare?: boolean } | null>(null);
  
  // Settings Modal State
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [githubTokenInput, setGithubTokenInput] = useState(githubService.getToken() || '');
  const [openaiKeyInput, setOpenaiKeyInput] = useState(aiService.getApiKey('openai') || '');
  const [geminiKeyInput, setGeminiKeyInput] = useState(aiService.getApiKey('gemini') || '');
  const [anthropicKeyInput, setAnthropicKeyInput] = useState(aiService.getApiKey('anthropic') || '');
  const [ollamaUrlInput, setOllamaUrlInput] = useState(aiService.getOllamaUrl() || '');
  const [ollamaModelInput, setOllamaModelInput] = useState(aiService.getOllamaModel() || '');

  const [userAvatar, setUserAvatar] = useState('');
  const [username, setUsername] = useState('');
  const [isMockMode, setIsMockMode] = useState(githubService.isMock());

  // Active View Logs
  const [activeJobLogs, setActiveJobLogs] = useState<string>('');
  // Runs whose job logs are currently being fetched & parsed for test counts
  const [enrichingRunIds, setEnrichingRunIds] = useState<Set<string>>(new Set());
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  // AI analyst sidebar starts collapsed; opens on demand via the toolbar button
  const [showChat, setShowChat] = useState(false);

  // Initial config loading
  useEffect(() => {
    const saved = localStorage.getItem('bookmarked_repos');
    if (saved) {
      setBookmarkedIds(JSON.parse(saved));
    }
    fetchRepos();
  }, [githubRefreshToggle]);

  const updateUserData = async () => {
    try {
      const info = await githubService.getUserInfo();
      setUserAvatar(info.avatarUrl);
      setUsername(info.name || info.login);
      setIsMockMode(githubService.isMock());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    updateUserData();
  }, [githubRefreshToggle]);

  // Load Workflows when Repository changes
  useEffect(() => {
    if (selectedRepo) {
      // Clear first so re-selecting the same workflow object still triggers
      // the runs effect (needed for dashboard deep-links)
      setSelectedWorkflow(null);
      fetchWorkflows(selectedRepo.fullName);
      setSelectedRun(null);
      setSelectedJob(null);
    }
  }, [selectedRepo]);

  // Load Runs when Workflow changes
  useEffect(() => {
    if (selectedRepo && selectedWorkflow) {
      fetchWorkflowRuns(selectedRepo.fullName, selectedWorkflow.id);
      setSelectedRun(null);
      setSelectedJob(null);
    }
  }, [selectedWorkflow]);

  // Reset active job when run changes
  useEffect(() => {
    setSelectedJob(null);
    setActiveJobLogs('');
  }, [selectedRun]);

  // Fetch job logs for display when job changes
  useEffect(() => {
    if (selectedJob && selectedRepo && selectedRun) {
      loadActiveJobLogs();
    } else {
      setActiveJobLogs('');
    }
  }, [selectedJob?.id]);

  // Background Log parsing parser. Runs on every selection; already-parsed
  // jobs are served from the service-level cache so repeats are cheap, and
  // transient failures get retried the next time the run is opened.
  useEffect(() => {
    if (selectedRun && selectedRepo) {
      fetchAndParseJobsLogs(selectedRun);
      fetchRunArtifacts(selectedRun);
    }
  }, [selectedRun?.id]);

  // While any job in the open run is in progress, tick a 1s clock so its
  // elapsed-duration timer advances live instead of showing a frozen snapshot.
  const hasRunningJob = !!selectedRun?.jobs.some(j => j.status === 'in_progress');
  useEffect(() => {
    if (!hasRunningJob) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunningJob]);

  // Consume a dashboard deep-link once its target run is present. Watching
  // `runs` (instead of hooking fetch completion) keeps this StrictMode-safe
  // and idempotent - the ref is cleared on first successful match.
  useEffect(() => {
    const pending = pendingNavRef.current;
    if (!pending?.runId || runs.length === 0) return;
    const targetIdx = runs.findIndex(r => r.id === pending.runId);
    if (targetIdx < 0) return;
    setSelectedRun(runs[targetIdx]);
    if (pending.compare) {
      const baseline = runs[targetIdx + 1] || runs.find((_, i) => i !== targetIdx);
      if (baseline) setCompareRunId(baseline.id);
      setDashboardTab('compare');
    } else {
      setDashboardTab('overview');
    }
    pendingNavRef.current = null;
  }, [runs]);

  // Persist analyzed results whenever enrichment lands new data
  useEffect(() => {
    if (selectedRepo && selectedWorkflow && runs.length > 0) {
      saveRunHistory(selectedRepo.fullName, selectedWorkflow.id, runs);
    }
  }, [runs]);

  // Enrich the comparison run too, otherwise the Compare tab shows 0 counts
  useEffect(() => {
    if (dashboardTab === 'compare' && selectedRepo) {
      const compareRun = runs.find(r => r.id === compareRunId);
      if (compareRun) {
        fetchAndParseJobsLogs(compareRun);
      }
    }
  }, [dashboardTab, compareRunId]);

  const loadActiveJobLogs = async () => {
    const jobToLoad = selectedRun?.jobs.find(j => j.id === selectedJob?.id) || selectedJob;
    if (!jobToLoad) return;
    setIsLoadingLogs(true);
    try {
      const logs = await githubService.getJobLogs(
        selectedRepo!.fullName,
        jobToLoad.id,
        jobToLoad.name,
        jobToLoad.status,
        selectedRun!.id
      );
      setActiveJobLogs(logs);
    } catch (e) {
      console.error(e);
      setActiveJobLogs('Failed to fetch logs for this job.');
    } finally {
      setIsLoadingLogs(false);
    }
  };

  // Fetch downloadable debug artifacts (reports, traces, screenshots) for a run.
  // Mock runs already carry their artifacts, so only real runs missing them fetch.
  const fetchRunArtifacts = async (run: WorkflowRunReport) => {
    if (!selectedRepo) return;
    if (run.artifacts && run.artifacts.length > 0) return; // already have them
    try {
      const artifacts = await githubService.getRunArtifacts(selectedRepo.fullName, run.id);
      if (artifacts.length === 0) return;
      setRuns(prev => prev.map(r => (r.id === run.id ? { ...r, artifacts } : r)));
      setSelectedRun(prev => (prev && prev.id === run.id ? { ...prev, artifacts } : prev));
    } catch (e) {
      console.error('Failed to fetch run artifacts:', e);
    }
  };

  const fetchAndParseJobsLogs = async (run: WorkflowRunReport) => {
    setEnrichingRunIds(prev => new Set(prev).add(run.id));
    try {
      const updatedJobs = await Promise.all(run.jobs.map(async (job) => {
        if (!job.name.startsWith('test (')) return job;
        
        try {
          const allureReport = await githubService.enrichJobData(
            selectedRepo!.fullName,
            job,
            run.id
          );
          return { ...job, allureReport };
        } catch (e) {
          console.error('Enrichment error on job:', job.name, e);
          return job;
        }
      }));

      // Update state with enriched job data. Also write it back into the runs
      // list so re-selecting this run or comparing against it shows real counts.
      setRuns(prev => prev.map(r => (r.id === run.id ? { ...r, jobs: updatedJobs } : r)));
      setSelectedRun(prev => {
        if (!prev || prev.id !== run.id) return prev;
        return {
          ...prev,
          jobs: updatedJobs
        };
      });
    } catch (err) {
      console.error(err);
    } finally {
      setEnrichingRunIds(prev => {
        const next = new Set(prev);
        next.delete(run.id);
        return next;
      });
    }
  };

  // Enrich every run in the list so trends, flaky detection, and per-run stats
  // work from one dataset. Runs sequentially to stay gentle on API rate limits;
  // already-analyzed runs are skipped (per-job results are cached in the service).
  // Refresh a specific running job's details from GitHub
  const refreshJobDetails = async (jobId: string) => {
    if (!selectedRun || !selectedRepo) return;
    try {
      setIsLoadingLogs(true);
      const jobToRefresh = selectedRun.jobs.find(j => j.id === jobId);
      if (!jobToRefresh) return;

      // Fetch fresh logs for this job and parse real test results from them
      const freshLogs = await githubService.getJobLogs(selectedRepo.fullName, jobId, jobToRefresh.name, jobToRefresh.status, selectedRun.id);
      const freshTests = parseLogsForTestCases(freshLogs) || [];

      // Build the report purely from parsed data — never fabricated
      const updatedJob = {
        ...jobToRefresh,
        allureReport: {
          passed: freshTests.filter(t => t.status === 'passed').length,
          failed: freshTests.filter(t => t.status === 'failed').length,
          skipped: freshTests.filter(t => t.status === 'skipped').length,
          total: freshTests.length,
          tests: freshTests
        }
      };

      // Update the run's jobs with the refreshed data
      setRuns(prev => prev.map(r => {
        if (r.id === selectedRun.id) {
          return {
            ...r,
            jobs: r.jobs.map(j => (j.id === jobId ? updatedJob : j))
          };
        }
        return r;
      }));

      // Update selectedJob if it's the one being refreshed
      if (selectedJob?.id === jobId) {
        setSelectedJob(updatedJob);
      }
    } catch (err) {
      console.error('Failed to refresh job details:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const analyzeHistory = async () => {
    if (historyProgress) return;
    const targets = runs.filter(r => r.jobs.length > 0 && !isRunAnalyzed(r));
    if (targets.length === 0) return;
    setHistoryProgress({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      await fetchAndParseJobsLogs(targets[i]);
      setHistoryProgress({ done: i + 1, total: targets.length });
    }
    setHistoryProgress(null);
  };

  const fetchRepos = async (query?: string) => {
    setIsLoadingRepos(true);
    try {
      const data = await githubService.getRepositories(query);
      setRepos(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const fetchWorkflows = async (fullName: string) => {
    setIsLoadingWorkflows(true);
    try {
      const data = await githubService.getWorkflows(fullName);
      setWorkflows(data);
      if (data.length > 0) {
        // Deep-link target wins; otherwise open on the first favorited workflow
        const pendingWfId = pendingNavRef.current?.workflowId;
        const favIds = favoriteWorkflows[fullName] || [];
        const target =
          (pendingWfId !== undefined && data.find(w => w.id === pendingWfId)) ||
          data.find(w => favIds.includes(w.id)) ||
          data[0];
        setSelectedWorkflow(target);
        // Deep-links must not rely on the selectedWorkflow effect firing: when
        // the same workflow object is re-selected React bails out and the
        // effect never runs. Fetch the runs directly; the pending target is
        // consumed by the runs-watching effect.
        if (pendingNavRef.current?.runId) {
          fetchWorkflowRuns(fullName, target.id);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingWorkflows(false);
    }
  };

  // Navigate from a favorites-dashboard card into the full run view
  const openFromDashboard = (repo: GitHubRepo, workflow: GitHubWorkflow, opts?: { runId?: string; compare?: boolean }) => {
    pendingNavRef.current = { workflowId: workflow.id, runId: opts?.runId, compare: opts?.compare };
    setSelectedRepo(repo);
  };

  const toggleFavoriteWorkflow = (wfId: number) => {
    if (!selectedRepo) return;
    setFavoriteWorkflows(prev => {
      const current = prev[selectedRepo.fullName] || [];
      const next = current.includes(wfId) ? current.filter(id => id !== wfId) : [...current, wfId];
      const updated = { ...prev, [selectedRepo.fullName]: next };
      localStorage.setItem('favorite_workflows', JSON.stringify(updated));
      return updated;
    });
  };

  const fetchWorkflowRuns = async (fullName: string, workflowId: number) => {
    setIsLoadingRuns(true);
    try {
      const runReports = await githubService.getWorkflowRuns(fullName, workflowId);
      // Restore previously analyzed results so trends survive reloads
      const merged = applyRunHistory(fullName, workflowId, runReports);
      setRuns(merged);
      if (merged.length > 1) {
        setCompareRunId(merged[1].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  const toggleBookmark = (repo: GitHubRepo) => {
    let updated: number[];
    if (bookmarkedIds.includes(repo.id)) {
      updated = bookmarkedIds.filter(id => id !== repo.id);
    } else {
      updated = [...bookmarkedIds, repo.id];
    }
    setBookmarkedIds(updated);
    localStorage.setItem('bookmarked_repos', JSON.stringify(updated));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRepos(searchQuery);
  };

  const handleAddRepoSelect = (repo: GitHubRepo) => {
    if (!bookmarkedIds.includes(repo.id)) {
      toggleBookmark(repo);
    }
    setSelectedRepo(repo);
    setShowAddRepoModal(false);
  };

  const handleGithubStateChange = () => {
    setGithubRefreshToggle(prev => !prev);
    setSelectedRepo(null);
  };

  const handleLogout = () => {
    githubService.setToken(null);
    setGithubTokenInput('');
    setIsMockMode(true);
    handleGithubStateChange();
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (githubTokenInput.trim()) {
      githubService.setToken(githubTokenInput.trim());
    } else {
      githubService.setToken(null);
    }
    aiService.setApiKey('openai', openaiKeyInput.trim());
    aiService.setApiKey('gemini', geminiKeyInput.trim());
    aiService.setApiKey('anthropic', anthropicKeyInput.trim());
    aiService.setOllamaConfig(ollamaUrlInput.trim(), ollamaModelInput.trim());
    
    setShowSettingsModal(false);
    handleGithubStateChange();
  };

  // Render debug-artifact links (screenshots/report + trace) for a failed test's
  // project. Traces get a hint to open in trace.playwright.dev after download.
  const renderArtifactLinks = (project: string) => {
    const artifacts = findArtifactsForProject(selectedRun?.artifacts, project);
    if (artifacts.length === 0) return null;

    // Collapse to a single Report button and a single Trace button. Sharded
    // runs upload several report/trace bundles; showing one per bundle produces
    // duplicate "Screenshots / Report" buttons. If a group has one artifact we
    // link straight to it; if several, we link to the run's artifacts section.
    const traces = artifacts.filter(a => isTraceArtifact(a.name));
    const reports = artifacts.filter(a => !isTraceArtifact(a.name));
    const runArtifactsAnchor = `${selectedRun?.htmlUrl || '#'}#artifacts`;

    const groups = [
      { items: reports, trace: false, label: 'Screenshots / Report' },
      { items: traces, trace: true, label: 'Trace' }
    ].filter(g => g.items.length > 0);

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
        {groups.map(({ items, trace, label }) => {
          const single = items.length === 1 ? items[0] : null;
          const href = single ? single.url : runArtifactsAnchor;
          const totalBytes = items.reduce((sum, a) => sum + a.sizeInBytes, 0);
          return (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="artifact-link"
              title={single
                ? (trace
                    ? `Download ${single.name} (${formatBytes(single.sizeInBytes)}) — unzip and open trace.zip at trace.playwright.dev`
                    : `Download ${single.name} (${formatBytes(single.sizeInBytes)}) — screenshots & HTML report`)
                : `${items.length} ${trace ? 'trace' : 'report'} bundles — open the run's artifacts to pick one`}
            >
              {trace ? <FileArchive size={11} /> : <Camera size={11} />}
              {label}
              {items.length > 1 && <span style={{ opacity: 0.6 }}>×{items.length}</span>}
              {single && <span style={{ opacity: 0.6 }}>{formatBytes(totalBytes)}</span>}
              <ExternalLink size={10} />
            </a>
          );
        })}
      </div>
    );
  };

  const bookmarkedRepos = repos.filter(r => bookmarkedIds.includes(r.id));
  const comparisonRun = runs.find(r => r.id === compareRunId);

  // Favorites float to the top of the workflow sidebar (stable within groups)
  const repoFavWorkflowIds = selectedRepo ? (favoriteWorkflows[selectedRepo.fullName] || []) : [];
  const sortedWorkflows = [...workflows].sort(
    (a, b) => Number(repoFavWorkflowIds.includes(b.id)) - Number(repoFavWorkflowIds.includes(a.id))
  );

  const renderConclusionIcon = (conclusion: string, size = 16) => {
    switch (conclusion) {
      case 'success':
        return <CheckCircle2 size={size} style={{ color: 'var(--color-success)' }} />;
      case 'failure':
        return <XCircle size={size} style={{ color: 'var(--color-failure)' }} />;
      case 'in_progress':
        return <RefreshCw size={size} style={{ color: 'var(--color-info)', animation: 'spin 1s linear infinite' }} />;
      default:
        return <AlertTriangle size={size} style={{ color: 'var(--color-skipped)' }} />;
    }
  };

  // Live elapsed time for a running job (ticks via nowTick); the fixed final
  // duration otherwise. Keeps the displayed timer honest instead of frozen.
  const getLiveJobDuration = (job: JobExecution): number => {
    if (job.status === 'in_progress' && job.startedAt) {
      return Math.max(0, Math.round((nowTick - new Date(job.startedAt).getTime()) / 1000));
    }
    return job.durationSeconds;
  };

  const formatDuration = (seconds: number) => {
    // Guard against missing/negative values (e.g. a job still running)
    if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
    seconds = Math.round(seconds);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  };

  const getRunTotals = (run: WorkflowRunReport | null) => {
    if (!run) return { passed: 0, failed: 0, skipped: 0, total: 0 };
    let passed = 0, failed = 0, skipped = 0, total = 0;
    run.jobs.forEach(j => {
      passed += j.allureReport.passed;
      failed += j.allureReport.failed;
      skipped += j.allureReport.skipped;
      total += j.allureReport.total;
    });
    return { passed, failed, skipped, total };
  };

  const runTotals = getRunTotals(selectedRun);
  const runPassRate = runTotals.total > 0 ? Math.round((runTotals.passed / runTotals.total) * 100) : null;
  const isEnriching = selectedRun ? enrichingRunIds.has(selectedRun.id) : false;
  const currentJob = selectedRun?.jobs.find(j => j.id === selectedJob?.id) || null;

  // Fleet-level stats across analyzed runs (powers the runs-list header)
  const analyzedRuns = runs.filter(isRunAnalyzed);
  const fleetStats = (() => {
    if (analyzedRuns.length === 0) return null;
    const rates = analyzedRuns.map(r => getRunStats(r).passRate).filter((r): r is number => r !== null);
    const latestAnalyzed = analyzedRuns[0];
    const failsByProject = new Map<string, number>();
    analyzedRuns.forEach(r => r.jobs.forEach(j => {
      if (j.allureReport.failed > 0) {
        failsByProject.set(j.project, (failsByProject.get(j.project) || 0) + j.allureReport.failed);
      }
    }));
    const worstProject = [...failsByProject.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      latestPassRate: getRunStats(latestAnalyzed).passRate,
      avgPassRate: rates.length ? Math.round(rates.reduce((s, r) => s + r, 0) / rates.length) : null,
      flakyCount: findFlakyTests(runs).length,
      worstProject: worstProject ? { name: worstProject[0], failed: worstProject[1] } : null
    };
  })();

  const getFailedTestsAcrossRun = (run: WorkflowRunReport | null) => {
    if (!run) return [];
    const failures: { jobName: string; project: string; testName: string; error?: string; jobUrl?: string }[] = [];
    run.jobs.forEach(job => {
      job.allureReport.tests.forEach(test => {
        if (test.status === 'failed') {
          failures.push({
            jobName: job.name,
            project: job.project,
            testName: test.name,
            error: test.error,
            jobUrl: job.htmlUrl
          });
        }
      });
    });
    return failures;
  };

  const runFailuresList = getFailedTestsAcrossRun(selectedRun);

  return (
    <div className="app-container">
      <div className="bg-glow-orb orb-1" />
      <div className="bg-glow-orb orb-2" />

      {/* Navigation Header */}
      <Navbar 
        currentModel={currentModel} 
        onModelChange={setCurrentModel} 
        onOpenSettings={() => setShowSettingsModal(true)}
        isMockMode={isMockMode}
        userAvatar={userAvatar}
        username={username}
        onLogout={handleLogout}
      />

      <main className="main-content">

        {/* VIEW 1: HOME PAGE */}
        {!selectedRepo ? (
          !githubService.getToken() ? (
            /* Not connected: GitHub auth gate. No data is shown until the user
               provides a token — the app has no built-in/sample data. */
            <div className="animate-fade-in" style={{
              background: 'radial-gradient(100% 100% at 50% 0%, rgba(161, 98, 7, 0.05) 0%, rgba(0, 0, 0, 0) 100%)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '3rem 2rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
              marginTop: '1rem',
              boxShadow: 'var(--shadow-glow)'
            }}>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 800, fontFamily: 'var(--font-display)' }} className="text-gradient">
                Keychain Automation Console
              </h1>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '580px', fontSize: '0.95rem', lineHeight: '1.6' }}>
                Turn your GitHub Actions test runs into accurate pass/fail reports, failure
                categories, flaky-test detection, and run-over-run trends. Connect your GitHub
                account to get started — the console reads your workflow runs on demand.
              </p>
              <button className="btn" style={{ padding: '0.7rem 1.4rem' }} onClick={() => setShowSettingsModal(true)}>
                Connect GitHub
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '520px', marginTop: '0.25rem' }}>
                <ShieldCheck size={14} style={{ flexShrink: 0, color: 'var(--color-success)' }} />
                <span>
                  Runs entirely in your browser. Your token needs only <strong>Actions</strong> +{' '}
                  <strong>Checks</strong> read access and is stored locally — it's never sent anywhere but GitHub.
                </span>
              </div>
            </div>
          ) : (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginTop: '1rem' }}>
            {bookmarkedRepos.length === 0 ? (
              /* First-run hero: full welcome panel */
              <div style={{
                background: 'radial-gradient(100% 100% at 50% 0%, rgba(161, 98, 7, 0.05) 0%, rgba(0, 0, 0, 0) 100%)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '2.5rem 2rem',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
                boxShadow: 'var(--shadow-glow)'
              }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 800, fontFamily: 'var(--font-display)' }} className="text-gradient">
                  Keychain Automation Console
                </h1>
                <p style={{ color: 'var(--text-secondary)', maxWidth: '600px', fontSize: '0.95rem', lineHeight: '1.6' }}>
                  Drill down from GitHub Action Workflows into specific project execution jobs, verify CLI running steps, and inspect calculations from Allure reports.
                </p>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <button className="btn" onClick={() => setShowAddRepoModal(true)}>
                    <Plus size={16} /> Add Repository
                  </button>
                </div>
              </div>
            ) : (
              /* Repos already added: compact header, dashboard gets the space */
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h1 style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                    Keychain Automation Console
                  </h1>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.15rem' }}>
                    Test report analysis across your automation repositories
                  </p>
                </div>
                <button className="btn" style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem' }} onClick={() => setShowAddRepoModal(true)}>
                  <Plus size={15} /> Add Repository
                </button>
              </div>
            )}

            {/* Health dashboard for starred repos' favorited workflows */}
            <FavoritesDashboard
              repos={bookmarkedRepos}
              favoriteWorkflows={favoriteWorkflows}
              onOpen={openFromDashboard}
            />

            <div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: '1.25rem' }}>
                Bookmarked Repositories
              </h2>
              {bookmarkedRepos.length === 0 ? (
                <div style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: '12px',
                  padding: '4rem 2rem',
                  textAlign: 'center',
                  color: 'var(--text-secondary)'
                }}>
                  <HelpCircle size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
                  <p style={{ fontWeight: 500, marginBottom: '0.5rem' }}>No bookmarked repositories found</p>
                  <button className="btn btn-secondary" onClick={() => setShowAddRepoModal(true)}>
                    Browse Repositories
                  </button>
                </div>
              ) : (
                <div className="dashboard-grid">
                  {bookmarkedRepos.map(repo => (
                    <div
                      key={repo.id}
                      className="card card-clickable"
                      onClick={() => setSelectedRepo(repo)}
                      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '140px' }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{repo.fullName.split('/')[0]}</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); toggleBookmark(repo); }}
                            style={{ color: 'var(--color-skipped)' }}
                          >
                            <Star size={16} fill="var(--color-skipped)" />
                          </button>
                        </div>
                        <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{repo.name}</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{repo.description}</p>
                      </div>
                      <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          Open Actions <ArrowRight size={12} />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          )
        ) : (

          /* VIEW 2: DUAL WORKFLOWS & EXECUTION DASHBOARD */
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            {/* Breadcrumb row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => setSelectedRepo(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <ArrowLeft size={16} /> Back to Repositories
              </button>
              <span className="badge badge-indigo">{selectedRepo.fullName}</span>
            </div>

            {/* Layout Split: Left workflow list & Right details */}
            <div className="workflow-details-split">
              
              {/* Left Column: Workflows Sidebar List */}
              <div className="card" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', paddingLeft: '0.5rem', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Workflows
                </h3>
                {isLoadingWorkflows ? (
                  <div style={{ padding: '1rem', textAlign: 'center' }}><RefreshCw className="animate-spin" size={18} /></div>
                ) : (
                  sortedWorkflows.map(wf => {
                    const isFav = repoFavWorkflowIds.includes(wf.id);
                    return (
                      <button
                        key={wf.id}
                        onClick={() => setSelectedWorkflow(wf)}
                        className={`list-row ${selectedWorkflow?.id === wf.id ? 'is-active' : ''}`}
                        style={{ fontSize: '0.85rem', padding: '0.6rem 0.75rem' }}
                      >
                        <div className="list-row__main">
                          <PlayCircle size={16} style={{ flexShrink: 0 }} />
                          <span>{wf.name}</span>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={isFav ? `Remove ${wf.name} from favorites` : `Mark ${wf.name} as favorite`}
                          title={isFav ? 'Remove from favorites' : 'Favorite this workflow for this repo'}
                          className={`fav-toggle ${isFav ? 'is-faved' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleFavoriteWorkflow(wf.id); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleFavoriteWorkflow(wf.id);
                            }
                          }}
                        >
                          <Star size={13} fill={isFav ? 'var(--color-skipped)' : 'transparent'} style={{ color: 'var(--color-skipped)' }} />
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Right Column: Execution Workspace */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                {/* CASE A: LIST OF HISTORICAL RUNS FOR WORKFLOW */}
                {!selectedRun ? (
                  <div className="card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <div>
                        <h2 style={{ fontSize: '1.2rem', fontFamily: 'var(--font-display)' }}>
                          {selectedWorkflow?.name} Runs
                        </h2>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Showing runs from workflow file <code>{selectedWorkflow?.path.split('/').pop()}</code>
                        </span>
                      </div>
                      {runs.length > 0 && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                          onClick={analyzeHistory}
                          disabled={!!historyProgress}
                          title="Parse test results for every listed run to unlock trends, flaky detection, and per-run stats"
                        >
                          {historyProgress ? (
                            <>
                              <RefreshCw className="animate-spin" size={13} />
                              Analyzing {historyProgress.done}/{historyProgress.total}…
                            </>
                          ) : (
                            <>
                              <BarChart2 size={13} />
                              {analyzedRuns.length === runs.length ? 'History analyzed' : 'Analyze history'}
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Fleet health: KPI strip + trend across analyzed runs */}
                    {fleetStats && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                        <div className="stat-grid">
                          <div className="stat-tile stat-tile--accent">
                            <span className="stat-tile__label">Latest pass rate</span>
                            <span className="stat-tile__value" style={{ fontSize: '1.2rem' }}>
                              {fleetStats.latestPassRate !== null ? `${fleetStats.latestPassRate}%` : '—'}
                            </span>
                          </div>
                          <div className="stat-tile">
                            <span className="stat-tile__label">Avg pass rate</span>
                            <span className="stat-tile__value" style={{ fontSize: '1.2rem' }}>
                              {fleetStats.avgPassRate !== null ? `${fleetStats.avgPassRate}%` : '—'}
                            </span>
                          </div>
                          <div className="stat-tile stat-tile--skipped">
                            <span className="stat-tile__label">Flaky candidates</span>
                            <span className="stat-tile__value" style={{ fontSize: '1.2rem' }}>{fleetStats.flakyCount}</span>
                          </div>
                          <div className="stat-tile stat-tile--failure">
                            <span className="stat-tile__label">Most failures</span>
                            <span className="stat-tile__value" style={{ fontSize: '0.95rem', paddingTop: '0.2rem' }} title={fleetStats.worstProject ? `${fleetStats.worstProject.failed} failed tests` : undefined}>
                              {fleetStats.worstProject ? fleetStats.worstProject.name : 'none'}
                            </span>
                          </div>
                        </div>
                        <TrendChart runs={runs} onSelectRun={setSelectedRun} />
                      </div>
                    )}

                    {isLoadingRuns ? (
                      <div style={{ padding: '3rem', textAlign: 'center' }}>
                        <RefreshCw className="animate-spin" size={24} style={{ color: 'var(--color-accent)' }} />
                        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Fetching execution runs...</p>
                      </div>
                    ) : runs.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)' }}>No runs found for this workflow.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {runs.map(run => (
                          <div
                            key={run.id}
                            onClick={() => setSelectedRun(run)}
                            className={`card card-clickable run-row ${
                              run.conclusion === 'success' ? 'run-row--success'
                              : run.conclusion === 'failure' ? 'run-row--failure'
                              : 'run-row--other'
                            }`}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: '70%' }}>
                              <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>{run.name}</strong>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                commit <code>{run.commitSha}</code> &bull; {run.commitMessage}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                                <User size={12} /> @{run.triggerer} &bull; <Calendar size={12} /> {new Date(run.createdAt).toLocaleString()}
                              </span>
                            </div>
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                              {(() => {
                                const stats = getRunStats(run);
                                if (stats.total === 0) return null;
                                return (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    {stats.failed > 0 && (
                                      <span className="count-pill count-pill--failure">{stats.failed} ✕</span>
                                    )}
                                    <span className="tabular-nums" style={{ fontWeight: 600, color: stats.failed > 0 ? 'var(--text-primary)' : 'var(--color-success)' }}>
                                      {stats.passRate}%
                                    </span>
                                  </span>
                                );
                              })()}
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Clock size={12} /> {formatDuration(run.durationSeconds)}
                              </span>
                              {renderConclusionIcon(run.conclusion, 18)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  
                  /* CASE B: RUN EXECUTION DASHBOARD */
                  <div className={`dashboard-layout-container ${showChat ? 'with-chat' : ''}`}>
                    
                    {/* Workspace Core Area */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      
                      {/* Controls Top Panel */}
                      <div className="card animate-fade-in" style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <button onClick={() => setSelectedRun(null)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          <ArrowLeft size={14} /> Back to Runs
                        </button>
                        
                        <div style={{ display: 'flex', background: 'var(--surface-2)', padding: '0.2rem', borderRadius: '8px' }}>
                          {([
                            { key: 'overview', label: 'Job Details' },
                            { key: 'insights', label: 'Insights' },
                            { key: 'compare', label: 'Compare Run' }
                          ] as const).map(tab => (
                            <button
                              key={tab.key}
                              onClick={() => setDashboardTab(tab.key)}
                              style={{
                                padding: '0.35rem 0.8rem',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                backgroundColor: dashboardTab === tab.key ? 'var(--color-accent)' : 'transparent',
                                color: dashboardTab === tab.key ? 'white' : 'var(--text-secondary)'
                              }}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        <button 
                          onClick={() => setShowChat(!showChat)}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', gap: '0.25rem' }}
                        >
                          <MessageSquare size={12} /> AI Analyst
                        </button>
                      </div>

                      {dashboardTab === 'overview' ? (
                        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          
                          {/* Run Execution Summary Header (Screenshot 2 Top Info Reference) */}
                          <div style={{
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '12px',
                            padding: '1.25rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '1.5rem',
                            boxShadow: 'var(--shadow-md)'
                          }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Workflow Pipeline Execution</span>
                              <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {selectedRun.name}
                                <span className={`badge ${selectedRun.conclusion === 'success' ? 'badge-success' : 'badge-failure'}`} style={{ fontSize: '0.65rem' }}>
                                  {selectedRun.conclusion}
                                </span>
                              </h2>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                commit <code>{selectedRun.commitSha}</code> &bull; triggered via {selectedRun.event} by @{selectedRun.triggerer}
                              </span>
                              {/* GitHub deep-links: full run page + artifacts (screenshots/traces) */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                {selectedRun.htmlUrl && (
                                  <a
                                    href={selectedRun.htmlUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.3rem 0.7rem', fontSize: '0.72rem', gap: '0.3rem' }}
                                  >
                                    <ExternalLink size={12} /> View run on GitHub
                                  </a>
                                )}
                                {selectedRun.artifacts && selectedRun.artifacts.length > 0 && (
                                  <a
                                    href={`${selectedRun.htmlUrl || '#'}#artifacts`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.3rem 0.7rem', fontSize: '0.72rem', gap: '0.3rem' }}
                                    title="Playwright reports, traces & screenshots attached to this run"
                                  >
                                    <Package size={12} /> {selectedRun.artifacts.length} artifact{selectedRun.artifacts.length > 1 ? 's' : ''}
                                  </a>
                                )}
                              </div>
                            </div>

                            {/* Info metrics items */}
                            <div className="stat-grid" style={{ maxWidth: '720px' }}>
                              <div className="stat-tile">
                                <span className="stat-tile__label">Duration</span>
                                <span className="stat-tile__value" style={{ fontSize: '1.1rem' }}>{formatDuration(selectedRun.durationSeconds)}</span>
                              </div>
                              <div className="stat-tile stat-tile--accent">
                                <span className="stat-tile__label">Pass rate</span>
                                <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`} style={{ fontSize: '1.1rem' }}>
                                  {runPassRate !== null ? `${runPassRate}%` : '—'}
                                </span>
                              </div>
                              <div className="stat-tile stat-tile--success">
                                <span className="stat-tile__label">Passed</span>
                                <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`} style={{ fontSize: '1.1rem' }}>{runTotals.passed}</span>
                              </div>
                              <div className="stat-tile stat-tile--failure">
                                <span className="stat-tile__label">Failed</span>
                                <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`} style={{ fontSize: '1.1rem' }}>{runTotals.failed}</span>
                              </div>
                              <div className="stat-tile stat-tile--skipped">
                                <span className="stat-tile__label">Skipped</span>
                                <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`} style={{ fontSize: '1.1rem' }}>{runTotals.skipped}</span>
                              </div>
                              <div className="stat-tile">
                                <span className="stat-tile__label">Total</span>
                                <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`} style={{ fontSize: '1.1rem' }}>{runTotals.total}</span>
                              </div>
                            </div>
                          </div>

                          {/* Parsing progress notice */}
                          {isEnriching && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)', padding: '0 0.25rem' }}>
                              <RefreshCw className="animate-spin" size={13} style={{ color: 'var(--color-accent)' }} />
                              Parsing job logs for exact test counts…
                            </div>
                          )}

                          {/* Jobs & Steps Split Section */}
                          <div className="job-matrix-details-split">
                            
                            {/* Left column: Job matrix items list */}
                            <div className="card" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <h3 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', paddingLeft: '0.5rem', marginBottom: '0.5rem', fontWeight: 600 }}>
                                Run Jobs / Projects
                              </h3>
                              
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '560px', overflowY: 'auto' }}>
                                {/* Summary Selection Item */}
                                <button
                                  onClick={() => setSelectedJob(null)}
                                  className={`list-row ${selectedJob === null ? 'is-active' : ''}`}
                                  style={{ fontSize: '0.85rem' }}
                                >
                                  <div className="list-row__main">
                                    <BarChart2 size={16} />
                                    <span>Summary (All Projects)</span>
                                  </div>
                                </button>

                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '0.25rem 0' }} />

                                {/* Project List items */}
                                {selectedRun.jobs.length === 0 ? (
                                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem 0.6rem' }}>
                                    No job data available for this run.
                                  </p>
                                ) : selectedRun.jobs.map(job => {
                                  const isActive = selectedJob?.id === job.id;
                                  const isRunning = job.status === 'in_progress';
                                  const { failed, total } = job.allureReport;
                                  return (
                                    <button
                                      key={job.id}
                                      onClick={() => setSelectedJob(job)}
                                      className={`list-row ${isActive ? 'is-active' : ''} ${isRunning ? 'is-running' : ''}`}
                                    >
                                      <div className="list-row__main">
                                        {renderConclusionIcon(job.status, 14)}
                                        <span title={job.name}>
                                          {job.name.startsWith('test (') ? job.project : job.name}
                                        </span>
                                      </div>
                                      <div className="list-row__meta">
                                        {isRunning && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); refreshJobDetails(job.id); }}
                                            disabled={isLoadingLogs}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '0.25rem',
                                              padding: '0.25rem 0.5rem',
                                              borderRadius: '4px',
                                              border: '1px solid rgba(29, 78, 216, 0.3)',
                                              background: 'rgba(29, 78, 216, 0.08)',
                                              color: 'var(--color-info)',
                                              fontSize: '0.7rem',
                                              fontWeight: 600,
                                              cursor: isLoadingLogs ? 'not-allowed' : 'pointer',
                                              transition: 'all var(--transition-fast)',
                                              opacity: isLoadingLogs ? 0.6 : 1
                                            }}
                                            title="Refresh this job's latest status"
                                          >
                                            <RefreshCw size={11} style={{ animation: isLoadingLogs ? 'spin 1s linear infinite' : 'none' }} />
                                            Refresh
                                          </button>
                                        )}
                                        {failed > 0 && (
                                          <span className="count-pill count-pill--failure" title={`${failed} failed tests`}>
                                            {failed} ✕
                                          </span>
                                        )}
                                        {total > 0 && failed === 0 && (
                                          <span className="count-pill count-pill--success" title={`${total} tests, none failed`}>
                                            {total} ✓
                                          </span>
                                        )}
                                        <span>{formatDuration(getLiveJobDuration(job))}</span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Right column: Details rendering */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              
                              {/* VIEW A: SUMMARY VIEW */}
                              {selectedJob === null ? (
                                <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                  
                                  {/* Allure Report Summary title and KPIs */}
                                  <div className="card" style={{ padding: '1.25rem' }}>
                                    <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                                      <h3 style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>Consolidated Allure Execution Calculation</h3>
                                    </div>

                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'center', justifyContent: 'center' }}>
                                      <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                                        <DonutChart 
                                          size={160}
                                          data={[
                                            { name: 'Passed', value: runTotals.passed, color: 'var(--color-success)' },
                                            { name: 'Failed', value: runTotals.failed, color: 'var(--color-failure)' },
                                            { name: 'Skipped', value: runTotals.skipped, color: 'var(--color-skipped)' }
                                          ]}
                                        />
                                      </div>

                                      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', minWidth: '200px' }}>
                                        <div className="stat-tile stat-tile--success">
                                          <span className="stat-tile__label">Passed</span>
                                          <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`}>{runTotals.passed}</span>
                                        </div>
                                        <div className="stat-tile stat-tile--failure">
                                          <span className="stat-tile__label">Failed</span>
                                          <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`}>{runTotals.failed}</span>
                                        </div>
                                        <div className="stat-tile stat-tile--skipped">
                                          <span className="stat-tile__label">Skipped</span>
                                          <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`}>{runTotals.skipped}</span>
                                        </div>
                                        <div className="stat-tile">
                                          <span className="stat-tile__label">Total</span>
                                          <span className={`stat-tile__value ${isEnriching ? 'is-parsing' : ''}`}>{runTotals.total}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Project-by-project comparative graph */}
                                  <div className="card" style={{ padding: '1.25rem' }}>
                                    <BarChart 
                                      title="Project Executions Side-by-Side comparison"
                                      data={selectedRun.jobs
                                        .filter(job => job.name.startsWith('test ('))
                                        .map(job => ({
                                          label: job.project,
                                          passed: job.allureReport.passed,
                                          failed: job.allureReport.failed,
                                          skipped: job.allureReport.skipped
                                        }))
                                      }
                                    />
                                  </div>

                                  {/* Global Failure annotations list for the entire run */}
                                  {runFailuresList.length > 0 && (
                                    <div className="card" style={{ padding: '1.25rem' }}>
                                      <h3 style={{ fontSize: '0.9rem', color: 'var(--color-failure)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        🚨 Failed Scenarios Across All Projects ({runFailuresList.length})
                                      </h3>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '350px', overflowY: 'auto' }}>
                                        {runFailuresList.map((fail, fIdx) => (
                                          <div key={fIdx} style={{ background: 'rgba(225, 29, 72, 0.02)', border: '1px solid rgba(225, 29, 72, 0.1)', borderRadius: '6px', padding: '0.75rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{fail.jobName}</span>
                                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fail.testName}</span>
                                            </div>
                                            {fail.error && (
                                              <pre style={{ fontSize: '0.7rem', color: '#FCA5A5', overflowX: 'auto', fontFamily: 'var(--font-mono)', padding: '0.25rem', background: '#1C1917', borderRadius: '4px', marginTop: '0.25rem' }}>
                                                {fail.error}
                                              </pre>
                                            )}
                                            {/* Debug evidence: screenshots/trace artifacts + job logs on GitHub */}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginTop: '0.5rem' }}>
                                              {renderArtifactLinks(fail.project)}
                                              {fail.jobUrl && (
                                                <a
                                                  href={fail.jobUrl}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="artifact-link"
                                                  title="Open this job's logs on GitHub"
                                                >
                                                  <Terminal size={11} /> Job logs <ExternalLink size={10} />
                                                </a>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                </div>
                               ) : currentJob === null ? null : (
                                 
                                 /* VIEW B: SPECIFIC DRILLDOWN JOB VIEW */
                                 <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                   
                                   {/* Steps list */}
                                   <div className="card" style={{ padding: '1rem' }}>
                                     <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                       <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                                         {renderConclusionIcon(currentJob.status, 16)}
                                         <code style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentJob.name}</code>
                                         <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>steps</span>
                                       </h3>
                                       <span style={{ fontSize: '0.75rem', color: currentJob.status === 'in_progress' ? 'var(--color-info)' : 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                         {currentJob.status === 'in_progress'
                                           ? `Running · ${formatDuration(getLiveJobDuration(currentJob))} elapsed`
                                           : `Executed in ${formatDuration(getLiveJobDuration(currentJob))}`}
                                       </span>
                                     </div>

                                     {/* Debug artifacts + job logs for this project */}
                                     {(currentJob.htmlUrl || findArtifactsForProject(selectedRun.artifacts, currentJob.project).length > 0) && (
                                       <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                                         {renderArtifactLinks(currentJob.project)}
                                         {currentJob.htmlUrl && (
                                           <a
                                             href={currentJob.htmlUrl}
                                             target="_blank"
                                             rel="noopener noreferrer"
                                             className="artifact-link"
                                             title="Open this job on GitHub"
                                           >
                                             <ExternalLink size={11} /> View job on GitHub
                                           </a>
                                         )}
                                       </div>
                                     )}

                                     <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                       {currentJob.steps.map((step, sIdx) => (
                                         <div 
                                           key={sIdx}
                                           style={{
                                             display: 'flex',
                                             justifyContent: 'space-between',
                                             fontSize: '0.75rem',
                                             padding: '0.35rem 0.5rem',
                                             background: 'var(--surface-1)',
                                             borderRadius: '4px',
                                             borderLeft: `2px solid ${step.status === 'success' ? 'var(--color-success)' : step.status === 'failure' ? 'var(--color-failure)' : 'var(--text-muted)'}`
                                           }}
                                         >
                                           <span style={{ color: 'var(--text-primary)' }}>{step.name}</span>
                                           <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatDuration(step.durationSeconds)}</span>
                                         </div>
                                       ))}
                                     </div>
                                   </div>

                                   {/* Allure Report calculation */}
                                   <div className="card" style={{ padding: '1rem' }}>
                                     <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                                       <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>Allure Results Calculation</h3>
                                     </div>

                                     <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'center' }}>
                                       <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                                         <DonutChart 
                                           size={130}
                                           data={[
                                             { name: 'Passed', value: currentJob.allureReport.passed, color: 'var(--color-success)' },
                                             { name: 'Failed', value: currentJob.allureReport.failed, color: 'var(--color-failure)' },
                                             { name: 'Skipped', value: currentJob.allureReport.skipped, color: 'var(--color-skipped)' }
                                           ]}
                                         />
                                       </div>

                                       <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', minWidth: '160px' }}>
                                         <div className="stat-tile stat-tile--success">
                                           <span className="stat-tile__label">Passed</span>
                                           <span className="stat-tile__value" style={{ fontSize: '1.1rem' }}>{currentJob.allureReport.passed}</span>
                                         </div>
                                         <div className="stat-tile stat-tile--failure">
                                           <span className="stat-tile__label">Failed</span>
                                           <span className="stat-tile__value" style={{ fontSize: '1.1rem' }}>{currentJob.allureReport.failed}</span>
                                         </div>
                                         <div className="stat-tile stat-tile--skipped">
                                           <span className="stat-tile__label">Skipped</span>
                                           <span className="stat-tile__value" style={{ fontSize: '1.1rem' }}>{currentJob.allureReport.skipped}</span>
                                         </div>
                                         <div className="stat-tile">
                                           <span className="stat-tile__label">Total</span>
                                           <span className="stat-tile__value" style={{ fontSize: '1.1rem' }}>{currentJob.allureReport.total}</span>
                                         </div>
                                       </div>
                                     </div>

                                   </div>

                                   {/* Individual test results for this project */}
                                   <div className="card" style={{ padding: '1rem' }}>
                                     <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                                       <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                         Test Results · <code style={{ fontSize: '0.8rem' }}>{currentJob.project}</code>
                                       </h3>
                                       <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                         {currentJob.allureReport.total} tests
                                       </span>
                                     </div>
                                     <TestList key={currentJob.id} tests={currentJob.allureReport.tests} />
                                   </div>

                                   {/* Terminal Console Logs Window */}
                                   <div className="card" style={{ padding: '1rem' }}>
                                     <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                       <Terminal size={16} style={{ color: 'var(--color-success)' }} />
                                       <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>Terminal Run Console Logs</h3>
                                     </div>
                                     <pre style={{
                                       fontFamily: 'var(--font-mono)',
                                       fontSize: '0.75rem',
                                       background: '#05070C',
                                       padding: '1rem',
                                       borderRadius: '8px',
                                       color: '#10B981',
                                       maxHeight: '320px',
                                       overflowY: 'auto',
                                       border: '1px solid var(--border-color)',
                                       whiteSpace: 'pre-wrap',
                                       boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)'
                                     }} id="console-terminal">
                                       {isLoadingLogs ? '📥 Downloading console logs from GitHub...' : activeJobLogs}
                                     </pre>
                                   </div>

                                 </div>
                               )}

                            </div>
                          </div>

                        </div>
                      ) : dashboardTab === 'insights' ? (

                        /* Insights tab: clusters, flaky candidates, slowest tests, explorer */
                        <div className="animate-fade-in">
                          <Insights run={selectedRun} runs={runs} />
                        </div>
                      ) : (

                        /* Compare Runs tab */
                        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          <div className="card" style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                              Compare Active <strong>Run #{selectedRun.runNumber}</strong> against:
                            </span>
                            <select
                              value={compareRunId}
                              onChange={(e) => setCompareRunId(e.target.value)}
                              style={{
                                background: 'var(--surface-2)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '6px',
                                padding: '0.4rem 0.8rem',
                                fontSize: '0.85rem',
                                color: 'var(--text-primary)',
                                outline: 'none',
                                cursor: 'pointer'
                              }}
                            >
                              {runs
                                .filter(r => r.id !== selectedRun.id)
                                .map(run => (
                                  <option key={run.id} value={run.id} style={{ background: '#FFFFFF' }}>
                                    Run #{run.runNumber} - {run.conclusion === 'success' ? '✅' : '❌'} ({run.commitSha})
                                  </option>
                                ))}
                            </select>
                          </div>
                          
                          {comparisonRun ? (
                            <CompareRuns runA={selectedRun} runB={comparisonRun} />
                          ) : (
                            <div style={{ textAlign: 'center', padding: '3rem' }}>
                              <p style={{ color: 'var(--text-secondary)' }}>Please select a run to compare against.</p>
                            </div>
                          )}
                        </div>

                      )}

                    </div>

                    {/* Right column AI sidebar */}
                    {showChat && selectedRun && (
                      <div style={{ position: 'sticky', top: '90px' }}>
                        <AIChat 
                          selectedRun={selectedRun} 
                          comparisonRun={dashboardTab === 'compare' ? comparisonRun : undefined}
                          model={currentModel}
                        />
                      </div>
                    )}

                  </div>

                )}

              </div>

            </div>

          </div>
        )}

      </main>

      {/* BROWSE REPOSITORIES MODAL */}
      {showAddRepoModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(28, 25, 23, 0.45)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div className="card animate-fade-in" style={{ width: '100%', maxWidth: '640px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.35rem', fontFamily: 'var(--font-display)' }}>Browse Repositories</h2>
              <button
                onClick={() => setShowAddRepoModal(false)}
                style={{ color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>


            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="text"
                  placeholder="Search user repositories..."
                  className="input-field"
                  style={{ paddingLeft: '2.5rem' }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button type="submit" className="btn">Search</button>
            </form>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '400px', paddingRight: '0.25rem' }}>
              {isLoadingRepos ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <RefreshCw className="animate-spin" size={24} style={{ color: 'var(--color-accent)', marginBottom: '0.5rem' }} />
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading repositories...</p>
                </div>
              ) : repos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  No repositories found.
                </div>
              ) : (
                repos.map(repo => {
                  const isBookmarked = bookmarkedIds.includes(repo.id);
                  return (
                    <div 
                      key={repo.id}
                      onClick={() => handleAddRepoSelect(repo)}
                      style={{
                        background: 'var(--surface-1)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        padding: '0.75rem 1rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                        e.currentTarget.style.backgroundColor = 'var(--surface-2)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-color)';
                        e.currentTarget.style.backgroundColor = 'var(--surface-1)';
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: '75%' }}>
                        <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{repo.fullName}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {repo.description}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleBookmark(repo);
                        }}
                        style={{ color: isBookmarked ? 'var(--color-skipped)' : 'var(--text-muted)', padding: '0.5rem' }}
                      >
                        <Star size={16} fill={isBookmarked ? 'var(--color-skipped)' : 'transparent'} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS CONFIGURATION MODAL */}
      {showSettingsModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(28, 25, 23, 0.45)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: '520px', padding: '2rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.4rem', fontFamily: 'var(--font-display)' }}>
                Settings & API Configurations
              </h2>
              <button 
                onClick={() => setShowSettingsModal(false)}
                style={{ color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                  1. GitHub Connection
                </h3>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', display: 'block' }}>
                    Personal Access Token (PAT)
                  </label>
                  <input 
                    type="password"
                    value={githubTokenInput}
                    onChange={(e) => setGithubTokenInput(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    className="input-field"
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                  {isMockMode ? (
                    <button 
                      type="button" 
                      className="btn" 
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                      onClick={() => {
                        if(githubTokenInput.trim()) {
                          githubService.setToken(githubTokenInput.trim());
                          handleGithubStateChange();
                        } else {
                          alert("Please enter a valid GitHub token first!");
                        }
                      }}
                    >
                      Authenticate Token
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: 500 }}>
                        ● Connected as @{username}
                      </span>
                      <button 
                        type="button" 
                        className="btn btn-danger" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        onClick={handleLogout}
                      >
                        Disconnect Account
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                  2. Cloud LLM Models Configuration
                </h3>
                
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>
                    OpenAI API Key
                  </label>
                  <input 
                    type="password"
                    value={openaiKeyInput}
                    onChange={(e) => setOpenaiKeyInput(e.target.value)}
                    placeholder="sk-proj-..."
                    className="input-field"
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>
                    Google Gemini API Key
                  </label>
                  <input 
                    type="password"
                    value={geminiKeyInput}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                    placeholder="AIzaSy..."
                    className="input-field"
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>
                    Anthropic Claude Key
                  </label>
                  <input 
                    type="password"
                    value={anthropicKeyInput}
                    onChange={(e) => setAnthropicKeyInput(e.target.value)}
                    placeholder="sk-ant-..."
                    className="input-field"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                  3. Local LLaMA / Custom LLM Server
                </h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>
                      Ollama Endpoint URL
                    </label>
                    <input 
                      type="text"
                      value={ollamaUrlInput}
                      onChange={(e) => setOllamaUrlInput(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>
                      Model Tag
                    </label>
                    <input 
                      type="text"
                      value={ollamaModelInput}
                      onChange={(e) => setOllamaModelInput(e.target.value)}
                      placeholder="llama3"
                      className="input-field"
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setShowSettingsModal(false)}
                  style={{ padding: '0.5rem 1rem' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn"
                  style={{ padding: '0.5rem 1.25rem' }}
                >
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

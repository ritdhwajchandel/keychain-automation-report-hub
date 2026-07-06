# Keychain Automation Console

### 🌐 Live app: **https://ritdhwajchandel.github.io/keychain-automation-report-hub/**

A single pane of glass for GitHub Actions test runs. Point it at your automation
repos and it turns raw workflow logs into accurate pass/fail reports, per-project
test lists, failure categories, flaky-test detection, and run-over-run trends —
no reporter plugins or CI changes required.

It runs **entirely in your browser** — no backend. Your GitHub token is kept in
your browser's `localStorage` and is only ever sent directly to the GitHub API.
Open the link above and connect your GitHub account to analyze your own
workflow runs — the app has no sample data and shows nothing until you connect.

## What it does

- **Accurate counts from logs** — parses each job's console output (Playwright,
  Jest/Vitest, pytest, JUnit/Maven formats) for exact passed/failed/skipped
  numbers, including Playwright `flaky` and `did not run` buckets. Falls back to
  check-run annotations when logs carry no summary.
- **Per-project test lists** — every test that ran, with status, duration, and
  expandable stack traces pulled from Playwright's failure-details section.
- **Insights per run** (Allure-style layout)
  - *Categories*: failures grouped by normalized error signature — one category
    spanning many projects usually means a shared root cause, not N test bugs.
  - *Flaky candidates*: tests that both passed and failed across run history,
    with a per-run status timeline.
  - *Slowest tests* and a cross-project *Test Explorer* with search + filters.
- **Trends & history** — analyze all listed runs once; pass-rate trends, per-run
  stats, and flaky data persist in localStorage and survive reloads.
- **Run comparison** — regressions and resolved failures between any two runs,
  matched by real test names.
- **Favorites dashboard** — star repos and workflows; the home page shows a
  health card per favorite with the trend, recent runs, and one-click
  Compare / Details deep links.
- **AI analyst** — optional chat over the selected run (OpenAI, Gemini,
  Anthropic, or a local Ollama model).

## Getting started

The fastest way is the hosted app —
**[open it here](https://ritdhwajchandel.github.io/keychain-automation-report-hub/)** —
no install required. To run it locally instead:

```bash
npm install
npm run dev        # http://localhost:5173
```

Either way, you'll be prompted to **connect GitHub** on first load — the app has
no built-in sample data and reads your workflow runs on demand once connected.

### Connect GitHub

1. Create a [fine-grained personal access token](https://github.com/settings/tokens)
   with read access to **Actions** (workflow runs, jobs, logs) and **Checks**
   (annotations) for your automation repos. A classic token with `repo` scope
   also works.
2. Open **Settings** in the navbar, paste the token, and click
   **Authenticate Token**.

Tokens are stored in your browser's localStorage only — nothing is sent
anywhere except directly to the GitHub API.

### Optional: AI analyst

Add an OpenAI / Gemini / Anthropic API key in Settings, or point the local
option at an [Ollama](https://ollama.com) server. Keys stay in localStorage.

## Getting the best data quality

The console reads whatever your jobs print, but per-test detail depends on the
reporter:

| Reporter | Counts | Test names | Stack traces |
|---|---|---|---|
| Playwright `list` (+ `blob`/`allure`) | ✅ | ✅ | ✅ |
| Playwright `dot` | ✅ | failed only | ✅ |
| Jest / Vitest / pytest / JUnit summaries | ✅ | — | — |

For Playwright, `--reporter=list,blob` in CI gives full fidelity.

Two workflow-shape assumptions worth knowing:

- Matrix jobs named `test (<project>)` are treated as projects (e.g.
  `test (os-vendor)` → `os-vendor`).
- A job that is green but has failed tests usually means the step uses
  `continue-on-error` — counts come from the logs, not the job conclusion.

## Usage tips

- Click **Analyze history** on a workflow's runs list once — it parses every
  listed run (cached and persisted), unlocking trends, per-run stats, and flaky
  detection. New runs only need re-analysis for themselves.
- Star a workflow (hover its sidebar row) to pin it to the home dashboard and
  auto-select it when opening the repo.

## Stack

React 19 + TypeScript + Vite. No backend — the browser talks to the GitHub API
directly. Lint with `npm run lint` (oxlint), build with `npm run build`.

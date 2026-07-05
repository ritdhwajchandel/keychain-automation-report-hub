import type { WorkflowRunReport } from './github';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type LLMModel = 'local-llama' | 'openai' | 'gemini' | 'anthropic';

export class AIService {
  private apiKeys: Record<string, string> = {};
  private ollamaUrl: string = '';
  private ollamaModel: string = '';

  constructor() {
    this.apiKeys = {
      openai: localStorage.getItem('apikey_openai') || '',
      gemini: localStorage.getItem('apikey_gemini') || '',
      anthropic: localStorage.getItem('apikey_anthropic') || '',
    };
    this.ollamaUrl = localStorage.getItem('ollama_url') || 'http://localhost:11434';
    this.ollamaModel = localStorage.getItem('ollama_model') || 'llama3';
  }

  setOllamaConfig(url: string, model: string) {
    this.ollamaUrl = url;
    this.ollamaModel = model;
    localStorage.setItem('ollama_url', url);
    localStorage.setItem('ollama_model', model);
  }

  getOllamaUrl(): string {
    return this.ollamaUrl;
  }

  getOllamaModel(): string {
    return this.ollamaModel;
  }

  setApiKey(provider: string, key: string) {
    this.apiKeys[provider] = key;
    localStorage.setItem(`apikey_${provider}`, key);
  }

  getApiKey(provider: string): string {
    return this.apiKeys[provider] || '';
  }

  hasKey(provider: string): boolean {
    return !!this.apiKeys[provider];
  }

  // A local rule-based intelligence simulator for Local LLaMA based on run jobs & allure reports
  private simulateLocalLlama(prompt: string, runData: WorkflowRunReport, comparisonRun?: WorkflowRunReport): string {
    const promptLower = prompt.toLowerCase();
    
    // Calculate basic failures
    const failedJobs = runData.jobs.filter(j => j.status === 'failure');
    const totalFailedTests = runData.jobs.reduce((acc, j) => acc + j.allureReport.failed, 0);
    const totalPassedTests = runData.jobs.reduce((acc, j) => acc + j.allureReport.passed, 0);
    const totalSkippedTests = runData.jobs.reduce((acc, j) => acc + j.allureReport.skipped, 0);
    const totalTests = runData.jobs.reduce((acc, j) => acc + j.allureReport.total, 0);

    // Question about comparison
    if (comparisonRun && (promptLower.includes('compare') || promptLower.includes('diff') || promptLower.includes('difference'))) {
      const runA = runData;
      const runB = comparisonRun;

      const failedA = runA.jobs.reduce((acc, j) => acc + j.allureReport.failed, 0);
      const failedB = runB.jobs.reduce((acc, j) => acc + j.allureReport.failed, 0);

      let response = `### 🦙 Local LLaMA: Run Comparison Analysis\n\n`;
      response += `Comparing **Run #${runA.runNumber}** (Selected) with **Run #${runB.runNumber}**:\n\n`;
      response += `- **Run #${runA.runNumber}**: ${failedA === 0 ? '✅ Passed' : `❌ Failed (${failedA} failures)`} (Duration: ${runA.durationSeconds}s)\n`;
      response += `- **Run #${runB.runNumber}**: ${failedB === 0 ? '✅ Passed' : `❌ Failed (${failedB} failures)`} (Duration: ${runB.durationSeconds}s)\n\n`;

      // Regressions check
      const regressions: string[] = [];
      const fixed: string[] = [];

      runA.jobs.forEach(jobA => {
        const jobB = runB.jobs.find(j => j.name === jobA.name);
        if (jobB) {
          jobA.allureReport.tests.forEach(testA => {
            const testB = jobB.allureReport.tests.find(t => t.name === testA.name);
            if (testB) {
              if (testA.status === 'failed' && testB.status === 'passed') {
                regressions.push(`**${jobA.name}** \\> \`${testA.name}\` (New Failure)`);
              } else if (testA.status === 'passed' && testB.status === 'failed') {
                fixed.push(`**${jobA.name}** \\> \`${testA.name}\` (Resolved Failure)`);
              }
            }
          });
        }
      });

      if (regressions.length > 0) {
        response += `#### 🚨 New Regressions in Run #${runA.runNumber}:\n`;
        regressions.forEach(r => response += `- ${r}\n`);
      } else {
        response += `✅ **No new regressions found** in Run #${runA.runNumber} compared to Run #${runB.runNumber}.\n`;
      }

      if (fixed.length > 0) {
        response += `\n#### 🎉 Resolved Issues in Run #${runA.runNumber}:\n`;
        fixed.forEach(f => response += `- ${f}\n`);
      }

      return response;
    }

    // Question about specific failures
    if (promptLower.includes('fail') || promptLower.includes('error') || promptLower.includes('broken') || promptLower.includes('issue')) {
      if (totalFailedTests === 0) {
        return `### 🦙 Local LLaMA:\nAll test runs passed successfully in Run #${runData.runNumber}! There are no failed tests or errors to analyze.`;
      }

      let response = `### 🦙 Local LLaMA: Failure Report Analysis\n\n`;
      response += `Here is the analysis of **${totalFailedTests} failures** in **Run #${runData.runNumber}**:\n\n`;

      failedJobs.forEach(job => {
        response += `#### 📁 Project/Job: ${job.name}\n`;
        job.allureReport.tests.filter(t => t.status === 'failed').forEach(test => {
          response += `- ❌ **\`${test.name}\`**\n`;
          if (test.error) {
            response += `  - **Error**: \`${test.error}\`\n`;
            if (test.error.includes('AssertionError')) {
              response += `  - **Root Cause Suggestion**: Playwright assertion failed due to code or backend state mismatch. Verify database seed health.\n`;
            } else if (test.error.includes('TimeoutError')) {
              response += `  - **Root Cause Suggestion**: Selector load timeout (>30000ms). The backend might be slow or element selectors changed.\n`;
            } else if (test.error.includes('TypeError')) {
              response += `  - **Root Cause Suggestion**: Unhandled undefined access. Check parsing schemas.\n`;
            }
          }
        });
      });

      return response;
    }

    // Question about duration
    if (promptLower.includes('time') || promptLower.includes('duration') || promptLower.includes('slow') || promptLower.includes('fast')) {
      const slowestJob = [...runData.jobs].sort((a, b) => b.durationSeconds - a.durationSeconds)[0];
      
      return `### 🦙 Local LLaMA: Performance & Execution Duration Analysis\n\n` +
        `- **Total Run Duration**: ${runData.durationSeconds} seconds\n` +
        `- **Total Executed Tests**: ${totalTests} tests\n` +
        `- **Slowest Project Job**: \`${slowestJob.name}\` (taking ${slowestJob.durationSeconds}s)\n\n` +
        `**Optimization Suggestion**:\n` +
        `To speed up the pipeline, consider executing test cases in parallel, running matrix setups across more runners, or optimizing dependencies installation.`;
    }

    // Default reply
    return `### 🦙 Local LLaMA (Offline Mode)\n\n` +
      `Hello! I am your Local LLaMA analyzer. I have loaded the test execution report context for **Run #${runData.runNumber}** (triggered by @${runData.triggerer} via ${runData.event}):\n\n` +
      `- **Total Project Jobs**: ${runData.jobs.length}\n` +
      `- **Pass/Fail**: ✅ ${totalPassedTests} passed, ❌ ${totalFailedTests} failed, ⏭️ ${totalSkippedTests} skipped\n\n` +
      `You can ask me questions such as:\n` +
      `1. *"List the test failures and explain their errors."*\n` +
      `2. *"Which test jobs were the slowest?"*\n` +
      `3. *"Compare this run with another run and list new regressions."* *(Be sure to activate comparison view)*\n\n` +
      `*To query actual models in real-time, configure an API key for OpenAI, Gemini, or Anthropic in the settings.*`;
  }

  // Call real AI endpoints if keys are set, otherwise use Mock/Local LLaMA logic
  async queryAI(
    model: LLMModel,
    prompt: string,
    history: ChatMessage[],
    runData: WorkflowRunReport,
    comparisonRun?: WorkflowRunReport
  ): Promise<string> {
    
    if (model === 'local-llama') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 sec timeout
        
        const res = await fetch(`${this.ollamaUrl}/api/generate`, {
          method: 'POST',
          Signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.ollamaModel,
            prompt: `You are analyzing a test execution report.\nReport data: ${JSON.stringify(runData)}\nQuestion: ${prompt}`,
            stream: false
          })
        } as any);
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          return `### 🦙 Ollama [${this.ollamaModel}]:\n\n${data.response || 'No output.'}`;
        }
      } catch (e) {
        console.log("Local Ollama connection failed, using simulator:", e);
      }

      // Simulate local llama instantly with a slight human delay
      await new Promise(r => setTimeout(r, 600));
      return this.simulateLocalLlama(prompt, runData, comparisonRun);
    }

    const providerKey = this.getApiKey(model);
    if (!providerKey) {
      return `❌ API Key for **${model.toUpperCase()}** is missing. Please configure it in the dashboard settings or switch back to the **Local LLaMA** model.`;
    }

    // Build detailed context with all failure data explicitly visible
    const allFailures = runData.jobs.flatMap(job =>
      job.allureReport.tests
        .filter(t => t.status === 'failed')
        .map(t => ({
          testName: t.name,
          project: job.name.replace('test (', '').replace(')', ''),
          jobName: job.name,
          error: t.error || 'No error details captured',
          duration: t.duration || 'N/A'
        }))
    );

    const contextText = `
ROLE: You are the AI Failure Analyst for Keychain Automation Console. Your ONLY job is to analyze the ACTUAL test failure data provided below.

RUN METADATA:
- Run #${runData.runNumber} | Repo: "${runData.name}"
- Triggered by: ${runData.triggerer} | Event: ${runData.event} | Duration: ${runData.durationSeconds}s
- Conclusion: ${runData.conclusion}
- STATS: ${runData.jobs.reduce((acc, j) => acc + j.allureReport.passed, 0)} PASSED | ${runData.jobs.reduce((acc, j) => acc + j.allureReport.failed, 0)} FAILED | ${runData.jobs.reduce((acc, j) => acc + j.allureReport.skipped, 0)} SKIPPED

===== ALL TEST FAILURES (${allFailures.length} total) =====
${allFailures.length === 0 ? 'NO FAILURES IN THIS RUN' : allFailures.map((f, i) => `
${i + 1}. Test: ${f.testName}
   Project: ${f.project}
   Job: ${f.jobName}
   Error: ${f.error.substring(0, 300)}${f.error.length > 300 ? '...' : ''}
   Duration: ${f.duration}
`).join('')}

${comparisonRun ? `
===== COMPARISON WITH RUN #${comparisonRun.runNumber} =====
${JSON.stringify(comparisonRun.jobs.map(j => ({
  project: j.name.replace('test (', '').replace(')', ''),
  passed: j.allureReport.passed,
  failed: j.allureReport.failed,
  failures: j.allureReport.tests.filter(t => t.status === 'failed').map(t => t.name)
})), null, 2)}
` : ''}

**MANDATORY RESPONSE FORMAT:**
1. ALWAYS use tables/structured format (Markdown table preferred)
2. Group failures by: Error Type (timeout, assertion, setup, network, etc)
3. For each group: show test names, affected projects, root cause, recommendation
4. Identify patterns: which errors appear in multiple projects? (indicates systemic issue)
5. Highlight: are failures isolated to one project or widespread?
6. If comparison run exists: mark each failure as NEW, RECURRING, or FIXED

**YOUR INSTRUCTIONS:**
- Answer ONLY based on the failure data above
- If asked about failures, return a table analysis
- If asked about patterns, group by error type and show affected tests
- If asked about comparison, show new vs recurring vs fixed failures
- Do NOT give generic advice - be specific to these failures
- Do NOT ignore the error details - analyze them
    `;

    try {
      if (model === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${providerKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: `${contextText}\n\nUser Question: ${prompt}` }] }
            ]
          })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated from Gemini.';
      }

      if (model === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${providerKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: contextText },
              ...history.map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: prompt }
            ]
          })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        return data.choices?.[0]?.message?.content || 'No response from OpenAI.';
      }

      if (model === 'anthropic') {
        return `⚠️ Claude API call intercepted: Claude doesn't allow direct browser-to-API requests (CORS constraints). For client-only apps, we recommend using Gemini or OpenAI which support direct API requests, or switching to Local LLaMA.
        
Here is the local response for your query:
${this.simulateLocalLlama(prompt, runData, comparisonRun)}`;
      }

      return 'Unsupported model selected.';
    } catch (err: any) {
      console.error(err);
      return `❌ Error querying ${model.toUpperCase()} API: ${err.message || err}. Check your API key validity and network connection.`;
    }
  }
}

export const aiService = new AIService();

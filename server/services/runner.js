const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db');

// Map of runId -> child process for cancellation
const processes = new Map();

// Map of runId -> accumulated log string
const logs = new Map();

// Map of runId -> temp event file path (for cleanup)
const eventFiles = new Map();

// Broadcast function, set by index.js after WebSocket is initialized
let broadcast = null;

function setBroadcast(fn) {
  broadcast = fn;
}

function emitWs(type, data) {
  if (broadcast) {
    broadcast(JSON.stringify({ type, ...data }));
  }
}

/**
 * Get the full run object with jobs for broadcasting.
 */
function getRunForBroadcast(runId) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run) return null;

  const repo = db.prepare('SELECT name FROM repos WHERE id = ?').get(run.repo_id);
  const jobs = db.prepare('SELECT * FROM jobs WHERE run_id = ?').all(runId);

  return {
    id: run.id,
    repoId: run.repo_id,
    repoName: repo ? repo.name : null,
    workflowFile: run.workflow_file,
    workflowName: run.workflow_name,
    status: run.status,
    event: run.event,
    branch: run.branch,
    commitMessage: run.commit_message,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    duration: run.started_at && run.completed_at
      ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
      : null,
    jobs: jobs.map(j => ({
      id: j.id,
      name: j.name,
      status: j.status,
    })),
  };
}

/**
 * Generate an event payload JSON file for act.
 * This provides github context variables like github.base_ref, github.head_ref, etc.
 */
function generateEventPayload(event, repoPath, branch) {
  let commitSha = '';
  let commitMessage = '';
  let defaultBranch = 'main';

  try {
    commitSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    commitMessage = execSync('git log -1 --pretty=%s', { cwd: repoPath, encoding: 'utf8' }).trim();
    // Try to detect default branch
    try {
      defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s@^refs/remotes/origin/@@"', {
        cwd: repoPath, encoding: 'utf8', shell: true,
      }).trim() || 'main';
    } catch (e) {
      // fallback to main
    }
  } catch (e) {
    // not a git repo
  }

  let payload = {};

  switch (event) {
    case 'pull_request':
      payload = {
        action: 'opened',
        number: 1,
        pull_request: {
          number: 1,
          head: {
            ref: branch || 'feature-branch',
            sha: commitSha,
          },
          base: {
            ref: defaultBranch,
            sha: commitSha,
          },
          title: commitMessage || 'Local test run',
          body: '',
          draft: false,
        },
        sender: {
          login: 'local-user',
        },
      };
      break;

    case 'push':
      payload = {
        ref: `refs/heads/${branch || defaultBranch}`,
        before: '0000000000000000000000000000000000000000',
        after: commitSha,
        head_commit: {
          id: commitSha,
          message: commitMessage,
        },
        sender: {
          login: 'local-user',
        },
      };
      break;

    case 'workflow_dispatch':
      payload = {
        inputs: {},
        ref: `refs/heads/${branch || defaultBranch}`,
        sender: {
          login: 'local-user',
        },
      };
      break;

    default:
      payload = {
        sender: {
          login: 'local-user',
        },
      };
      break;
  }

  // Write to temp file
  const tmpFile = path.join(os.tmpdir(), `act-event-${uuidv4()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2));
  return tmpFile;
}

/**
 * Create a temp copy of a workflow with all job-level `if:` conditions removed.
 * This forces all jobs to run regardless of conditions.
 */
function createForcedWorkflow(repoPath, workflowFile) {
  const yaml = require('js-yaml');
  const srcPath = path.join(repoPath, '.github', 'workflows', workflowFile);
  const content = fs.readFileSync(srcPath, 'utf8');
  const doc = yaml.load(content);

  if (doc && doc.jobs) {
    for (const [jobId, job] of Object.entries(doc.jobs)) {
      if (job && typeof job === 'object') {
        delete job.if;
      }
    }
  }

  const tmpDir = path.join(os.tmpdir(), `act-wf-${uuidv4()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, workflowFile);
  fs.writeFileSync(tmpFile, yaml.dump(doc, { lineWidth: -1, noRefs: true }));
  return { tmpWorkflowDir: tmpDir, tmpWorkflowFile: tmpFile };
}

/**
 * Start a run by spawning the `act` CLI process.
 */
function startRun(runId, repoPath, workflowFile, event, branch, forceAll) {
  const now = new Date().toISOString();

  // Update run status to in_progress
  db.prepare('UPDATE runs SET status = ?, started_at = ? WHERE id = ?')
    .run('in_progress', now, runId);

  emitWs('run:started', { run: getRunForBroadcast(runId) });

  // Generate event payload
  const eventFile = generateEventPayload(event || 'push', repoPath, branch);
  eventFiles.set(runId, eventFile);

  // Build act command arguments
  let workflowPath;
  let tmpWorkflowCleanup = null;

  if (forceAll) {
    // Create a temp workflow with all if: conditions stripped
    const { tmpWorkflowDir } = createForcedWorkflow(repoPath, workflowFile);
    workflowPath = tmpWorkflowDir;
    tmpWorkflowCleanup = tmpWorkflowDir;
  } else {
    workflowPath = `.github/workflows/${workflowFile}`;
  }

  const args = [event || 'push', '-W', workflowPath, '--eventpath', eventFile];

  // Spawn act in the repo directory
  const child = spawn('act', args, {
    cwd: repoPath,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  processes.set(runId, child);
  logs.set(runId, '');

  // Track current job/step context for parsing
  const jobContexts = new Map(); // jobLabel -> { jobId, currentStepId, stepNumber }

  function getJobContext(jobLabel) {
    if (!jobContexts.has(jobLabel)) {
      return null;
    }
    return jobContexts.get(jobLabel);
  }

  function processLine(line) {
    // Accumulate logs
    const currentLog = logs.get(runId) || '';
    logs.set(runId, currentLog + line + '\n');

    // Broadcast log line
    emitWs('run:log', { runId, data: line + '\n' });

    const lineNow = new Date().toISOString();

    // Extract job label from line: [CI/jobname] or [jobname]
    const jobLabelMatch = line.match(/^\[([^\]]+)\]\s*(.*)/);
    if (!jobLabelMatch) return;

    const jobLabel = jobLabelMatch[1];
    const rest = jobLabelMatch[2];

    // Ensure job exists in DB
    let existingJob = db.prepare(
      'SELECT id FROM jobs WHERE run_id = ? AND name = ?'
    ).get(runId, jobLabel);

    if (!existingJob) {
      const jobId = uuidv4();
      db.prepare(
        'INSERT INTO jobs (id, run_id, name, status, started_at) VALUES (?, ?, ?, ?, ?)'
      ).run(jobId, runId, jobLabel, 'in_progress', lineNow);
      jobContexts.set(jobLabel, { jobId, currentStepId: null, stepNumber: 0 });
      emitWs('run:updated', { run: getRunForBroadcast(runId) });
    } else if (!jobContexts.has(jobLabel)) {
      jobContexts.set(jobLabel, { jobId: existingJob.id, currentStepId: null, stepNumber: 0 });
    }

    const ctx = jobContexts.get(jobLabel);

    // Detect step start: "⭐ Run" or "Star Run"
    const stepStartMatch = rest.match(/^(?:⭐|Star)\s+Run\s+(.+)/);
    if (stepStartMatch) {
      // Close previous step if still open
      if (ctx.currentStepId) {
        const prevStep = db.prepare('SELECT status FROM steps WHERE id = ?').get(ctx.currentStepId);
        if (prevStep && prevStep.status === 'in_progress') {
          db.prepare('UPDATE steps SET status = ?, completed_at = ? WHERE id = ?')
            .run('completed', lineNow, ctx.currentStepId);
        }
      }

      ctx.stepNumber++;
      const stepName = stepStartMatch[1].trim();
      const stepId = uuidv4();

      db.prepare(
        'INSERT INTO steps (id, job_id, name, status, number, started_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(stepId, ctx.jobId, stepName, 'in_progress', ctx.stepNumber, lineNow);
      ctx.currentStepId = stepId;

      emitWs('run:updated', { run: getRunForBroadcast(runId) });
      return;
    }

    // Detect step success: "✅  Success" or just "Success"
    const stepSuccessMatch = rest.match(/^(?:✅\s*)?Success\s*(?:-\s+(.+))?/);
    if (stepSuccessMatch && ctx.currentStepId) {
      db.prepare('UPDATE steps SET status = ?, completed_at = ? WHERE id = ?')
        .run('completed', lineNow, ctx.currentStepId);
      ctx.currentStepId = null;
      emitWs('run:updated', { run: getRunForBroadcast(runId) });
      return;
    }

    // Detect step failure: "❌  Failure" or just "Failure"
    const stepFailureMatch = rest.match(/^(?:❌\s*)?Failure\s*(?:-\s+(.+))?/);
    if (stepFailureMatch && ctx.currentStepId) {
      db.prepare('UPDATE steps SET status = ?, completed_at = ? WHERE id = ?')
        .run('failed', lineNow, ctx.currentStepId);
      ctx.currentStepId = null;
      emitWs('run:updated', { run: getRunForBroadcast(runId) });
      return;
    }

    // Detect job completion: "🏁" or "Finishing" or "Job succeeded" / "Job failed"
    const jobDoneMatch = rest.match(/^(?:🏁|Finishing)\s+/) || rest.match(/^Job (succeeded|failed)/);
    if (jobDoneMatch) {
      // Close any open step
      if (ctx.currentStepId) {
        db.prepare('UPDATE steps SET status = ?, completed_at = ? WHERE id = ?')
          .run('completed', lineNow, ctx.currentStepId);
        ctx.currentStepId = null;
      }

      // Determine job status from its steps
      const failedSteps = db.prepare(
        'SELECT COUNT(*) as count FROM steps WHERE job_id = ? AND status = ?'
      ).get(ctx.jobId, 'failed');

      const jobStatus = (failedSteps && failedSteps.count > 0) ? 'failed' : 'completed';

      db.prepare('UPDATE jobs SET status = ?, completed_at = ? WHERE id = ?')
        .run(jobStatus, lineNow, ctx.jobId);

      emitWs('run:updated', { run: getRunForBroadcast(runId) });
      return;
    }

    // Detect action download lines (☁ git clone) - create a "Downloading actions" step if none active
    const downloadMatch = rest.match(/^(?:☁)\s+(.*)/);
    if (downloadMatch && !ctx.currentStepId) {
      ctx.stepNumber++;
      const stepId = uuidv4();
      db.prepare(
        'INSERT INTO steps (id, job_id, name, status, number, started_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(stepId, ctx.jobId, 'Downloading actions', 'in_progress', ctx.stepNumber, lineNow);
      ctx.currentStepId = stepId;
      emitWs('run:updated', { run: getRunForBroadcast(runId) });
    }

    // Capture log output for current step (lines with " | " prefix)
    const logLineMatch = rest.match(/^\|\s+(.*)/);
    if (logLineMatch && ctx.currentStepId) {
      const logContent = logLineMatch[1];
      db.prepare('UPDATE steps SET log = log || ? WHERE id = ?')
        .run(logContent + '\n', ctx.currentStepId);
    }

    // Capture docker/setup/download lines as step log
    const infraMatch = rest.match(/^(?:🚀|🐳|☁|docker)\s+(.*)/i);
    if (infraMatch && ctx.currentStepId) {
      db.prepare('UPDATE steps SET log = log || ? WHERE id = ?')
        .run(rest + '\n', ctx.currentStepId);
    }
  }

  // Process stdout
  let stdoutBuffer = '';
  child.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        processLine(line);
      }
    }
  });

  // Process stderr (act outputs progress info to stderr)
  let stderrBuffer = '';
  child.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        processLine(line);
      }
    }
  });

  child.on('close', (code) => {
    // Flush remaining buffers
    if (stdoutBuffer.trim()) processLine(stdoutBuffer.trim());
    if (stderrBuffer.trim()) processLine(stderrBuffer.trim());

    processes.delete(runId);

    // Clean up temp files
    const ef = eventFiles.get(runId);
    if (ef) {
      try { fs.unlinkSync(ef); } catch (e) {}
      eventFiles.delete(runId);
    }
    if (tmpWorkflowCleanup) {
      try { fs.rmSync(tmpWorkflowCleanup, { recursive: true }); } catch (e) {}
      tmpWorkflowCleanup = null;
    }

    const completedAt = new Date().toISOString();

    // Check current status (might have been cancelled)
    const currentRun = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId);
    if (currentRun && currentRun.status === 'cancelled') {
      emitWs('run:completed', { run: getRunForBroadcast(runId) });
      return;
    }

    const finalStatus = code === 0 ? 'completed' : 'failed';

    db.prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
      .run(finalStatus, completedAt, runId);

    // Mark any remaining in_progress jobs/steps
    const openJobs = db.prepare(
      'SELECT id FROM jobs WHERE run_id = ? AND status = ?'
    ).all(runId, 'in_progress');

    for (const job of openJobs) {
      db.prepare('UPDATE jobs SET status = ?, completed_at = ? WHERE id = ?')
        .run(finalStatus, completedAt, job.id);

      db.prepare(
        'UPDATE steps SET status = ?, completed_at = ? WHERE job_id = ? AND status IN (?, ?)'
      ).run(finalStatus, completedAt, job.id, 'in_progress', 'queued');
    }

    emitWs('run:completed', { run: getRunForBroadcast(runId) });
  });

  child.on('error', (err) => {
    processes.delete(runId);
    const completedAt = new Date().toISOString();

    // Clean up temp files
    const ef = eventFiles.get(runId);
    if (ef) {
      try { fs.unlinkSync(ef); } catch (e) {}
      eventFiles.delete(runId);
    }
    if (tmpWorkflowCleanup) {
      try { fs.rmSync(tmpWorkflowCleanup, { recursive: true }); } catch (e) {}
      tmpWorkflowCleanup = null;
    }

    const currentLog = logs.get(runId) || '';
    logs.set(runId, currentLog + `\nError: ${err.message}\n`);

    db.prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
      .run('failed', completedAt, runId);

    emitWs('run:completed', { run: getRunForBroadcast(runId) });
  });
}

/**
 * Cancel a running act process.
 */
function cancelRun(runId) {
  const child = processes.get(runId);
  if (child) {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (processes.has(runId)) {
        child.kill('SIGKILL');
      }
    }, 5000);
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
    .run('cancelled', now, runId);

  const jobs = db.prepare(
    'SELECT id FROM jobs WHERE run_id = ? AND status IN (?, ?)'
  ).all(runId, 'in_progress', 'queued');

  for (const job of jobs) {
    db.prepare('UPDATE jobs SET status = ?, completed_at = ? WHERE id = ?')
      .run('cancelled', now, job.id);

    db.prepare(
      'UPDATE steps SET status = ?, completed_at = ? WHERE job_id = ? AND status IN (?, ?)'
    ).run('cancelled', now, job.id, 'in_progress', 'queued');
  }

  processes.delete(runId);

  // Clean up event file
  const ef = eventFiles.get(runId);
  if (ef) {
    try { fs.unlinkSync(ef); } catch (e) {}
    eventFiles.delete(runId);
  }
}

/**
 * Get accumulated logs for a run.
 */
function getLogs(runId) {
  return logs.get(runId) || '';
}

module.exports = { startRun, cancelRun, getLogs, setBroadcast };

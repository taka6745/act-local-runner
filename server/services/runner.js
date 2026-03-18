const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// Map of runId -> child process for cancellation
const processes = new Map();

// Map of runId -> accumulated log string
const logs = new Map();

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
 * Start a run by spawning the `act` CLI process.
 */
function startRun(runId, repoPath, workflowFile, event, branch) {
  const now = new Date().toISOString();

  // Update run status to in_progress
  db.prepare('UPDATE runs SET status = ?, started_at = ? WHERE id = ?')
    .run('in_progress', now, runId);

  emitWs('run:started', { run: getRunForBroadcast(runId) });

  // Build act command arguments
  const workflowPath = `.github/workflows/${workflowFile}`;
  const args = [event || 'push', '-W', workflowPath];

  // Spawn act in the repo directory
  const child = spawn('act', args, {
    cwd: repoPath,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  processes.set(runId, child);
  logs.set(runId, '');

  // Track current job/step context for parsing
  let currentJobId = null;
  let currentStepId = null;
  let stepNumber = 0;

  function processLine(line) {
    // Accumulate logs
    const currentLog = logs.get(runId) || '';
    logs.set(runId, currentLog + line + '\n');

    // Broadcast log line
    emitWs('run:log', { runId, data: line + '\n' });

    const lineNow = new Date().toISOString();

    // Detect job start: lines like "[workflow/jobname]" or "[jobname]"
    const jobMatch = line.match(/^\[([^\]]+)\]\s*/);
    if (jobMatch) {
      const jobLabel = jobMatch[1];

      // Check if this is a new job we haven't seen
      const existingJob = db.prepare(
        'SELECT id FROM jobs WHERE run_id = ? AND name = ?'
      ).get(runId, jobLabel);

      if (!existingJob) {
        const jobId = uuidv4();
        db.prepare(
          'INSERT INTO jobs (id, run_id, name, status, started_at) VALUES (?, ?, ?, ?, ?)'
        ).run(jobId, runId, jobLabel, 'in_progress', lineNow);
        currentJobId = jobId;
        stepNumber = 0;
        currentStepId = null;

        emitWs('run:updated', { run: getRunForBroadcast(runId) });
      } else {
        currentJobId = existingJob.id;
      }
    }

    // Detect step start: "Star Run" or "Run" lines (act uses star emoji)
    const stepStartMatch = line.match(/^\[([^\]]+)\]\s+(?:⭐|Star)\s+Run\s+(.+)/);
    if (stepStartMatch && currentJobId) {
      stepNumber++;
      const stepName = stepStartMatch[2].trim();
      const stepId = uuidv4();

      db.prepare(
        'INSERT INTO steps (id, job_id, name, status, number, started_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(stepId, currentJobId, stepName, 'in_progress', stepNumber, lineNow);
      currentStepId = stepId;

      emitWs('run:updated', { run: getRunForBroadcast(runId) });
    }

    // Detect step success
    const stepSuccessMatch = line.match(/^\[([^\]]+)\]\s+(?:✅|Success)\s*(?:-\s+(.+))?/);
    if (stepSuccessMatch && currentStepId) {
      db.prepare(
        'UPDATE steps SET status = ?, completed_at = ? WHERE id = ?'
      ).run('completed', lineNow, currentStepId);
      currentStepId = null;

      emitWs('run:updated', { run: getRunForBroadcast(runId) });
    }

    // Detect step failure
    const stepFailureMatch = line.match(/^\[([^\]]+)\]\s+(?:❌|Failure)\s*(?:-\s+(.+))?/);
    if (stepFailureMatch && currentStepId) {
      db.prepare(
        'UPDATE steps SET status = ?, completed_at = ? WHERE id = ?'
      ).run('failed', lineNow, currentStepId);
      currentStepId = null;

      emitWs('run:updated', { run: getRunForBroadcast(runId) });
    }

    // Detect job completion
    const jobCompleteMatch = line.match(/^\[([^\]]+)\]\s+(?:🏁|Finishing)\s+/);
    if (jobCompleteMatch && currentJobId) {
      // Determine job status from its steps
      const failedSteps = db.prepare(
        'SELECT COUNT(*) as count FROM steps WHERE job_id = ? AND status = ?'
      ).get(currentJobId, 'failed');

      const jobStatus = failedSteps && failedSteps.count > 0 ? 'failed' : 'completed';

      db.prepare(
        'UPDATE jobs SET status = ?, completed_at = ? WHERE id = ?'
      ).run(jobStatus, lineNow, currentJobId);

      currentJobId = null;
      currentStepId = null;
      stepNumber = 0;

      emitWs('run:updated', { run: getRunForBroadcast(runId) });
    }

    // Capture log output for current step (lines with " | " prefix after job tag)
    const logLineMatch = line.match(/^\[([^\]]+)\]\s+\|\s+(.*)/);
    if (logLineMatch && currentStepId) {
      const logContent = logLineMatch[2];
      db.prepare(
        'UPDATE steps SET log = log || ? WHERE id = ?'
      ).run(logContent + '\n', currentStepId);
    }
  }

  // Process stdout
  let stdoutBuffer = '';
  child.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // Keep incomplete line in buffer
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

    const completedAt = new Date().toISOString();

    // Check current status (might have been cancelled)
    const currentRun = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId);
    if (currentRun && currentRun.status === 'cancelled') {
      // Already cancelled, don't overwrite
      emitWs('run:completed', { run: getRunForBroadcast(runId) });
      return;
    }

    const finalStatus = code === 0 ? 'completed' : 'failed';

    db.prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
      .run(finalStatus, completedAt, runId);

    // Mark any remaining in_progress jobs/steps as the final status
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

    // Append error to logs
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
    // Give it a moment, then force kill
    setTimeout(() => {
      if (processes.has(runId)) {
        child.kill('SIGKILL');
      }
    }, 5000);
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
    .run('cancelled', now, runId);

  // Cancel all in-progress/queued jobs and steps
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
}

/**
 * Get accumulated logs for a run.
 */
function getLogs(runId) {
  return logs.get(runId) || '';
}

module.exports = { startRun, cancelRun, getLogs, setBroadcast };

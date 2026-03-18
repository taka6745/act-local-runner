const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('../db');
const runner = require('../services/runner');
const { parseWorkflow } = require('../services/parser');

const router = express.Router();

// GitHub Actions pricing per minute (USD)
const RATES = {
  'ubuntu-latest': 0.008,
  'ubuntu-22.04': 0.008,
  'ubuntu-20.04': 0.008,
  'windows-latest': 0.016,
  'windows-2022': 0.016,
  'macos-latest': 0.08,
  'macos-14': 0.08,
  'macos-13': 0.08,
  'macos-12': 0.08,
  _default: 0.008, // default to Linux
};

function calculateBilling(jobs) {
  let totalBilledMs = 0;
  let totalCost = 0;

  const jobBilling = jobs.map(job => {
    let durationMs = 0;
    if (job.started_at && job.completed_at) {
      durationMs = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
    }
    // GitHub rounds each job up to the nearest minute
    const billedMinutes = Math.max(1, Math.ceil(durationMs / 60000));
    const rate = RATES._default; // act runs Linux containers
    const cost = billedMinutes * rate;
    totalBilledMs += billedMinutes * 60000;
    totalCost += cost;
    return { name: job.name, billedMinutes, cost };
  });

  return {
    totalBilledMinutes: Math.ceil(totalBilledMs / 60000),
    totalCost: Math.round(totalCost * 10000) / 10000,
    rate: RATES._default,
    perJob: jobBilling,
  };
}

// GET / - list runs with optional filters
router.get('/', (req, res) => {
  try {
    const { repoId, workflow, status } = req.query;

    let sql = `
      SELECT runs.*, repos.name as repo_name
      FROM runs
      LEFT JOIN repos ON runs.repo_id = repos.id
      WHERE 1=1
    `;
    const params = [];

    if (repoId) {
      sql += ' AND runs.repo_id = ?';
      params.push(repoId);
    }
    if (workflow) {
      sql += ' AND runs.workflow_file = ?';
      params.push(workflow);
    }
    if (status) {
      sql += ' AND runs.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY runs.started_at DESC, runs.id DESC';

    const runs = db.prepare(sql).all(...params);

    const result = runs.map(run => {
      const jobs = db.prepare('SELECT * FROM jobs WHERE run_id = ?').all(run.id);
      return {
        id: run.id,
        repoId: run.repo_id,
        repoName: run.repo_name,
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
        billing: run.completed_at ? calculateBilling(jobs) : null,
        jobs: jobs.map(j => ({
          id: j.id,
          name: j.name,
          status: j.status,
        })),
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Error listing runs:', err);
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

// POST / - create and start a new run
router.post('/', (req, res) => {
  try {
    const { repoId, workflowFile, event, branch, inputs } = req.body;

    if (!repoId || !workflowFile) {
      return res.status(400).json({ error: 'repoId and workflowFile are required' });
    }

    const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(repoId);
    if (!repo) {
      return res.status(404).json({ error: 'Repo not found' });
    }

    // Parse workflow to get its name
    let workflowName = workflowFile;
    try {
      const filePath = path.join(repo.path, '.github', 'workflows', workflowFile);
      const parsed = parseWorkflow(filePath);
      workflowName = parsed.name;
    } catch (parseErr) {
      // Use filename as fallback
      workflowName = path.basename(workflowFile, path.extname(workflowFile));
    }

    // Get current branch / commit message from repo
    let currentBranch = branch || null;
    let commitMessage = null;
    try {
      const { execSync } = require('child_process');
      if (!currentBranch) {
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: repo.path,
          encoding: 'utf8',
        }).trim();
      }
      commitMessage = execSync('git log -1 --pretty=%s', {
        cwd: repo.path,
        encoding: 'utf8',
      }).trim();
    } catch (gitErr) {
      // Not a git repo or git not available, that's okay
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const runEvent = event || 'push';

    db.prepare(`
      INSERT INTO runs (id, repo_id, workflow_file, workflow_name, status, event, branch, commit_message, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, repoId, workflowFile, workflowName, 'queued', runEvent, currentBranch, commitMessage, now);

    const run = {
      id,
      repoId,
      repoName: repo.name,
      workflowFile,
      workflowName,
      status: 'queued',
      event: runEvent,
      branch: currentBranch,
      commitMessage,
      startedAt: now,
      completedAt: null,
      duration: null,
      jobs: [],
    };

    // Start the run asynchronously
    setImmediate(() => {
      runner.startRun(id, repo.path, workflowFile, runEvent, currentBranch);
    });

    res.status(201).json(run);
  } catch (err) {
    console.error('Error creating run:', err);
    res.status(500).json({ error: 'Failed to create run' });
  }
});

// GET /:id - get run details with jobs and steps
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const run = db.prepare(`
      SELECT runs.*, repos.name as repo_name
      FROM runs
      LEFT JOIN repos ON runs.repo_id = repos.id
      WHERE runs.id = ?
    `).get(id);

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const jobs = db.prepare('SELECT * FROM jobs WHERE run_id = ? ORDER BY started_at ASC').all(id);

    const jobsWithSteps = jobs.map(job => {
      const steps = db.prepare(
        'SELECT * FROM steps WHERE job_id = ? ORDER BY number ASC'
      ).all(job.id);

      return {
        id: job.id,
        name: job.name,
        status: job.status,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        steps: steps.map(s => ({
          name: s.name,
          status: s.status,
          number: s.number,
          log: s.log,
        })),
      };
    });

    res.json({
      id: run.id,
      repoId: run.repo_id,
      repoName: run.repo_name,
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
      billing: run.completed_at ? calculateBilling(jobs) : null,
      jobs: jobsWithSteps,
    });
  } catch (err) {
    console.error('Error getting run:', err);
    res.status(500).json({ error: 'Failed to get run' });
  }
});

// DELETE /:id - cancel a run
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    runner.cancelRun(id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Error cancelling run:', err);
    res.status(500).json({ error: 'Failed to cancel run' });
  }
});

// GET /:id/logs - get full logs for a run
router.get('/:id/logs', (req, res) => {
  try {
    const { id } = req.params;

    const run = db.prepare('SELECT id FROM runs WHERE id = ?').get(id);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const logText = runner.getLogs(id);
    res.type('text/plain').send(logText);
  } catch (err) {
    console.error('Error getting logs:', err);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

module.exports = router;

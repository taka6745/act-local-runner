const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const router = express.Router();

// GET / - list all repos
router.get('/', (req, res) => {
  try {
    const repos = db.prepare('SELECT * FROM repos ORDER BY added_at DESC').all();
    res.json(repos.map(r => ({
      id: r.id,
      path: r.path,
      name: r.name,
      addedAt: r.added_at,
    })));
  } catch (err) {
    console.error('Error listing repos:', err);
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

// POST / - add a repo
router.post('/', (req, res) => {
  try {
    const { path: repoPath } = req.body;

    if (!repoPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    // Resolve to absolute path
    const absPath = path.resolve(repoPath);

    // Validate path exists
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({ error: 'Path does not exist' });
    }

    // Validate .github/workflows directory exists
    const workflowsDir = path.join(absPath, '.github', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
      return res.status(400).json({ error: 'No .github/workflows directory found at this path' });
    }

    // Check if repo already exists
    const existing = db.prepare('SELECT id FROM repos WHERE path = ?').get(absPath);
    if (existing) {
      return res.status(409).json({ error: 'Repository already added' });
    }

    const id = uuidv4();
    const name = path.basename(absPath);
    const addedAt = new Date().toISOString();

    db.prepare('INSERT INTO repos (id, path, name, added_at) VALUES (?, ?, ?, ?)')
      .run(id, absPath, name, addedAt);

    res.status(201).json({ id, path: absPath, name, addedAt });
  } catch (err) {
    console.error('Error adding repo:', err);
    res.status(500).json({ error: 'Failed to add repo' });
  }
});

// DELETE /:id - delete a repo and all associated data
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const repo = db.prepare('SELECT id FROM repos WHERE id = ?').get(id);
    if (!repo) {
      return res.status(404).json({ error: 'Repo not found' });
    }

    // Delete in order: steps -> jobs -> runs -> repo
    const runs = db.prepare('SELECT id FROM runs WHERE repo_id = ?').all(id);
    for (const run of runs) {
      const jobs = db.prepare('SELECT id FROM jobs WHERE run_id = ?').all(run.id);
      for (const job of jobs) {
        db.prepare('DELETE FROM steps WHERE job_id = ?').run(job.id);
      }
      db.prepare('DELETE FROM jobs WHERE run_id = ?').run(run.id);
    }
    db.prepare('DELETE FROM runs WHERE repo_id = ?').run(id);
    db.prepare('DELETE FROM repos WHERE id = ?').run(id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting repo:', err);
    res.status(500).json({ error: 'Failed to delete repo' });
  }
});

module.exports = router;

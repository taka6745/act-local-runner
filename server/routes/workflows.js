const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { parseWorkflow } = require('../services/parser');

const router = express.Router();

// GET /:repoId/workflows - list workflows for a repo
router.get('/:repoId/workflows', (req, res) => {
  try {
    const { repoId } = req.params;

    const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(repoId);
    if (!repo) {
      return res.status(404).json({ error: 'Repo not found' });
    }

    const workflowsDir = path.join(repo.path, '.github', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(workflowsDir).filter(f =>
      f.endsWith('.yml') || f.endsWith('.yaml')
    );

    const workflows = [];
    for (const file of files) {
      try {
        const filePath = path.join(workflowsDir, file);
        const parsed = parseWorkflow(filePath);
        workflows.push({
          file,
          name: parsed.name,
          triggers: parsed.triggers,
          branches: parsed.branches,
        });
      } catch (parseErr) {
        console.error(`Error parsing workflow ${file}:`, parseErr.message);
        // Skip unparseable files but continue
        workflows.push({
          file,
          name: path.basename(file, path.extname(file)),
          triggers: [],
          branches: [],
        });
      }
    }

    res.json(workflows);
  } catch (err) {
    console.error('Error listing workflows:', err);
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

module.exports = router;

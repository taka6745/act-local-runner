const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Parse a GitHub Actions workflow YAML file.
 * Returns { name, triggers, branches, jobs }.
 */
function parseWorkflow(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.load(content);

  if (!doc || typeof doc !== 'object') {
    throw new Error(`Invalid workflow file: ${filePath}`);
  }

  // Name: use the 'name' field or fall back to filename without extension
  const name = doc.name || path.basename(filePath, path.extname(filePath));

  // Triggers
  const triggers = [];
  const branches = [];

  if (doc.on) {
    if (typeof doc.on === 'string') {
      triggers.push(doc.on);
    } else if (Array.isArray(doc.on)) {
      triggers.push(...doc.on);
    } else if (typeof doc.on === 'object') {
      for (const [eventName, eventConfig] of Object.entries(doc.on)) {
        triggers.push(eventName);
        // Extract branches from push/pull_request configs
        if (eventConfig && typeof eventConfig === 'object') {
          if (Array.isArray(eventConfig.branches)) {
            for (const b of eventConfig.branches) {
              if (!branches.includes(b)) {
                branches.push(b);
              }
            }
          }
        }
      }
    }
  }

  // Jobs
  const jobs = [];
  if (doc.jobs && typeof doc.jobs === 'object') {
    for (const [jobId, jobConfig] of Object.entries(doc.jobs)) {
      jobs.push({
        id: jobId,
        name: (jobConfig && jobConfig.name) || jobId,
      });
    }
  }

  return { name, triggers, branches, jobs };
}

module.exports = { parseWorkflow };

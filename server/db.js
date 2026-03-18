const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'act-runner.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE,
    name TEXT,
    added_at TEXT
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    repo_id TEXT,
    workflow_file TEXT,
    workflow_name TEXT,
    status TEXT,
    event TEXT DEFAULT 'push',
    branch TEXT,
    commit_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id)
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    name TEXT,
    status TEXT DEFAULT 'queued',
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  );

  CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    name TEXT,
    status TEXT DEFAULT 'queued',
    number INTEGER,
    log TEXT DEFAULT '',
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  );
`);

module.exports = db;

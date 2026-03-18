import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import StatusIcon from './StatusIcon';

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function eventLabel(event) {
  switch (event) {
    case 'push':
      return 'push';
    case 'pull_request':
      return 'pull_request';
    case 'workflow_dispatch':
      return 'workflow_dispatch';
    default:
      return event || 'manual';
  }
}

export default function RunsList({ runs, loading, onOpenTrigger, selectedWorkflow }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const filteredRuns = runs.filter((run) => {
    if (statusFilter && run.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchTitle = (run.commitMessage || '').toLowerCase().includes(q);
      const matchWorkflow = (run.workflowName || '').toLowerCase().includes(q);
      const matchBranch = (run.branch || '').toLowerCase().includes(q);
      if (!matchTitle && !matchWorkflow && !matchBranch) return false;
    }
    return true;
  });

  return (
    <div className="runs-list-container">
      <div className="runs-header">
        <div className="runs-header-left">
          <h2 className="runs-title">
            {selectedWorkflow ? '' : 'All workflows'}
          </h2>
        </div>
        <div className="runs-header-right">
          <button className="btn btn-primary" onClick={onOpenTrigger}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 6 }}>
              <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm.75 4.75a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" />
            </svg>
            Run workflow
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-status">
          <select
            className="form-select form-select-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="in_progress">In Progress</option>
            <option value="queued">Queued</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="filter-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--color-fg-muted)" className="search-icon">
            <path d="M10.68 11.74a6 6 0 01-7.922-8.982 6 6 0 018.982 7.922l3.04 3.04a.749.749 0 01-.326 1.275.749.749 0 01-.734-.215l-3.04-3.04zM11.5 7a4.499 4.499 0 10-8.997 0A4.499 4.499 0 0011.5 7z" />
          </svg>
          <input
            type="text"
            className="form-input form-input-sm search-input"
            placeholder="Filter workflow runs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="runs-list">
        {loading && (
          <div className="runs-loading">
            <div className="loading-spinner" />
            <span>Loading workflow runs...</span>
          </div>
        )}

        {!loading && filteredRuns.length === 0 && (
          <div className="runs-empty">
            <svg width="48" height="48" viewBox="0 0 16 16" fill="var(--color-fg-subtle)">
              <path d="M8 0a8 8 0 110 16A8 8 0 018 0zM1.5 8a6.5 6.5 0 1013 0 6.5 6.5 0 00-13 0zm4.879-2.773l3.587 2.574a.25.25 0 010 .398l-3.587 2.574A.25.25 0 016 10.574V5.426a.25.25 0 01.379-.199z" />
            </svg>
            <p className="runs-empty-title">There are no workflow runs yet</p>
            <p className="runs-empty-desc">
              Use the "Run workflow" button to trigger a new workflow run.
            </p>
          </div>
        )}

        {filteredRuns.map((run) => (
          <div key={run.id} className="run-row">
            <div className="run-row-icon">
              <StatusIcon status={run.status} size={20} />
            </div>
            <div className="run-row-content">
              <div className="run-row-title-line">
                <Link to={`/run/${run.id}`} className="run-row-title">
                  {run.commitMessage || 'Manual run'}
                </Link>
              </div>
              <div className="run-row-meta">
                <span className="run-row-workflow">{run.workflowName}</span>
                <span className="run-row-sep">&middot;</span>
                <span className="run-row-branch">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 2, verticalAlign: -1 }}>
                    <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
                  </svg>
                  {run.branch || 'main'}
                </span>
                <span className="run-row-sep">&middot;</span>
                <span className="run-row-event">{eventLabel(run.event)}</span>
                {run.duration != null && (
                  <>
                    <span className="run-row-sep">&middot;</span>
                    <span className="run-row-duration">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 2, verticalAlign: -1 }}>
                        <path d="M5.75.75A.75.75 0 016.5 0h3a.75.75 0 010 1.5h-3A.75.75 0 015.75.75zM8 3.5a5 5 0 100 10 5 5 0 000-10zm-3.5 5a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0zM8.5 5.75a.75.75 0 00-1.5 0V8.5a.75.75 0 00.37.647l1.5.859a.75.75 0 10.741-1.303L8.5 7.8V5.75z" />
                      </svg>
                      {formatDuration(run.duration)}
                    </span>
                  </>
                )}
                <span className="run-row-sep">&middot;</span>
                <span className="run-row-time">{formatRelativeTime(run.startedAt)}</span>
                {run.billing && (
                  <>
                    <span className="run-row-sep">&middot;</span>
                    <span className="run-row-cost" title={`${run.billing.totalBilledMinutes} billed min @ $${run.billing.rate}/min`}>
                      {run.billing.totalCost < 0.01 ? '<$0.01' : `$${run.billing.totalCost.toFixed(2)}`}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="run-row-jobs">
              {run.jobs && run.jobs.map((job) => (
                <span key={job.id} className="run-row-job" title={job.name}>
                  <StatusIcon status={job.status} size={14} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

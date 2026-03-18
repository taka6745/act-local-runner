import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import RepoSelector from './RepoSelector';

export default function Sidebar({
  repos,
  selectedRepo,
  onSelectRepo,
  onAddRepo,
  onDeleteRepo,
  workflows,
  selectedWorkflow,
  onSelectWorkflow,
  runs,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Get last run status for each workflow to show the colored dot
  function getWorkflowStatus(workflowFile) {
    const workflowRuns = runs.filter((r) => r.workflowFile === workflowFile);
    if (workflowRuns.length === 0) return null;
    // Most recent run
    return workflowRuns[0].status;
  }

  function statusDotColor(status) {
    switch (status) {
      case 'completed':
        return 'var(--color-success-fg)';
      case 'failed':
        return 'var(--color-danger-fg)';
      case 'in_progress':
        return 'var(--color-attention-fg)';
      case 'queued':
        return 'var(--color-fg-muted)';
      case 'cancelled':
        return 'var(--color-fg-subtle)';
      default:
        return 'var(--color-fg-subtle)';
    }
  }

  const handleWorkflowClick = (workflowFile) => {
    onSelectWorkflow(workflowFile);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  const handleAllWorkflows = () => {
    onSelectWorkflow(null);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="var(--color-fg-muted)" className="sidebar-icon">
          <path d="M3.5 1.75v11.5c0 .09.048.17.12.217a.75.75 0 01-.24 1.328A1.748 1.748 0 012 13.25V1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v11.5A1.748 1.748 0 0112.62 14.795a.75.75 0 01-.24-1.328.25.25 0 00.12-.217V1.75a.25.25 0 00-.25-.25h-8.5a.25.25 0 00-.25.25z" />
          <path d="M8 4a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5v-1.5A.75.75 0 018 4z" />
        </svg>
        <span className="sidebar-title">Actions</span>
      </div>

      <div className="sidebar-repo-selector">
        <RepoSelector
          repos={repos}
          selectedRepo={selectedRepo}
          onSelectRepo={onSelectRepo}
          onAddRepo={onAddRepo}
          onDeleteRepo={onDeleteRepo}
        />
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Workflows</div>
        <div
          className={`sidebar-nav-item ${selectedWorkflow === null ? 'active' : ''}`}
          onClick={handleAllWorkflows}
        >
          <span className="sidebar-nav-dot" style={{ background: 'var(--color-fg-muted)' }} />
          <span className="sidebar-nav-text">All workflows</span>
        </div>

        {workflows.map((wf) => {
          const status = getWorkflowStatus(wf.file);
          return (
            <div
              key={wf.file}
              className={`sidebar-nav-item ${selectedWorkflow === wf.file ? 'active' : ''}`}
              onClick={() => handleWorkflowClick(wf.file)}
            >
              <span
                className="sidebar-nav-dot"
                style={{ background: statusDotColor(status) }}
              />
              <span className="sidebar-nav-text">{wf.name}</span>
            </div>
          );
        })}

        {selectedRepo && workflows.length === 0 && (
          <div className="sidebar-empty">No workflows found</div>
        )}
      </nav>
    </aside>
  );
}

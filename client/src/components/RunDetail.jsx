import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchRun, cancelRun, createRun, fetchRunLogs } from '../api';
import StatusIcon from './StatusIcon';
import LogViewer from './LogViewer';

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

function formatTimestamp(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString();
}

function statusLabel(status) {
  switch (status) {
    case 'completed': return 'Success';
    case 'failed': return 'Failure';
    case 'in_progress': return 'In progress';
    case 'queued': return 'Queued';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

function stepDuration(step) {
  if (step.startedAt && step.completedAt) {
    return formatDuration(new Date(step.completedAt) - new Date(step.startedAt));
  }
  return '';
}

export default function RunDetail({ lastMessage }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedJobs, setExpandedJobs] = useState({});
  const [expandedSteps, setExpandedSteps] = useState({});
  const [liveLogData, setLiveLogData] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  const loadRun = useCallback(async () => {
    try {
      const data = await fetchRun(id);
      setRun(data);
      // Auto-expand first job
      if (data.jobs && data.jobs.length > 0) {
        setExpandedJobs((prev) => {
          const next = { ...prev };
          if (Object.keys(next).length === 0) {
            next[data.jobs[0].id] = true;
          }
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to load run:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  // Listen for WebSocket updates
  useEffect(() => {
    if (!lastMessage) return;
    const { type, run: wsRun, runId, data } = lastMessage;

    if ((type === 'run:updated' || type === 'run:completed' || type === 'run:started') && wsRun && wsRun.id === id) {
      // Reload to get full detail (with steps)
      loadRun();
    }

    if (type === 'run:log' && runId === id && data) {
      setLiveLogData((prev) => prev + data);
    }
  }, [lastMessage, id, loadRun]);

  const handleCancel = async () => {
    if (!run) return;
    setCancelling(true);
    try {
      await cancelRun(run.id);
      loadRun();
    } catch (err) {
      alert('Failed to cancel: ' + err.message);
    } finally {
      setCancelling(false);
    }
  };

  const handleRerun = async () => {
    if (!run) return;
    setRerunning(true);
    try {
      const newRun = await createRun({
        repoId: run.repoId,
        workflowFile: run.workflowFile,
        event: run.event,
        branch: run.branch,
      });
      navigate(`/run/${newRun.id}`);
    } catch (err) {
      alert('Failed to re-run: ' + err.message);
    } finally {
      setRerunning(false);
    }
  };

  const toggleJob = (jobId) => {
    setExpandedJobs((prev) => ({ ...prev, [jobId]: !prev[jobId] }));
  };

  const toggleStep = (stepKey) => {
    setExpandedSteps((prev) => ({ ...prev, [stepKey]: !prev[stepKey] }));
  };

  if (loading) {
    return (
      <div className="run-detail-container">
        <div className="runs-loading">
          <div className="loading-spinner" />
          <span>Loading run details...</span>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="run-detail-container">
        <div className="runs-empty">
          <p className="runs-empty-title">Run not found</p>
        </div>
      </div>
    );
  }

  const isActive = run.status === 'in_progress' || run.status === 'queued';

  return (
    <div className="run-detail-container">
      <div className="run-detail-back">
        <button className="btn-link" onClick={() => navigate('/')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 4 }}>
            <path d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z" />
          </svg>
          Back to all runs
        </button>
      </div>

      <div className="run-detail-header">
        <div className="run-detail-header-top">
          <div className="run-detail-header-title-area">
            <StatusIcon status={run.status} size={24} />
            <h2 className="run-detail-title">
              {run.commitMessage || 'Manual run'}
            </h2>
          </div>
          <div className="run-detail-header-actions">
            {isActive && (
              <button
                className="btn btn-danger"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling...' : 'Cancel run'}
              </button>
            )}
            <button
              className="btn"
              onClick={handleRerun}
              disabled={rerunning}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 4 }}>
                <path d="M1.705 8.005a.75.75 0 01.834.656 5.5 5.5 0 009.592 2.97l-1.204-1.204a.25.25 0 01.177-.427h3.646a.25.25 0 01.25.25v3.646a.25.25 0 01-.427.177l-1.38-1.38A7.001 7.001 0 011.05 8.84a.75.75 0 01.656-.834zM8 2.5a5.487 5.487 0 00-4.131 1.869l1.204 1.204A.25.25 0 014.896 6H1.25A.25.25 0 011 5.75V2.104a.25.25 0 01.427-.177l1.38 1.38A7.002 7.002 0 0114.95 7.16a.75.75 0 11-1.49.178A5.5 5.5 0 008 2.5z" />
              </svg>
              {rerunning ? 'Re-running...' : 'Re-run'}
            </button>
          </div>
        </div>

        <div className="run-detail-meta">
          <span className={`status-badge status-badge-${run.status}`}>
            {statusLabel(run.status)}
          </span>
          <span className="run-detail-meta-item">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 4, verticalAlign: -2 }}>
              <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
            </svg>
            {run.branch || 'main'}
          </span>
          <span className="run-detail-meta-item">{run.event || 'push'}</span>
          {run.duration != null && (
            <span className="run-detail-meta-item">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 4, verticalAlign: -2 }}>
                <path d="M5.75.75A.75.75 0 016.5 0h3a.75.75 0 010 1.5h-3A.75.75 0 015.75.75zM8 3.5a5 5 0 100 10 5 5 0 000-10zm-3.5 5a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0zM8.5 5.75a.75.75 0 00-1.5 0V8.5a.75.75 0 00.37.647l1.5.859a.75.75 0 10.741-1.303L8.5 7.8V5.75z" />
              </svg>
              {formatDuration(run.duration)}
            </span>
          )}
          <span className="run-detail-meta-item">
            Started {formatRelativeTime(run.startedAt)}
          </span>
          {run.completedAt && (
            <span className="run-detail-meta-item">
              Completed {formatTimestamp(run.completedAt)}
            </span>
          )}
        </div>
      </div>

      <div className="run-detail-jobs">
        <h3 className="run-detail-section-title">Jobs</h3>
        {(!run.jobs || run.jobs.length === 0) && (
          <div className="run-detail-no-jobs">No jobs found for this run.</div>
        )}
        {run.jobs && run.jobs.map((job) => {
          const isExpanded = expandedJobs[job.id];
          return (
            <div key={job.id} className={`job-card ${isExpanded ? 'expanded' : ''}`}>
              <div className="job-card-header" onClick={() => toggleJob(job.id)}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="var(--color-fg-muted)"
                  className={`job-chevron ${isExpanded ? 'rotated' : ''}`}
                >
                  <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
                </svg>
                <StatusIcon status={job.status} size={18} />
                <span className="job-card-name">{job.name}</span>
                {job.startedAt && job.completedAt && (
                  <span className="job-card-duration">
                    {formatDuration(new Date(job.completedAt) - new Date(job.startedAt))}
                  </span>
                )}
              </div>

              {isExpanded && (
                <div className="job-card-body">
                  {job.steps && job.steps.map((step) => {
                    const stepKey = `${job.id}-${step.number}`;
                    const isStepExpanded = expandedSteps[stepKey];
                    return (
                      <div key={stepKey} className="step-row">
                        <div
                          className="step-row-header"
                          onClick={() => toggleStep(stepKey)}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 16 16"
                            fill="var(--color-fg-muted)"
                            className={`step-chevron ${isStepExpanded ? 'rotated' : ''}`}
                          >
                            <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
                          </svg>
                          <StatusIcon status={step.status} size={14} />
                          <span className="step-name">{step.name}</span>
                          <span className="step-duration">{stepDuration(step)}</span>
                        </div>
                        {isStepExpanded && step.log && (
                          <div className="step-log">
                            <LogViewer log={step.log} />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(!job.steps || job.steps.length === 0) && isActive && liveLogData && (
                    <div className="step-log">
                      <LogViewer log={liveLogData} autoScroll />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Show live logs if run is active and no job steps yet */}
        {isActive && (!run.jobs || run.jobs.length === 0) && liveLogData && (
          <div className="job-card expanded">
            <div className="job-card-header">
              <StatusIcon status="in_progress" size={18} />
              <span className="job-card-name">Live Output</span>
            </div>
            <div className="job-card-body">
              <div className="step-log">
                <LogViewer log={liveLogData} autoScroll />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

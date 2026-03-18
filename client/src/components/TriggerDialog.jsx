import React, { useState, useEffect, useMemo } from 'react';
import { fetchRepoInfo } from '../api';

const EVENT_DESCRIPTIONS = {
  push: 'Run as if you just pushed to this branch',
  pull_request: 'Run as if you opened a PR from this branch',
  workflow_dispatch: 'Manually trigger the workflow',
  release: 'Simulate a release event',
  schedule: 'Run scheduled workflow now',
  issue_comment: 'Simulate an issue comment event',
  issues: 'Simulate an issues event',
  create: 'Simulate a branch/tag creation',
  delete: 'Simulate a branch/tag deletion',
};

export default function TriggerDialog({ isOpen, onClose, workflows, selectedRepo, onTrigger }) {
  const [workflowFile, setWorkflowFile] = useState('');
  const [event, setEvent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [repoInfo, setRepoInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  // Get available events for the selected workflow
  const selectedWorkflow = useMemo(
    () => workflows.find(wf => wf.file === workflowFile),
    [workflows, workflowFile]
  );

  const availableEvents = useMemo(() => {
    if (!selectedWorkflow?.triggers?.length) return ['push'];
    return selectedWorkflow.triggers;
  }, [selectedWorkflow]);

  // When workflow changes, auto-select the first valid event
  useEffect(() => {
    if (availableEvents.length > 0 && !availableEvents.includes(event)) {
      setEvent(availableEvents[0]);
    }
  }, [availableEvents, workflowFile]);

  useEffect(() => {
    if (isOpen && selectedRepo) {
      setLoading(true);
      fetchRepoInfo(selectedRepo)
        .then(info => setRepoInfo(info))
        .catch(() => setRepoInfo(null))
        .finally(() => setLoading(false));
    }
    if (isOpen && workflows.length > 0 && !workflowFile) {
      setWorkflowFile(workflows[0].file);
    }
  }, [isOpen, selectedRepo]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!workflowFile || !selectedRepo) return;

    setSubmitting(true);
    try {
      await onTrigger({
        repoId: selectedRepo,
        workflowFile,
        event,
      });
      onClose();
      setWorkflowFile('');
      setEvent('');
      setRepoInfo(null);
    } catch (err) {
      alert('Failed to trigger run: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <div className="dialog-header">
          <h3 className="dialog-title">Run workflow</h3>
          <button className="dialog-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>

        <form className="dialog-body" onSubmit={handleSubmit}>
          {!selectedRepo && (
            <div className="dialog-warning">
              Please select a repository first.
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Workflow</label>
            <select
              className="form-select"
              value={workflowFile}
              onChange={(e) => setWorkflowFile(e.target.value)}
              disabled={!selectedRepo}
            >
              {workflows.length === 0 && <option value="">No workflows available</option>}
              {workflows.map((wf) => (
                <option key={wf.file} value={wf.file}>
                  {wf.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Branch</label>
            <div className="branch-display">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="branch-icon">
                <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
              </svg>
              {loading ? (
                <span className="branch-name loading-text">Loading...</span>
              ) : (
                <span className="branch-name">{repoInfo?.currentBranch || 'unknown'}</span>
              )}
              {repoInfo?.commitSha && (
                <span className="commit-sha">{repoInfo.commitSha}</span>
              )}
            </div>
            {repoInfo?.commitMessage && (
              <div className="branch-commit-msg">{repoInfo.commitMessage}</div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Event</label>
            <select
              className="form-select"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              disabled={!selectedRepo}
            >
              {availableEvents.map((evt) => (
                <option key={evt} value={evt}>
                  {evt}
                </option>
              ))}
            </select>
            <div className="form-hint">
              {EVENT_DESCRIPTIONS[event] || `Simulate a ${event} event on the current branch`}
            </div>
          </div>

          <div className="dialog-footer">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !selectedRepo || !workflowFile}
            >
              {submitting ? 'Running...' : 'Run workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';

export default function TriggerDialog({ isOpen, onClose, workflows, selectedRepo, onTrigger }) {
  const [workflowFile, setWorkflowFile] = useState('');
  const [branch, setBranch] = useState('main');
  const [event, setEvent] = useState('push');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && workflows.length > 0 && !workflowFile) {
      setWorkflowFile(workflows[0].file);
    }
  }, [isOpen, workflows, workflowFile]);

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
        branch,
      });
      onClose();
      setWorkflowFile('');
      setBranch('main');
      setEvent('push');
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
            <input
              type="text"
              className="form-input"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              disabled={!selectedRepo}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Event</label>
            <select
              className="form-select"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              disabled={!selectedRepo}
            >
              <option value="push">push</option>
              <option value="pull_request">pull_request</option>
              <option value="workflow_dispatch">workflow_dispatch</option>
            </select>
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

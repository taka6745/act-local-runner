import React, { useState, useRef, useEffect } from 'react';

export default function RepoSelector({ repos, selectedRepo, onSelectRepo, onAddRepo, onDeleteRepo }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [adding, setAdding] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newPath.trim()) return;
    setAdding(true);
    try {
      await onAddRepo(newPath.trim());
      setNewPath('');
      setShowAddForm(false);
    } catch (err) {
      alert('Failed to add repo: ' + err.message);
    } finally {
      setAdding(false);
    }
  };

  const selectedName = selectedRepo
    ? repos.find((r) => r.id === selectedRepo)?.name || 'Unknown'
    : 'All repositories';

  return (
    <div className="repo-selector" ref={dropdownRef}>
      <button
        className="repo-selector-btn"
        onClick={() => setIsOpen(!isOpen)}
        title={selectedName}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="repo-icon">
          <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5zm-8 11h2v2l-1-.75L5.5 14.5z" />
        </svg>
        <span className="repo-selector-name">{selectedName}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="chevron-icon">
          <path d="M6 8.825a.5.5 0 01-.354-.146l-3.5-3.5a.5.5 0 11.708-.708L6 7.618l3.146-3.147a.5.5 0 11.708.708l-3.5 3.5A.5.5 0 016 8.825z" />
        </svg>
      </button>

      {isOpen && (
        <div className="repo-dropdown">
          <div className="repo-dropdown-header">Select repository</div>
          <div
            className={`repo-dropdown-item ${!selectedRepo ? 'active' : ''}`}
            onClick={() => {
              onSelectRepo(null);
              setIsOpen(false);
            }}
          >
            All repositories
          </div>
          {repos.map((repo) => (
            <div
              key={repo.id}
              className={`repo-dropdown-item ${selectedRepo === repo.id ? 'active' : ''}`}
              onClick={() => {
                onSelectRepo(repo.id);
                setIsOpen(false);
              }}
            >
              <span className="repo-dropdown-item-name">{repo.name}</span>
              <button
                className="repo-dropdown-item-delete"
                title="Remove repository"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Remove "${repo.name}" from the list?`)) {
                    onDeleteRepo(repo.id);
                  }
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M3.404 3.404a.5.5 0 01.707 0L6 5.293l1.889-1.89a.5.5 0 01.707.708L6.707 6l1.89 1.889a.5.5 0 01-.708.707L6 6.707l-1.889 1.89a.5.5 0 01-.707-.708L5.293 6l-1.89-1.889a.5.5 0 010-.707z" />
                </svg>
              </button>
            </div>
          ))}
          <div className="repo-dropdown-divider" />
          {showAddForm ? (
            <form className="repo-add-form" onSubmit={handleAdd}>
              <input
                type="text"
                className="repo-add-input"
                placeholder="/path/to/repo"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                autoFocus
                disabled={adding}
              />
              <div className="repo-add-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !newPath.trim()}>
                  {adding ? 'Adding...' : 'Add'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewPath('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div
              className="repo-dropdown-item repo-add-btn"
              onClick={() => setShowAddForm(true)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 6 }}>
                <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 110 1.5H8.5v4.25a.75.75 0 11-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z" />
              </svg>
              Add repository
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Sidebar from './components/Sidebar';
import RunsList from './components/RunsList';
import RunDetail from './components/RunDetail';
import TriggerDialog from './components/TriggerDialog';
import { useWebSocket } from './hooks/useWebSocket';
import {
  fetchRepos,
  addRepo,
  deleteRepo,
  fetchWorkflows,
  fetchRuns,
  createRun,
} from './api';

export default function App() {
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [workflows, setWorkflows] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);

  const { lastMessage, isConnected } = useWebSocket();

  // Load repos on mount
  useEffect(() => {
    fetchRepos()
      .then(setRepos)
      .catch((err) => console.error('Failed to fetch repos:', err));
  }, []);

  // Load workflows when repo changes
  useEffect(() => {
    if (selectedRepo) {
      fetchWorkflows(selectedRepo)
        .then(setWorkflows)
        .catch((err) => {
          console.error('Failed to fetch workflows:', err);
          setWorkflows([]);
        });
    } else {
      setWorkflows([]);
    }
    setSelectedWorkflow(null);
  }, [selectedRepo]);

  // Load runs when repo or workflow filter changes
  const loadRuns = useCallback(() => {
    setLoadingRuns(true);
    const filters = {};
    if (selectedRepo) filters.repoId = selectedRepo;
    if (selectedWorkflow) filters.workflow = selectedWorkflow;
    fetchRuns(filters)
      .then(setRuns)
      .catch((err) => {
        console.error('Failed to fetch runs:', err);
        setRuns([]);
      })
      .finally(() => setLoadingRuns(false));
  }, [selectedRepo, selectedWorkflow]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;
    const { type, run } = lastMessage;

    if (type === 'run:started' && run) {
      setRuns((prev) => {
        if (prev.some((r) => r.id === run.id)) {
          return prev.map((r) => (r.id === run.id ? { ...r, ...run } : r));
        }
        return [run, ...prev];
      });
    } else if (type === 'run:updated' && run) {
      setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, ...run } : r)));
    } else if (type === 'run:completed' && run) {
      setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, ...run } : r)));
    }
  }, [lastMessage]);

  const handleAddRepo = async (path) => {
    const repo = await addRepo(path);
    setRepos((prev) => [...prev, repo]);
    setSelectedRepo(repo.id);
  };

  const handleDeleteRepo = async (id) => {
    await deleteRepo(id);
    setRepos((prev) => prev.filter((r) => r.id !== id));
    if (selectedRepo === id) {
      setSelectedRepo(null);
    }
  };

  const handleTrigger = async (data) => {
    const newRun = await createRun(data);
    setRuns((prev) => [newRun, ...prev]);
  };

  const sidebar = (
    <Sidebar
      repos={repos}
      selectedRepo={selectedRepo}
      onSelectRepo={setSelectedRepo}
      onAddRepo={handleAddRepo}
      onDeleteRepo={handleDeleteRepo}
      workflows={workflows}
      selectedWorkflow={selectedWorkflow}
      onSelectWorkflow={setSelectedWorkflow}
      runs={runs}
    />
  );

  return (
    <>
      <Layout sidebar={sidebar}>
        <Routes>
          <Route
            path="/"
            element={
              <RunsList
                runs={runs}
                loading={loadingRuns}
                onOpenTrigger={() => setTriggerOpen(true)}
                selectedWorkflow={selectedWorkflow}
              />
            }
          />
          <Route
            path="/run/:id"
            element={<RunDetail lastMessage={lastMessage} />}
          />
        </Routes>
      </Layout>

      <TriggerDialog
        isOpen={triggerOpen}
        onClose={() => setTriggerOpen(false)}
        workflows={workflows}
        selectedRepo={selectedRepo}
        onTrigger={handleTrigger}
      />

      {/* Connection indicator */}
      <div className={`ws-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
        <span className="ws-indicator-dot" />
        {isConnected ? 'Connected' : 'Reconnecting...'}
      </div>
    </>
  );
}

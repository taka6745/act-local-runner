const API_BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

// Repos
export function fetchRepos() {
  return request('/repos');
}

export function addRepo(path) {
  return request('/repos', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function deleteRepo(id) {
  return request(`/repos/${id}`, { method: 'DELETE' });
}

// Workflows
export function fetchWorkflows(repoId) {
  return request(`/repos/${repoId}/workflows`);
}

// Runs
export function fetchRuns(filters = {}) {
  const params = new URLSearchParams();
  if (filters.repoId) params.set('repoId', filters.repoId);
  if (filters.workflow) params.set('workflow', filters.workflow);
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  return request(`/runs${qs ? `?${qs}` : ''}`);
}

export function createRun(data) {
  return request('/runs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function fetchRun(id) {
  return request(`/runs/${id}`);
}

export function cancelRun(id) {
  return request(`/runs/${id}`, { method: 'DELETE' });
}

export function fetchRunLogs(id) {
  return request(`/runs/${id}/logs`);
}

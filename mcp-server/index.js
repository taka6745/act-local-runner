const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const BASE_URL =
  process.env.ACT_RUNNER_URL || "http://localhost:455";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const contentType = res.headers.get("content-type") || "";

    if (!res.ok) {
      let detail;
      if (contentType.includes("application/json")) {
        const body = await res.json();
        detail = body.error || body.message || JSON.stringify(body);
      } else {
        detail = await res.text();
      }
      throw new Error(`API ${res.status}: ${detail}`);
    }

    if (contentType.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  } catch (err) {
    if (err.cause && err.cause.code === "ECONNREFUSED") {
      throw new Error(
        `Cannot reach Act Local Runner at ${BASE_URL}. Is the server running?`
      );
    }
    throw err;
  }
}

function text(str) {
  return { content: [{ type: "text", text: str }] };
}

function statusEmoji(status) {
  switch (status) {
    case "completed":
      return "✅";
    case "in_progress":
      return "🔄";
    case "queued":
      return "⏳";
    case "failed":
      return "❌";
    case "cancelled":
      return "🚫";
    default:
      return "❔";
  }
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "act-local-runner",
  version: "1.0.0",
});

// ---- list_repos ---------------------------------------------------------

server.tool(
  "list_repos",
  "List all configured repositories",
  {},
  async () => {
    try {
      const repos = await api("/api/repos");
      if (!repos.length) {
        return text("No repositories configured yet. Use add_repo to add one.");
      }
      const lines = repos.map(
        (r) => `• ${r.name || r.path} (id: ${r.id})\n  Path: ${r.path}`
      );
      return text(`Repositories (${repos.length}):\n\n${lines.join("\n\n")}`);
    } catch (err) {
      return text(`Error listing repos: ${err.message}`);
    }
  }
);

// ---- add_repo -----------------------------------------------------------

server.tool(
  "add_repo",
  "Add a repository to monitor",
  {
    path: z.string().describe("Absolute path to the git repository"),
  },
  async ({ path }) => {
    try {
      const repo = await api("/api/repos", {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      return text(
        `Repository added successfully:\n  Name: ${repo.name || repo.path}\n  ID:   ${repo.id}\n  Path: ${repo.path}`
      );
    } catch (err) {
      return text(`Error adding repo: ${err.message}`);
    }
  }
);

// ---- remove_repo --------------------------------------------------------

server.tool(
  "remove_repo",
  "Remove a repository",
  {
    repoId: z.string().describe("Repository ID to remove"),
  },
  async ({ repoId }) => {
    try {
      await api(`/api/repos/${encodeURIComponent(repoId)}`, {
        method: "DELETE",
      });
      return text(`Repository ${repoId} removed successfully.`);
    } catch (err) {
      return text(`Error removing repo: ${err.message}`);
    }
  }
);

// ---- list_workflows -----------------------------------------------------

server.tool(
  "list_workflows",
  "List workflows for a repository",
  {
    repoId: z.string().describe("Repository ID"),
  },
  async ({ repoId }) => {
    try {
      const workflows = await api(
        `/api/repos/${encodeURIComponent(repoId)}/workflows`
      );
      if (!workflows.length) {
        return text("No workflows found for this repository.");
      }
      const lines = workflows.map((w) => {
        const triggers = w.triggers
          ? ` [triggers: ${w.triggers.join(", ")}]`
          : "";
        return `• ${w.name || w.file}${triggers}\n  File: ${w.file}`;
      });
      return text(
        `Workflows (${workflows.length}):\n\n${lines.join("\n\n")}`
      );
    } catch (err) {
      return text(`Error listing workflows: ${err.message}`);
    }
  }
);

// ---- trigger_run --------------------------------------------------------

server.tool(
  "trigger_run",
  "Start a workflow run",
  {
    repoId: z.string().describe("Repository ID"),
    workflowFile: z.string().describe("Workflow filename (e.g. ci.yml)"),
    event: z
      .string()
      .optional()
      .describe('Event type to simulate (default: "push")'),
    branch: z.string().optional().describe("Branch to run against"),
  },
  async ({ repoId, workflowFile, event, branch }) => {
    try {
      const body = {
        repoId,
        workflowFile,
        event: event || "push",
      };
      if (branch) body.branch = branch;

      const run = await api("/api/runs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return text(
        `${statusEmoji(run.status)} Workflow run started:\n` +
          `  Run ID:   ${run.id}\n` +
          `  Workflow: ${run.workflowFile || workflowFile}\n` +
          `  Event:    ${run.event || body.event}\n` +
          `  Branch:   ${run.branch || branch || "(default)"}\n` +
          `  Status:   ${run.status}`
      );
    } catch (err) {
      return text(`Error triggering run: ${err.message}`);
    }
  }
);

// ---- list_runs ----------------------------------------------------------

server.tool(
  "list_runs",
  "List workflow runs",
  {
    repoId: z.string().optional().describe("Filter by repository ID"),
    workflow: z.string().optional().describe("Filter by workflow filename"),
    status: z
      .enum(["queued", "in_progress", "completed", "failed", "cancelled"])
      .optional()
      .describe("Filter by status"),
    limit: z
      .number()
      .optional()
      .describe("Max number of runs to return (default: 20)"),
  },
  async ({ repoId, workflow, status, limit }) => {
    try {
      const params = new URLSearchParams();
      if (repoId) params.set("repoId", repoId);
      if (workflow) params.set("workflow", workflow);
      if (status) params.set("status", status);
      if (limit) params.set("limit", String(limit));

      const qs = params.toString();
      const runs = await api(`/api/runs${qs ? `?${qs}` : ""}`);

      if (!runs.length) {
        return text("No runs found matching the given filters.");
      }

      const lines = runs.map((r) => {
        const branch = r.branch ? ` on ${r.branch}` : "";
        const duration = r.duration ? ` (${r.duration})` : "";
        return (
          `${statusEmoji(r.status)} ${r.workflowFile || r.workflow || "workflow"}${branch}${duration}\n` +
          `   ID: ${r.id}  Status: ${r.status}`
        );
      });

      return text(`Runs (${runs.length}):\n\n${lines.join("\n\n")}`);
    } catch (err) {
      return text(`Error listing runs: ${err.message}`);
    }
  }
);

// ---- get_run ------------------------------------------------------------

server.tool(
  "get_run",
  "Get details of a specific run including jobs and steps",
  {
    runId: z.string().describe("Run ID"),
  },
  async ({ runId }) => {
    try {
      const run = await api(`/api/runs/${encodeURIComponent(runId)}`);

      let output =
        `${statusEmoji(run.status)} Run ${run.id}\n` +
        `  Workflow: ${run.workflowFile || run.workflow || "unknown"}\n` +
        `  Event:    ${run.event || "unknown"}\n` +
        `  Branch:   ${run.branch || "unknown"}\n` +
        `  Status:   ${run.status}\n`;

      if (run.startedAt) output += `  Started:  ${run.startedAt}\n`;
      if (run.completedAt) output += `  Finished: ${run.completedAt}\n`;
      if (run.duration) output += `  Duration: ${run.duration}\n`;

      if (run.jobs && run.jobs.length) {
        output += `\nJobs:\n`;
        for (const job of run.jobs) {
          output += `\n  ${statusEmoji(job.status)} ${job.name || job.id} (${job.status})\n`;
          if (job.steps && job.steps.length) {
            for (const step of job.steps) {
              const stepStatus = step.status || step.conclusion || "unknown";
              output += `    ${statusEmoji(stepStatus)} Step: ${step.name || step.id} — ${stepStatus}\n`;
            }
          }
        }
      }

      if (run.logs) {
        output += `\nLogs (last 50 lines):\n${run.logs.split("\n").slice(-50).join("\n")}`;
      }

      return text(output);
    } catch (err) {
      return text(`Error getting run: ${err.message}`);
    }
  }
);

// ---- get_run_logs -------------------------------------------------------

server.tool(
  "get_run_logs",
  "Get full logs for a run",
  {
    runId: z.string().describe("Run ID"),
  },
  async ({ runId }) => {
    try {
      const logs = await api(`/api/runs/${encodeURIComponent(runId)}/logs`);
      if (!logs || (typeof logs === "string" && !logs.trim())) {
        return text("No logs available for this run yet.");
      }
      return text(typeof logs === "string" ? logs : JSON.stringify(logs, null, 2));
    } catch (err) {
      return text(`Error getting logs: ${err.message}`);
    }
  }
);

// ---- cancel_run ---------------------------------------------------------

server.tool(
  "cancel_run",
  "Cancel an in-progress run",
  {
    runId: z.string().describe("Run ID to cancel"),
  },
  async ({ runId }) => {
    try {
      await api(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
      });
      return text(`🚫 Run ${runId} has been cancelled.`);
    } catch (err) {
      return text(`Error cancelling run: ${err.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const runner = require('./services/runner');

const app = express();
const PORT = process.env.PORT || 455;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from client build
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// Mount API routes
const reposRouter = require('./routes/repos');
const workflowsRouter = require('./routes/workflows');
const runsRouter = require('./routes/runs');

app.use('/api/repos', reposRouter);
app.use('/api/repos', workflowsRouter);
app.use('/api/runs', runsRouter);

// SPA catch-all: serve index.html for any non-API, non-static route
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    clients.delete(ws);
  });
});

// Broadcast function to send messages to all connected clients
function broadcast(message) {
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  }
}

// Set the broadcast function on the runner service
runner.setBroadcast(broadcast);

// Start server
server.listen(PORT, () => {
  console.log(`Act Local Runner server listening on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});

module.exports = { app, server, broadcast };

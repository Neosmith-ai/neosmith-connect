// scripts/contract/_mock_server.js
//
// Standalone mock router for models tests. The test spawns this process
// so the server and CLI each have their own event loop.
//
// Usage: node _mock_server.js <port> <status> <json-body>
//   port:  0 means pick an ephemeral port
//   status: HTTP status code
//   body: JSON string for the response body

"use strict";

const http = require("http");

const port = parseInt(process.argv[2], 10);
const status = parseInt(process.argv[3], 10);
const body = process.argv[4] || "{}";

const server = http.createServer((req, res) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
});

server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  console.log(`http://127.0.0.1:${addr.port}`);
});

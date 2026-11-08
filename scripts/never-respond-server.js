#!/usr/bin/env node
// Dev tool for Spec 002 acceptance checks (T21). Not deployed (.funcignore).
//
//   node scripts/never-respond-server.js [port] [--headers]
//
// Default: accepts TCP connections and never sends a byte  → exercises "request hangs".
// --headers: sends 200 + headers, then never sends the body → exercises "body read hangs" (R22).
const http = require('http');
const net = require('net');

const port = Number(process.argv[2] ?? 9999);
const headersMode = process.argv.includes('--headers');

const server = headersMode
  ? http.createServer((req, res) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.url} → headers sent, body withheld`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"current":'); // partial body, then silence
    })
  : net.createServer((socket) => {
      console.log(`${new Date().toISOString()} connection accepted → never responding`);
      socket.on('error', () => {});
    });

server.listen(port, '127.0.0.1', () =>
  console.log(`never-respond server (${headersMode ? 'headers' : 'silent'} mode) on http://127.0.0.1:${port}`),
);

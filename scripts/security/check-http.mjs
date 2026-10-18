import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { writeFileSync } from 'node:fs';

// Read-only probes. Never sends credentials or records response bodies/cookies.
const origins = process.argv.slice(2).filter((arg) => !arg.startsWith('--output='));
if (!origins.length) throw new Error('Supply one or more owner-authorized HTTP(S) origins');
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
const selectedHeaders = ['location', 'content-type', 'cache-control', 'content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'access-control-allow-origin', 'cross-origin-opener-policy'];
function request(url) {
  return new Promise((resolve) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { headers: { 'user-agent': 'Chakusa-owner-security-check/1.0' } }, (response) => {
      let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; if (bytes > 2_000_000) response.destroy(); });
      const finish = () => resolve({ url: url.href, status: response.statusCode, bytes, headers: Object.fromEntries(selectedHeaders.filter((name) => response.headers[name] !== undefined).map((name) => [name, response.headers[name]])) });
      response.on('end', finish);
      response.on('close', finish);
    });
    req.setTimeout(20_000, () => req.destroy(new Error('Request timed out')));
    req.on('error', (error) => resolve({ url: url.href, error: error.message }));
  });
}
function handshake(hostname, version) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, minVersion: version, maxVersion: version }, () => {
      resolve({ hostname, requested: version, negotiated: socket.getProtocol(), authorized: socket.authorized, cipher: socket.getCipher().standardName });
      socket.end();
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error('TLS handshake timed out')));
    socket.on('error', (error) => resolve({ hostname, requested: version, error: error.message }));
  });
}
const results = [];
for (const origin of origins) {
  const url = new URL(origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an origin without credentials, paths, queries, or fragments');
  const responses = [];
  for (const path of ['/', '/.env', '/.git/config', '/login', '/health']) responses.push(await request(new URL(path, url)));
  const protocols = url.protocol === 'https:' ? await Promise.all(['TLSv1.2', 'TLSv1.3'].map((version) => handshake(url.hostname, version))) : [];
  const redirect = url.protocol === 'https:' ? await request(new URL(`http://${url.host}/`)) : undefined;
  results.push({ origin: url.origin, responses, protocols, redirect });
}
const report = JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Read-only HTTP headers, selected paths, redirect, TLS 1.2/1.3. No exhaustive cipher or vulnerability scan.', results }, null, 2);
if (output) writeFileSync(output, report + '\n');
else console.log(report);

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const items = [];
function add(name, method, path, expected, { body, token, headers = {}, tests = [] } = {}) {
  const header = Object.entries({ ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer {{${token}}}` } : {}), ...headers }).map(([key, value]) => ({ key, value }));
  const checks = [
    `pm.test('HTTP ${expected}',()=>pm.response.to.have.status(${expected}));`,
    `pm.test('MIME sniffing disabled',()=>pm.expect(pm.response.headers.get('x-content-type-options')).to.equal('nosniff'));`,
    `pm.test('Response not cached',()=>pm.expect(pm.response.headers.get('cache-control')).to.include('no-store'));`,
    ...tests,
  ];
  items.push({ name, request: { method, header, url: `{{baseUrl}}${path}`, ...(body !== undefined ? { body: { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body) } } : {}) }, event: [{ listen: 'test', script: { type: 'text/javascript', exec: checks } }] });
}
add('Business A identity', 'GET', '/auth/me', 200, { token: 'aToken', tests: ["pm.test('Identity is A',()=>pm.expect(pm.response.json().user.id).to.equal(pm.environment.get('aId')));"] });
add('Create A private customer', 'POST', '/customers/', 201, { token: 'aToken', body: { name: 'Original security customer', notes: 'Synthetic only' }, tests: ["pm.environment.set('customerId',pm.response.json().id);"] });
add('Cross-tenant customer read denied', 'GET', '/customers/{{customerId}}', 404, { token: 'bToken' });
add('Cross-tenant customer write denied', 'PATCH', '/customers/{{customerId}}', 404, { token: 'bToken', body: { name: 'Attacker mutation' } });
add('Victim independently unchanged', 'GET', '/customers/{{customerId}}', 200, { token: 'aToken', tests: ["pm.test('Victim unchanged',()=>pm.expect(pm.response.json().customer.name).to.equal('Original security customer'));"] });
add('Tenant header cannot change ownership', 'GET', '/customers/{{customerId}}', 404, { token: 'bToken', headers: { 'X-Business-Id': '{{aBusinessId}}' } });
add('SQL-like identifier does not bypass ownership', 'GET', '/customers/00000000-0000-0000-0000-000000000000%27%20OR%201%3D1--', 404, { token: 'bToken' });
add('Privileged registration fields cannot grant admin', 'POST', '/admin/auth/login', 401, { headers: { Origin: 'http://localhost:5173' }, body: { email: '{{aEmail}}', password: '{{aPassword}}', role: 'SUPER_ADMIN', admin: true } });
for (const path of ['/auth/me', '/business/', '/customers/', '/leads/', '/quotes/', '/invoices/', '/financial/summary', '/accounting/connections', '/message-templates/', '/review-requests/', '/feedback/', '/reminders/', '/appointments/', '/services/', '/availability/', '/dispatch/', '/commissions/', '/inventory/', '/loyalty/', '/dashboard/summary', '/messages/', '/automation/', '/ai/prompts/', '/ai/policies/', '/ai/memory/', '/ai/ops/', '/ai/agent/', '/ai/receptionist/', '/payments/', '/weekly-reports/', '/support-tickets/', '/subscription/', '/team/']) {
  // Only enumerate known protected paths here; a 404 is a collection defect,
  // never accepted as evidence of an authentication guard.
  if (['/financial/summary','/accounting/connections','/availability/','/dispatch/','/commissions/','/inventory/','/loyalty/','/automation/','/ai/prompts/','/ai/policies/','/ai/memory/','/ai/ops/','/ai/agent/','/ai/receptionist/','/payments/','/subscription/'].includes(path)) continue;
  add(`Anonymous denied ${path}`, 'GET', path, 401);
  add(`Forged JWT denied ${path}`, 'GET', path, 401, { headers: { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.' } });
}
for (const path of ['/admin/auth/me','/admin/dashboard','/admin/businesses','/admin/users','/admin/audit','/admin/settings','/admin/provider-secrets']) add(`Product token denied ${path}`, 'GET', path, 401, { token: 'aToken', headers: { Origin: 'http://localhost:5173' } });
for (const role of ['full','restricted']) add(`${role} admin login`, 'POST', '/admin/auth/login', 200, { headers: { Origin: 'http://localhost:5173' }, body: { email: `{{${role}Email}}`, password: `{{${role}Password}}` }, tests: [`pm.environment.set('${role}AdminToken',pm.response.json().accessToken); pm.environment.set('${role}Csrf',pm.response.json().csrfToken);`] });
add('Full admin positive control', 'GET', '/admin/users', 200, { token: 'fullAdminToken', headers: { Origin: 'http://localhost:5173' } });
add('Restricted admin cannot read provider secrets', 'GET', '/admin/provider-secrets', 403, { token: 'restrictedAdminToken', headers: { Origin: 'http://localhost:5173' } });
add('MFA-required admin fails closed without challenge', 'POST', '/admin/auth/login', 403, { headers: { Origin: 'http://localhost:5173' }, body: { email: '{{mfaEmail}}', password: '{{mfaPassword}}' } });
add('Hostile admin origin denied', 'GET', '/admin/auth/me', 403, { token: 'fullAdminToken', headers: { Origin: 'https://security.invalid' } });
add('Admin refresh without CSRF denied', 'POST', '/admin/auth/refresh', 400, { headers: { Origin: 'http://localhost:5173' }, body: {} });
add('Hostile CORS origin not reflected', 'OPTIONS', '/auth/login', 204, { headers: { Origin: 'https://security.invalid', 'Access-Control-Request-Method': 'POST' }, tests: ["pm.test('Hostile origin absent',()=>pm.expect(pm.response.headers.get('access-control-allow-origin')).to.not.equal('https://security.invalid'));"] });
add('Allowed CORS origin reflected exactly', 'OPTIONS', '/auth/login', 204, { headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' }, tests: ["pm.test('Exact origin',()=>pm.expect(pm.response.headers.get('access-control-allow-origin')).to.equal('http://localhost:5173'));"] });
add('Malformed JSON', 'POST', '/auth/login', 400, { body: '{invalid' });
add('Prototype poisoning', 'POST', '/auth/login', 400, { body: '{"__proto__":{"admin":true}}' });
add('Constructor poisoning', 'POST', '/auth/login', 400, { body: '{"constructor":{"prototype":{"admin":true}}}' });
add('Generic nonexistent-user login', 'POST', '/auth/login', 401, { body: { email: 'missing@security.example.test', password: 'invalid-password' }, tests: ["pm.environment.set('genericLoginError',JSON.stringify(pm.response.json()));"] });
add('Generic existing-user login', 'POST', '/auth/login', 401, { body: { email: '{{aEmail}}', password: 'invalid-password' }, tests: ["pm.test('No account enumeration in message',()=>pm.expect(JSON.stringify(pm.response.json())).to.equal(pm.environment.get('genericLoginError')));"] });
add('Valid refresh rotates session', 'POST', '/auth/refresh', 200, { body: { refreshToken: '{{bRefresh}}' }, tests: ["pm.environment.set('bNewRefresh',pm.response.json().refreshToken); pm.environment.set('bNewToken',pm.response.json().accessToken);"] });
add('Session logout', 'POST', '/auth/logout', 204, { token: 'bNewToken', body: { refreshToken: '{{bNewRefresh}}' } });
add('Logged-out access token rejected', 'GET', '/auth/me', 401, { token: 'bNewToken' });
add('Logged-out refresh rejected', 'POST', '/auth/refresh', 401, { body: { refreshToken: '{{bNewRefresh}}' } });
const collection = {
  info: { name: 'Chakusa isolated security checks', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ["if(pm.variables.get('baseUrl')!=='http://127.0.0.1:4400') throw new Error('Security collection is restricted to the isolated loopback test server');"] } }],
  item: items,
};
// Canonical list routes: /messages/ and /team/ do not exist.
for (const item of collection.item) {
  item.request.url = item.request.url.replace('/messages/', '/messages/conversations').replace('/team/', '/team/members');
  item.name = item.name.replace('/messages/', '/messages/conversations').replace('/team/', '/team/members');
}
const destination = resolve(process.argv[2] ?? 'scripts/security/chakusa.postman_collection.json');
writeFileSync(destination, JSON.stringify(collection, null, 2) + '\n');
console.log(`Generated ${items.length} requests: ${destination}`);

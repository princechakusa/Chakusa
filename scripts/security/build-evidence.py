"""Build a redacted, offline security evidence viewer. Never serve raw reports.

python scripts/security/build-evidence.py --evidence-dir <private> --output-dir <viewer>
python -m http.server 8765 --bind 127.0.0.1 --directory <viewer>
"""
import argparse
import hashlib
import html
import json
import re
from pathlib import Path
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('--evidence-dir', required=True, type=Path)
p.add_argument('--output-dir', required=True, type=Path)
a = p.parse_args()
root = Path(__file__).resolve().parents[2]
a.output_dir.mkdir(parents=True, exist_ok=True)

def read(name):
    b = (a.evidence_dir / name).read_bytes()
    return json.loads(b.decode('utf-16' if b.startswith(b'\xff\xfe') else 'utf-8-sig'))

def esc(value):
    return html.escape(str(value), quote=True)

records = []
sources = []
def source(name):
    path = a.evidence_dir / name
    if path.exists():
        sources.append({'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})

def vitest(name, area, label):
    d = read(name)
    records.append((area, label, f"{d['numPassedTests']} passed / {d['numFailedTests']} failed / {d['numPendingTests']} pending", 'pass' if d['success'] else 'open'))
    source(name)
    return [{'suite': Path(t['name']).name, 'test': x['fullName'], 'status': x['status']} for t in d['testResults'] for x in t['assertionResults']]

details = {}
details['Mobile tests'] = vitest('mobile-tests-privacy.json', 'Mobile', 'Mobile unit suite · privacy build')
details['Backend privacy'] = vitest('backend-privacy-final.json', 'API', 'Focused privacy / Access JWT / logging')
details['Admin Access identity'] = vitest('admin-access-final.json', 'Admin', 'Access identity regression suite')
finals = [a.evidence_dir / f'backend-final18-shard-{i}.json' for i in (1, 2, 3)]
if (a.evidence_dir / 'backend-final18-verified.json').exists():
    details['Full backend tests'] = vitest('backend-final18-verified.json', 'API', 'Complete backend follow-up · with recorded full-file rerun')
    verified = read('backend-final18-verified.json')['verification']
    records.append(('API', 'Backend coverage / rerun audit', f"{verified['files']} files · exact coverage: {verified['exactFileCoverage']} · original failures: {verified['initialFailures']} · complete file reruns: {len(verified['fullFileReruns'])}", 'pass'))
elif all(x.exists() for x in finals):
    all_tests, names, ok = [], [], True
    for path in finals:
        d = read(path.name)
        ok = ok and d['success']
        names += [Path(t['name']).resolve() for t in d['testResults']]
        all_tests += [{'suite': Path(t['name']).name, 'test': x['fullName'], 'status': x['status']} for t in d['testResults'] for x in t['assertionResults']]
        source(path.name)
    expected = set((root / 'tests').rglob('*.test.ts'))
    exact = len(names) == len(set(names)) and set(names) == expected
    passed = sum(x['status'] == 'passed' for x in all_tests)
    records.append(('API', 'Complete backend follow-up', f'{passed} passed · {len(names)} files · exact file coverage: {exact}', 'pass' if ok and exact else 'open'))
    details['Full backend tests'] = all_tests
else:
    d = read('backend-complete-summary.json')
    records.append(('API', 'Previous full backend · 17 October', f"{d['passed']} passed / {d['files']} files; current full rerun in progress", 'pending'))
    source('backend-complete-summary.json')

browser = read('browser-final-18.json')
b = browser['stats']
def browser_tests(suites):
    result = []
    for suite in suites:
        result += browser_tests(suite.get('suites', []))
        for spec in suite.get('specs', []):
            for test in spec.get('tests', []):
                result.append({'suite': Path(spec.get('file', '')).name, 'test': spec['title'], 'status': test['status']})
    return result
details['Website browser tests'] = browser_tests(browser['suites'])
records.append(('Website', 'Playwright browser suite', f"{b['expected']} passed / {b['unexpected']} failed / {b['skipped']} skipped / {b['flaky']} flaky", 'pass' if not (b['unexpected'] or b['skipped'] or b['flaky']) else 'open'))
source('browser-final-18.json')
post = read('postman-cli-final.json')['run']
stats = post['stats']
records.append(('API', 'Postman CLI 1.75.0 · loopback fixtures', f"{stats['requests']['total']} requests / {stats['assertions']['total']} assertions / {len(post['failures'])} failures", 'pass' if not post['failures'] else 'open'))
source('postman-cli-final.json')
if (a.evidence_dir / 'httpscanner-baseline.json').exists():
    h = read('httpscanner-final.json' if (a.evidence_dir / 'httpscanner-final.json').exists() else 'httpscanner-baseline.json')
    records.append(('HTTP', 'HTTPScanner.com · actual public scan', f"{h['score']}/100 · target {h['target']}/100 · report: {h['reportUrl']}", 'pass' if h['score'] >= h['target'] else 'open'))
    source('httpscanner-final.json' if (a.evidence_dir / 'httpscanner-final.json').exists() else 'httpscanner-baseline.json')
details['Postman assertions'] = [{'suite': e.get('item', {}).get('name', ''), 'test': x['assertion'], 'status': 'failed' if x.get('error') else 'passed'} for e in post['executions'] for x in e.get('assertions', [])]
for area in ['backend', 'admin', 'website', 'mobile']:
    name = f'audit-18-{area}.json'
    d = read(name)['metadata']['vulnerabilities']
    records.append((area.title(), 'npm audit · locked dependency inventory', f"{d['critical']} critical / {d['high']} high / {d['moderate']} moderate / {d['low']} low", 'open' if d['total'] else 'pass'))
    source(name)

for area, label, result, status in [
    ('Admin', 'Session / MFA boundary', 'Stale session guards verified; MFA-required accounts fail closed. Native MFA enrollment remains open.', 'open'),
    ('Mobile', 'Upstream advisories', '19 high inventory findings remain; two affected packages locally patched; 5 attack/compatibility tests pass.', 'open'),
    ('Mobile', 'Android 7–9 compatibility', 'Owner accepted continued support (min SDK 24). Scanner old-OS finding retained.', 'open'),
    ('Mobile', 'Physical Android 15 · signed release', 'Installed, cold launch OK, welcome screen visible; run-as denied (not debuggable). No app WebView debug socket observed at welcome screen.', 'pass'),
    ('Mobile', 'Remaining device coverage', 'Authenticated maps, JNI/native integrations, provider login, push, call screening, older Android and iOS remain unverified.', 'pending'),
    ('Website', 'Motion text injection regression', 'Baseline reproduced text-to-HTML conversion; fixed using text nodes. Full browser suite passes.', 'pass'),
    ('HTTP', 'Deployed HTTP/TLS · 17 October', 'TLS 1.2/1.3 and redirects verified. Deployed website lacks HSTS/CSP/frame headers; candidate headers fixed locally.', 'open'),
    ('Burp', 'Burp Community proxy evidence', '67 requests / 206 assertions in original proxy run; 5 failures recorded, followed by fixes and passing direct runs. No final passing Burp rerun.', 'open'),
    ('Burp', 'Burp Professional / Repeater', 'No completed Professional active scan or desktop Repeater evidence.', 'pending'),
    ('Release', 'Deployment status', 'Local candidate changes only; no production deployment, store delivery or production migration performed.', 'pending'),
]:
    records.append((area, label, result, status))

artifact = root / 'mobile/android/app/build/outputs/apk/release/app-release.apk'
apk_hash = hashlib.sha256(artifact.read_bytes()).hexdigest()
mobsf = read('mobsf-candidate.json')
appsec = mobsf['appsec']
scan_matches = mobsf['sha256'].lower() == apk_hash
records.append(('Mobile', 'MobSF · ' + ('current release' if scan_matches else 'intermediate optimized APK'), f"{appsec['security_score']}/100 · target 90/100 · {len(appsec['high'])} high / {len(appsec['warning'])} warnings · matches current APK: {scan_matches}", 'open' if scan_matches else 'pending'))
source('mobsf-candidate.json')
source('android-device-smoke.json')
mobsf_rows = ''.join('<tr><td>' + esc(severity.upper()) + '</td><td>' + esc(re.sub('<[^>]+>', '', finding.get('title', 'Untitled'))) + '</td></tr>' for severity in ['high', 'warning', 'info', 'secure', 'hotspot'] for finding in appsec[severity])
report_links = []
for name in ['2026-10-17-security-validation.md', '2026-10-18-security-followup.md']:
    content = (root / 'docs/progress' / name).read_text(encoding='utf-8-sig')
    target = name.replace('.md', '.html')
    (a.output_dir / target).write_text('<!doctype html><meta charset="utf-8"><title>Security report</title><style>body{max-width:1000px;margin:40px auto;font:16px/1.6 system-ui;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#155e75}</style><a href="/">← Evidence viewer</a><pre>' + esc(content) + '</pre>', encoding='utf-8')
    report_links.append(f'<a href="{target}">{esc(name)}</a>')

screen = a.evidence_dir / 'android-release-screen.png'
if screen.exists():
    # This image was visually reviewed: welcome screen only, no account data.
    (a.output_dir / 'android-release-screen.png').write_bytes(screen.read_bytes())

rows = ''.join(f'<tr data-area="{esc(area)}" data-status="{status}"><td>{esc(area)}</td><td><strong>{esc(label)}</strong><p>{esc(result)}</p></td><td><span class="badge {status}">{status.upper()}</span></td></tr>' for area, label, result, status in records)
test_html = ''.join('<details><summary>' + esc(label) + f' · {len(tests)} recorded tests</summary><ul>' + ''.join(f'<li><b>{esc(t["status"])}</b> {esc(t["suite"])} · {esc(t["test"])}</li>' for t in tests) + '</ul></details>' for label, tests in details.items())
manifest = {'generatedAtUtc': datetime.now(timezone.utc).isoformat(), 'apkSha256': apk_hash, 'records': [{'area': x[0], 'check': x[1], 'result': x[2], 'status': x[3]} for x in records], 'sourceDigests': sources}
(a.output_dir / 'evidence-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chakusa · Security evidence</title>
<style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#172133;font:15px/1.55 system-ui}main{max-width:1180px;margin:auto;padding:42px 24px}header{background:#142b3e;color:white;border-radius:20px;padding:34px}h1{font-size:36px;line-height:1.1;margin:12px 0}h2{margin-top:36px}header p{max-width:850px;color:#d4e5ef}.eyebrow{font-size:12px;letter-spacing:2px;text-transform:uppercase}.notice{padding:18px 22px;border-left:4px solid #b66b12;background:#fff4dd;margin:24px 0;border-radius:8px}a{color:#175b85}nav{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}.filters{display:flex;gap:12px;align-items:center;margin:16px 0;flex-wrap:wrap}input,select{padding:11px;border:1px solid #bcc8d4;border-radius:7px;font:inherit}input{min-width:260px}table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden}th,td{text-align:left;padding:17px;border-bottom:1px solid #e2e7ed;vertical-align:top}th{background:#e6edf3}td:first-child{width:110px}td p{margin:5px 0;color:#4b5d70}.badge{display:inline-block;font-size:11px;font-weight:750;letter-spacing:.6px;border-radius:20px;padding:5px 10px}.pass{background:#ddf4e7;color:#16613f}.open{background:#ffe4dd;color:#8a311c}.pending{background:#fff0c9;color:#79580f}code{overflow-wrap:anywhere;font-size:13px}details{background:white;padding:16px;border:1px solid #d9e1ea;border-radius:8px;margin:10px 0}summary{cursor:pointer;font-weight:650}li{padding:6px 0;overflow-wrap:anywhere}img{width:250px;max-width:100%;border:1px solid #ccd4de;border-radius:16px}footer{margin-top:32px;color:#516274}tr[hidden]{display:none}@media(max-width:650px){main{padding:16px}header{padding:22px}h1{font-size:28px}td,th{padding:10px}td:first-child{width:auto}input{min-width:180px}}</style>
<main><header><div class="eyebrow">Chakusa · local verification evidence</div><h1>Security fixes. Visible evidence.</h1><p>Actual tool results across the API, administrator console, website and Android app. Passing checks, open findings and untested work are shown separately. This viewer contains redacted summaries; raw scanner data and credentials stay private.</p></header>
<div class="notice"><strong>Release gate remains open.</strong> Mobile dependency inventory still reports 19 high findings. MobSF has remaining findings, device coverage is partial, and candidate fixes have not been deployed. There is no verified claim of “zero medium or high issues”.</div>
<nav><a href="#checks">Checks & findings</a><a href="#tests">Individual test evidence</a><a href="#artifact">Android artifact & phone</a><a href="#reports">Detailed reports</a><a href="evidence-manifest.json">Redacted JSON + source hashes</a></nav>
<h2 id="checks">Checks & findings</h2><div class="filters"><label>Filter <input id="search" type="search" placeholder="e.g. Admin, Postman, MobSF"></label><label>Status <select id="status"><option value="all">All statuses</option><option value="pass">Passed checks</option><option value="open">Open findings</option><option value="pending">Pending coverage</option></select></label><span id="count" aria-live="polite"></span></div><table><thead><tr><th>Area</th><th>Evidence & scope</th><th>Status</th></tr></thead><tbody>ROWS</tbody></table>
<h2 id="tests">Individual test evidence</h2><p>Test names and statuses are copied from the real JSON reports. Overlapping focused and full suites are not added together. Failed setup attempts and interrupted runs are excluded from passing totals and retained in the private audit trail.</p>TESTS
<h2 id="artifact">Android artifact & connected phone</h2><p><strong>Signed release APK SHA-256</strong><br><code>HASH</code></p><p>Minimum Android SDK 24 · target 36 · backup disabled · cleartext traffic disabled · overlay permission removed · release code/resource shrinking enabled. APK signature verified. Screenshot: actual Android 15 phone after installing this release.</p><a href="android-release-screen.png"><img src="android-release-screen.png" alt="Connected Android phone showing the Chakusa release welcome screen"></a>
<h2 id="reports">Detailed reports</h2><nav>REPORTS</nav><footer>Generated at UTC: DATE. Evidence is local to this computer. Refresh after a new evidence build.</footer></main>
<script>const rows=[...document.querySelectorAll('tbody tr')];function filter(){const q=document.querySelector('#search').value.toLowerCase();const s=document.querySelector('#status').value;let n=0;for(const row of rows){row.hidden=!(row.textContent.toLowerCase().includes(q)&&(s==='all'||row.dataset.status===s));if(!row.hidden)n++}document.querySelector('#count').textContent=n+' of '+rows.length+' checks'}document.querySelector('#search').addEventListener('input',filter);document.querySelector('#status').addEventListener('change',filter);filter()</script></html>'''
page = page.replace('ROWS', rows).replace('TESTS', test_html).replace('HASH', apk_hash).replace('REPORTS', ' '.join(report_links)).replace('DATE', esc(manifest['generatedAtUtc']))
page = page.replace('<h2 id="tests">', '<h2>MobSF recorded findings</h2><p>Scanner titles and severities are retained, including accepted compatibility risk and vendor patterns still under review. The CBC high pattern was traced to an encryption-only AndroidX biometric capability probe; static review found no application padding oracle on that path. Raw scanner labels remain visible.</p><table><thead><tr><th>Severity</th><th>Scanner finding</th></tr></thead><tbody>' + mobsf_rows + '</tbody></table><h2 id="tests">')
page = page.replace('<tbody>' + rows, '<tbody id="check-results">' + rows)
page = page.replace("document.querySelectorAll('tbody tr')", "document.querySelectorAll('#check-results tr')")
(a.output_dir / 'index.html').write_text(page, encoding='utf-8')
print(f'Built redacted viewer: {a.output_dir}; {len(records)} checks; {len(sources)} source digests')

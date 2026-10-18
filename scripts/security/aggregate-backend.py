"""Validate complete backend file coverage and retain explicit full-file reruns."""
import argparse
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--report', action='append', required=True, type=Path)
p.add_argument('--rerun', action='append', default=[], type=Path)
p.add_argument('--output', required=True, type=Path)
a = p.parse_args()
root = Path(__file__).resolve().parents[2]
results = {}
initial_failed = 0
for path in a.report:
    report = json.loads(path.read_text(encoding='utf-8-sig'))
    for result in report['testResults']:
        key = Path(result['name']).resolve()
        if key in results:
            raise SystemExit(f'Duplicate original file: {key.name}')
        results[key] = result
        initial_failed += sum(x['status'] == 'failed' for x in result['assertionResults'])
reruns = []
for path in a.rerun:
    report = json.loads(path.read_text(encoding='utf-8-sig'))
    if not report['success']:
        raise SystemExit(f'Rerun did not pass: {path.name}')
    for result in report['testResults']:
        key = Path(result['name']).resolve()
        if key not in results:
            raise SystemExit(f'Rerun contains an unknown original file: {key.name}')
        original_names = {x['fullName'] for x in results[key]['assertionResults']}
        if original_names != {x['fullName'] for x in result['assertionResults']}:
            raise SystemExit(f'Rerun does not cover the same test cases: {key.name}')
        results[key] = result
        reruns.append({'file': key.name, 'report': path.name})
expected = set((root / 'tests').rglob('*.test.ts'))
if set(results) != expected:
    raise SystemExit('Reports do not cover every backend test file exactly once')
assertions = [x for result in results.values() for x in result['assertionResults']]
passed = sum(x['status'] == 'passed' for x in assertions)
failed = sum(x['status'] == 'failed' for x in assertions)
pending = len(assertions) - passed - failed
success = all(x['status'] == 'passed' for x in results.values()) and not (failed or pending)
out = {'numTotalTests': len(assertions), 'numPassedTests': passed, 'numFailedTests': failed, 'numPendingTests': pending,
       'success': success, 'testResults': list(results.values()),
       'verification': {'files': len(results), 'exactFileCoverage': True, 'initialFailures': initial_failed,
                        'originalReports': [x.name for x in a.report], 'fullFileReruns': reruns}}
a.output.write_text(json.dumps(out, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in out.items() if k != 'testResults'}, indent=2))
if not success:
    raise SystemExit(1)

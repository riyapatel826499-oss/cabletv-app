#!/usr/bin/env python3
"""Quick smoke test — verifies server starts and all endpoints respond correctly."""
import subprocess, sys, json, time, urllib.request, urllib.error

BASE = 'http://127.0.0.1:8000'

def api(method, path, data=None, token=None):
    url = BASE + path
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as ex:
        return 0, str(ex)

def run():
    urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))
    
    passed = 0
    failed = 0
    results = []

    # 1. Health
    code, _ = api('GET', '/api/health')
    ok = code == 200
    results.append(('Health /api/health', ok, code))
    passed += ok; failed += not ok

    # 2. Login
    code, data = api('POST', '/api/login', {"username":"admin","password":"admin123","force":True})
    if code == 200 and isinstance(data, dict) and 'access_token' in data:
        token = data['access_token']
        results.append(('Login', True, code))
        passed += 1
    else:
        results.append(('Login', False, f'{code}'))
        failed += 1
        print(f"\n❌ Login failed — cannot continue. Code: {code}")
        for name, ok, code in results:
            print(f"  {'✅' if ok else '❌'} {name}: {code}")
        sys.exit(1)

    # 3. Auth endpoints
    endpoints = [
        '/api/me',
        '/api/dashboard/stats',
        '/api/customers?per_page=3&page=1',
        '/api/customers/unpaid?page=1&per_page=2',
        '/api/customers/not-renewed?page=1&per_page=2',
        '/api/payments/all?page=1&per_page=2',
        '/api/reports/collector-performance?from_date=2026-04-01&to_date=2026-04-30',
        '/api/reports/mso-summary?from_date=2026-04-01&to_date=2026-04-30',
        '/api/employees',
        '/api/plans',
        '/api/stb-inventory?page=1&per_page=3',
    ]
    for path in endpoints:
        code, data = api('GET', path, token=token)
        ok = code == 200
        results.append((path.split('?')[0], ok, code))
        passed += ok; failed += not ok

    # 4. Auth bypass check
    code, _ = api('GET', '/api/customers/unpaid?page=1&per_page=2')
    ok = code in (401, 403)
    results.append(('Auth bypass blocked /unpaid', ok, code))
    passed += ok; failed += not ok

    code, _ = api('GET', '/api/customers/not-renewed?page=1&per_page=2')
    ok = code in (401, 403)
    results.append(('Auth bypass blocked /not-renewed', ok, code))
    passed += ok; failed += not ok

    # 5. STB column check
    code, data = api('GET', '/api/customers/unpaid?page=1&per_page=1', token=token)
    if code == 200 and data.get('customers'):
        has_stb = 'stb_no' in data['customers'][0]
        results.append(('Unpaid has stb_no', has_stb, 'yes' if has_stb else 'MISSING'))
        passed += has_stb; failed += not has_stb

    code, data = api('GET', '/api/customers/not-renewed?page=1&per_page=1', token=token)
    if code == 200 and data.get('customers'):
        has_stb = 'stb_no' in data['customers'][0]
        results.append(('NotRenewed has stb_no', has_stb, 'yes' if has_stb else 'MISSING'))
        passed += has_stb; failed += not has_stb

    # 6. Stats sanity
    code, data = api('GET', '/api/dashboard/stats', token=token)
    if code == 200:
        has_keys = all(k in data for k in ['total_customers','total_collected','collection_efficiency'])
        results.append(('Stats has required keys', has_keys, list(data.keys())[:5]))
        passed += has_keys; failed += not has_keys

    # 7. Logout
    code, _ = api('POST', '/api/logout', token=token)
    results.append(('Logout', code == 200, code))
    passed += (code == 200); failed += (code != 200)

    # Print results
    print(f"\n{'TEST':<45} {'STATUS':>8} {'DETAIL':>10}")
    print("=" * 65)
    for name, ok, detail in results:
        print(f"{'✅' if ok else '❌'} {name:<43} {'PASS' if ok else 'FAIL':>8} {detail}")
    print("=" * 65)
    print(f"\n{passed}/{passed+failed} tests passed")
    
    if failed > 0:
        sys.exit(1)

if __name__ == '__main__':
    run()

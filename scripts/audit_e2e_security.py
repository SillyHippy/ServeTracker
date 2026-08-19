import urllib.request
import urllib.parse
import urllib.error
import json
import sys

BASE_URL = "http://127.0.0.1:3153"

def make_request(path, method="GET", data=None, cookies=None, headers=None):
    url = f"{BASE_URL}{path}"
    h = {"Content-Type": "application/json"}
    if cookies:
        h["Cookie"] = cookies
    if headers:
        h.update(headers)
    
    encoded_data = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=encoded_data, headers=h, method=method)
    
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            cookie_headers = resp.headers.get_all("Set-Cookie") or []
            cookie_str = "; ".join([c.split(";")[0] for c in cookie_headers])
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = body
            return resp.status, parsed, cookie_str
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        cookie_headers = e.headers.get_all("Set-Cookie") or [] if hasattr(e, "headers") else []
        cookie_str = "; ".join([c.split(";")[0] for c in cookie_headers])
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = body
        return e.code, parsed, cookie_str
    except Exception as e:
        return 0, str(e), ""

def run_tests():
    print("=== STARTING SERVETRACKER STAGING SECURITY & E2E AUDIT (PORT 3153) ===")
    
    # 1. Health check
    status, res, _ = make_request("/api/health")
    print(f"[1] Health Check: HTTP {status} -> {res}")
    assert status == 200, f"Health check failed with {status}"
    
    # 2. Unauthenticated endpoint checks
    print("\n--- [2] Unauthenticated Access Tests ---")
    protected_endpoints = [
        ("/api/clients", "GET"),
        ("/api/cases", "GET"),
        ("/api/serves", "GET"),
        ("/api/users", "GET"),
        ("/api/admin/audit-logs", "GET"),
        ("/api/export", "GET")
    ]
    for path, method in protected_endpoints:
        st, r, _ = make_request(path, method=method)
        print(f"  {method} {path} (Anon) -> HTTP {st} (Expected: 401/403)")
        if st not in (401, 403):
            print(f"  [!] SECURITY WARNING: Unauthenticated access permitted on {path}!")

    # 3. Authenticate Admin
    print("\n--- [3] Admin Authentication ---")
    st, r, admin_cookies = make_request("/api/auth/login", method="POST", data={"password": "Password"})
    print(f"  Admin Login (password only) -> HTTP {st}, user: {r.get('user', {}).get('username') if isinstance(r, dict) else r}")
    
    # 4. Authenticate Field Server (test)
    print("\n--- [4] Field Server Authentication ---")
    st, r, server_cookies = make_request("/api/auth/login", method="POST", data={"username": "test", "password": "Password"})
    print(f"  Server Login (test:Password) -> HTTP {st}, user: {r.get('user', {}).get('username') if isinstance(r, dict) else r}")
    
    # 5. Field Server RBAC & Leakage Checks
    print("\n--- [5] Field Server RBAC & Client Leakage Tests ---")
    
    # 5.1 Field server accessing clients table
    st, clients_res, _ = make_request("/api/clients", method="GET", cookies=server_cookies)
    print(f"  GET /api/clients as Server -> HTTP {st}")
    if isinstance(clients_res, list) and len(clients_res) == 0:
        print("  [PASS] Server receives empty clients array.")
    else:
        print(f"  [LEAK] Server received clients: {clients_res}")
    
    # 5.2 Field server accessing all cases vs assigned cases
    st, cases_res, _ = make_request("/api/cases", method="GET", cookies=server_cookies)
    print(f"  GET /api/cases as Server -> HTTP {st}")
    if isinstance(cases_res, list):
        print(f"  Server cases count returned: {len(cases_res)}")
        leaked_clients = [c for c in cases_res if c.get("client_name") or c.get("client_phone") or (c.get("client_id") and c.get("client_id") != "")]
        if leaked_clients:
            print(f"  [CRITICAL LEAK] Server case list leaks client details on {len(leaked_clients)} cases!")
        else:
            print("  [PASS] All client identifying fields cleanly stripped from case rows.")

    # 5.3 Field server accessing all serve attempts
    st, serves_res, _ = make_request("/api/serves", method="GET", cookies=server_cookies)
    print(f"  GET /api/serves as Server -> HTTP {st}")
    if isinstance(serves_res, list):
        print(f"  Server serves count returned: {len(serves_res)}")
        leaked_serves = [s for s in serves_res if s.get("clientName") or s.get("client_name") or s.get("clientPhone")]
        if leaked_serves:
            print(f"  [CRITICAL LEAK] Server serves list leaks client info on {len(leaked_serves)} serves!")
        else:
            print("  [PASS] All client details stripped from serve attempt rows.")

    # 6. Admin Case Creation, Assignment & Field Sheet Hydration Test
    print("\n--- [6] Case Creation & Field Sheet Hydration Test ---")
    st, all_clients, _ = make_request("/api/clients", method="GET", cookies=admin_cookies)
    if isinstance(all_clients, list) and len(all_clients) > 0:
        client_id = all_clients[0]["id"]
        test_case_payload = {
            "client_id": client_id,
            "case_number": "AUDIT-2026-E2E",
            "case_name": "SARAH CONNOR",
            "court_name": "DISTRICT COURT OF TULSA COUNTY",
            "plaintiff_petitioner": "CYBERDYNE SYSTEMS",
            "defendant_respondent": "SARAH CONNOR",
            "home_address": "789 Resistance Way, Tulsa, OK 74103",
            "work_address": "100 Industrial Pkwy, Tulsa, OK 74104",
            "documents_to_serve": "Summons; Petition; Temporary Injunction",
            "service_requirements": "Personal service only; Gated property; 3 attempts required",
            "contact_info": "Phone: 918-555-9999 / Alt: 918-555-8888",
            "notes": "Gate code #9999, guard on duty",
            "status": "active"
        }
        st, created_case, _ = make_request("/api/cases", method="POST", data=test_case_payload, cookies=admin_cookies)
        print(f"  Create Case as Admin -> HTTP {st}, ID: {created_case.get('id') if isinstance(created_case, dict) else created_case}")
        case_id = created_case.get("id") if isinstance(created_case, dict) else None
        
        if case_id:
            # Check affidavit data endpoint as Admin
            st, aff_data, _ = make_request(f"/api/affidavit/{case_id}", method="GET", cookies=admin_cookies)
            print(f"  GET /api/affidavit/{case_id} as Admin -> HTTP {st}")
            if isinstance(aff_data, dict) and "case" in aff_data:
                c = aff_data["case"]
                print(f"    - documents_to_serve: '{c.get('documents_to_serve')}'")
                print(f"    - service_requirements: '{c.get('service_requirements')}'")
                print(f"    - contact_info: '{c.get('contact_info')}'")
                if c.get("documents_to_serve") == test_case_payload["documents_to_serve"]:
                    print("  [PASS] Case fields correctly stored and retrieved by Admin.")
                else:
                    print("  [FAIL] Documents to serve mismatch or empty!")

            # Now assign case to server 'test'
            st, users_res, _ = make_request("/api/users", method="GET", cookies=admin_cookies)
            test_user = next((u for u in users_res if u.get("username") == "test"), None) if isinstance(users_res, list) else None
            if test_user:
                print(f"\n  Assigning case {case_id} to server 'test' ({test_user['id']})...")
                st, assign_res, _ = make_request(f"/api/admin/cases/{case_id}/assign", method="POST", data={"serverId": test_user["id"]}, cookies=admin_cookies)
                print(f"  Assign Case -> HTTP {st}")
                
                # Check how server sees this assigned case
                st, server_case_res, _ = make_request(f"/api/cases/{case_id}", method="GET", cookies=server_cookies)
                print(f"  GET /api/cases/{case_id} as Server -> HTTP {st}")
                if isinstance(server_case_res, dict):
                    print(f"    Server view client_id: '{server_case_res.get('client_id')}' (Expected: blank)")
                    print(f"    Server view documents_to_serve: '{server_case_res.get('documents_to_serve')}'")
                    print(f"    Server view service_requirements: '{server_case_res.get('service_requirements')}'")
                    print(f"    Server view contact_info: '{server_case_res.get('contact_info')}'")
                    if server_case_res.get("client_id") == "" and server_case_res.get("documents_to_serve"):
                        print("  [PASS] Field server sees assigned case with all documents/requirements and ZERO client info.")
                    else:
                        print("  [FAIL] Client leakage or missing fields in server case view!")

    print("\n=== AUDIT RUN FINISHED ===")

if __name__ == "__main__":
    run_tests()

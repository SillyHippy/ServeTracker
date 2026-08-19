#!/usr/bin/env python3
"""
ServeTracker staging E2E — full field-server operations flow.

Target: throwaway staging instance on :3163 (copied data dir). Covers:
  - server intake (profiles, forced password change)
  - signature enrollment (server self)
  - admin workload + assignment (+ assignment history)
  - affidavit prepare / admin_on_behalf sign / server_self sign / render
  - notary line stays blank (no auto-notarization)
  - material edit invalidation
  - password reset revokes sessions
  - deactivation blocks immediately
  - RBAC (other server cannot sign, cannot see admin endpoints)

Usage: python3 scripts/e2e-server-operations.py [BASE_URL]
"""
import json
import sys
import time
import urllib.error
import urllib.request
import http.cookiejar

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3163"
ADMIN_PASS = "Password"  # staging admin password (matches scripts/e2e-field-server.py)
TS = str(int(time.time()))
A_USER = f"ops_a_{TS}"
B_USER = f"ops_b_{TS}"
A_PASS_TMP = "OpsTempA1!"
A_PASS = "OpsNewA1!"
A_PASS_AFTER_RESET = "OpsNewA2!"
B_PASS_TMP = "OpsTempB1!"
B_PASS = "OpsNewB1!"

# 1x1 black pixel PNG (valid signature bytes)
TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

fails = []


def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def req(op, method, path, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    request = urllib.request.Request(f"{BASE}{path}", data=body, headers=headers, method=method)
    try:
        with op.open(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw) if raw.startswith("{" ) or raw.startswith("[") else raw
            return response.status, parsed
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw
        return e.code, parsed


def check(name, cond, detail=""):
    if cond:
        print(f"PASS  {name}")
        return True
    print(f"FAIL  {name}  {detail}")
    fails.append(name)
    return False


def leak_fields(obj):
    leaks = []
    if not isinstance(obj, dict):
        return ["not-an-object"]
    for key in ("client_id", "clientId", "client_name", "clientName", "client_email", "clientEmail"):
        val = obj.get(key)
        if val not in (None, "", []):
            leaks.append(f"{key}={val}")
    return leaks


admin = opener()
server_a = opener()
server_b = opener()

print(f"=== ServeTracker server-operations E2E against {BASE} ===")

# 1. Health + admin
status, health = req(admin, "GET", "/api/health")
check("health", status == 200 and health.get("ok") is True, f"{status} {health}")

status, login = req(admin, "POST", "/api/auth/login", {"password": ADMIN_PASS})
check("admin login", status == 200 and login.get("success") and login.get("user", {}).get("role") == "admin", f"{status} {login}")

# 2. Client + case fixtures
status, cl = req(admin, "POST", "/api/clients", {"name": f"Ops E2E Client {TS}"})
check("create client", status == 201 and cl.get("id"), f"{status} {cl}")
client_id = cl.get("id")

case1_num = f"OPS-1-{TS}"
status, c1 = req(admin, "POST", "/api/cases", {
    "client_id": client_id,
    "case_number": case1_num,
    "case_name": "Ops Target One",
    "defendant_respondent": "Ops Target One",
    "home_address": "100 Ops Lane, Tulsa, OK",
    "documents_to_serve": "Summons; Petition",
})
check("create case 1", status == 201 and c1.get("id"), f"{status} {c1}")
case1_id = c1.get("id")

case2_num = f"OPS-2-{TS}"
status, c2 = req(admin, "POST", "/api/cases", {
    "client_id": client_id,
    "case_number": case2_num,
    "case_name": "Ops Target Two",
    "defendant_respondent": "Ops Target Two",
    "home_address": "200 Ops Lane, Tulsa, OK",
    "documents_to_serve": "Summons",
})
check("create case 2", status == 201 and c2.get("id"), f"{status} {c2}")
case2_id = c2.get("id")

# 3. Server A intake
status, ua = req(admin, "POST", "/api/users", {
    "username": A_USER,
    "password": A_PASS_TMP,
    "displayName": "Ops Server A",
    "legalName": "Ops Server A Legal",
    "email": "opsa@example.com",
    "phone": "555-0101",
    "licenseNumber": "PSL-OPS-A",
    "licenseJurisdiction": "OK",
    "licenseExpiresAt": "2035-12-31",
    "serviceTerritory": ["Tulsa", "Wagoner"],
    "profileNotes": "E2E intake note",
})
check("create server A", status == 201 and ua.get("user", {}).get("id"), f"{status} {ua}")
a_id = ua.get("user", {}).get("id")
a_legal = "Ops Server A Legal"
check("A role forced server", ua.get("user", {}).get("role") == "server", str(ua.get("user", {}).get("role")))
check("A starts pending + must change password", ua.get("user", {}).get("onboardingStatus") == "pending" and ua.get("user", {}).get("mustChangePassword") is True, str(ua.get("user")))

status, ua2 = req(admin, "PUT", f"/api/users/{a_id}", {"onboardingStatus": "active"})
check("activate A onboarding", status == 200 and ua2.get("user", {}).get("onboardingStatus") == "active", f"{status} {ua2}")

# 4. Server A first login forces password change
status, al = req(server_a, "POST", "/api/auth/login", {"username": A_USER, "password": A_PASS_TMP})
check("A first login", status == 200 and al.get("user", {}).get("mustChangePassword") is True, f"{status} {al}")

status, blocked = req(server_a, "GET", "/api/cases")
check("A blocked from dashboard before password change", status == 403 and blocked.get("code") == "PASSWORD_CHANGE_REQUIRED", f"{status} {blocked}")

status, ch = req(server_a, "POST", "/api/me/change-password", {"currentPassword": A_PASS_TMP, "newPassword": A_PASS})
check("A changes password", status == 200 and ch.get("success"), f"{status} {ch}")

status, al2 = req(server_a, "POST", "/api/auth/login", {"username": A_USER, "password": A_PASS})
check("A relogin with new password", status == 200 and al2.get("user", {}).get("mustChangePassword") is False, f"{status} {al2}")

# 5. Signature enrollment (server self)
status, sig = req(server_a, "POST", "/api/me/signature", {
    "password": A_PASS,
    "image_data": f"data:image/png;base64,{TINY_PNG}",
    "mime_type": "image/png",
    "ack": True,
})
check("A enrolls signature", status == 201 and sig.get("assetId"), f"{status} {sig}")
a_asset = sig.get("assetId")

status, wrong = req(server_a, "POST", "/api/me/signature", {
    "password": "WRONGPASS1!",
    "image_data": f"data:image/png;base64,{TINY_PNG}",
    "mime_type": "image/png",
    "ack": True,
})
check("signature enrollment requires correct password", status == 401, f"{status} {wrong}")

# 6. Admin workload shows A
status, wl = req(admin, "GET", "/api/admin/server-workload")
check("workload endpoint", status == 200 and isinstance(wl.get("servers"), list), f"{status}")
a_row = next((s for s in wl.get("servers", []) if s.get("id") == a_id), None)
check("workload includes A", a_row is not None, str(wl.get("servers", [])[:2]))
if a_row:
    check("A onboarding active in workload", a_row.get("onboardingStatus") == "active", str(a_row))
    check("A license valid in workload", a_row.get("licenseStatus") == "valid", str(a_row.get("licenseStatus")))
    check("A signature enrolled in workload", a_row.get("signatureStatus") == "enrolled", str(a_row.get("signatureStatus")))
    check("A profile complete in workload", a_row.get("profileCompleteness", {}).get("profileComplete") is True, str(a_row.get("profileCompleteness")))

status, wl_denied = req(server_a, "GET", "/api/admin/server-workload")
check("server cannot read workload", status == 403, f"{status} {wl_denied}")

# 7. Assign case 1 to A
status, assign = req(admin, "POST", f"/api/admin/cases/{case1_id}/assign", {"serverId": a_id})
check("admin assigns case 1 to A", status == 200 and assign.get("assigned_to") == a_id, f"{status} {assign}")

status, assign_bad = req(admin, "POST", f"/api/admin/cases/{case1_id}/assign", {"serverId": "usr_nonexistent"})
check("assign validates server exists", status == 400, f"{status} {assign_bad}")

status, detail = req(admin, "GET", f"/api/admin/servers/{a_id}/cases")
cases_list = detail.get("cases") if isinstance(detail, dict) else []
check("server case detail", status == 200 and any(c.get("id") == case1_id for c in cases_list), f"{status} {detail}")
events = detail.get("assignment_history", []) if isinstance(detail, dict) else []
check("assignment history recorded", any(e.get("case_id") == case1_id and e.get("new_server_id") == a_id for e in events), str(events[:2]))

# 8. A sees assigned case, no client data
status, acases = req(server_a, "GET", "/api/cases")
check("A sees only assigned case", status == 200 and isinstance(acases, list) and len(acases) == 1 and acases[0]["id"] == case1_id, f"{status} {acases}")
if isinstance(acases, list) and acases:
    check("A case client fields stripped", leak_fields(acases[0]) == [], leak_fields(acases[0]))

# 9. A logs a completed attempt (method recorded) for case 1
status, att = req(server_a, "POST", "/api/serves", {
    "case_id": case1_id,
    "case_number": case1_num,
    "person_being_served": "Ops Target One",
    "status": "completed",
    "service_method": "personal",
    "notes": "E2E completed service.",
    "service_address": "100 Ops Lane, Tulsa, OK",
})
check("A logs completed attempt", status == 201, f"{status} {att}")

# 10. Prepare + admin_on_behalf sign
status, prep = req(admin, "POST", "/api/affidavits/prepare", {"caseId": case1_id})
check("prepare ready", status == 200 and prep.get("ready") is True, f"{status} {prep}")
check("prepare assigned server identity", prep.get("assignedServer", {}).get("legalName") == a_legal, str(prep.get("assignedServer")))
check("prepare preview title service", prep.get("preview", {}).get("title") == "AFFIDAVIT OF SERVICE", str(prep.get("preview")))
check("prepare preview method recorded", prep.get("preview", {}).get("methodRecorded") is True, str(prep.get("preview")))

status, sign = req(admin, "POST", f"/api/affidavits/{case1_id}/sign", {
    "password": ADMIN_PASS,
    "confirmation": a_legal,
})
check("admin signs on behalf of A", status == 201 and sign.get("execution", {}).get("applicationMode") == "admin_on_behalf", f"{status} {sign}")
check("execution status signed_not_notarized", sign.get("execution", {}).get("status") == "signed_not_notarized", str(sign.get("execution")))
check("execution hashes present", bool(sign.get("execution", {}).get("sourceHash")) and bool(sign.get("execution", {}).get("renderedHash")), str(sign.get("execution")))

status, sign_bad_confirm = req(admin, "POST", f"/api/affidavits/{case1_id}/sign", {
    "password": ADMIN_PASS,
    "confirmation": "WRONG NAME",
})
check("admin sign requires exact typed name", status == 400, f"{status} {sign_bad_confirm}")

# 11. Render: signature left, notary line blank
status, render = req(admin, "GET", f"/api/affidavits/{case1_id}/render")
html = render.get("html", "") if isinstance(render, dict) else ""
check("render signed html", status == 200 and "AFFIDAVIT OF SERVICE" in html, f"{status} {str(render)[:200]}")
check("render has exactly one embedded signature", html.count("data:image/png;base64,") == 1, f"count={html.count('data:image/png;base64,')}")
check("render has assigned server legal name", a_legal in html, "")
# Notary side must stay a blank sig-line (no signature bytes after STATE OF)
notary_zone = html.split("STATE OF OKLAHOMA", 1)[-1] if "STATE OF OKLAHOMA" in html else ""
check("notary line present and blank", "<div class=\"sig-line\"></div>" in notary_zone and "data:image" not in notary_zone, "notary zone contains signature bytes or no blank line")
check("render no method warning", "METHOD NOT RECORDED" not in html, "")

# 12. Material edit voids execution; render blocked
status, upd = req(admin, "PUT", f"/api/cases/{case1_id}", {"documents_to_serve": "Summons; Petition; Amended"})
check("material edit", status == 200, f"{status} {upd}")
status, audit = req(admin, "GET", f"/api/affidavits/{case1_id}/audit")
check("audit shows voided execution", audit.get("executions", [])[0].get("status") == "void" and audit.get("executions", [])[0].get("invalidationReason") == "material_change", str(audit.get("executions", [])[:1]))
status, render_void = req(admin, "GET", f"/api/affidavits/{case1_id}/render")
check("render blocked after invalidation", status == 409, f"{status} {render_void}")

# 13. Fresh sign (server_self) after invalidation creates new version
status, assign2 = req(admin, "POST", f"/api/admin/cases/{case2_id}/assign", {"serverId": a_id})
check("assign case 2 to A", status == 200, f"{status} {assign2}")
status, att2 = req(server_a, "POST", "/api/serves", {
    "case_id": case2_id,
    "case_number": case2_num,
    "person_being_served": "Ops Target Two",
    "status": "completed",
    "service_method": "personal",
    "notes": "E2E completed.",
    "service_address": "200 Ops Lane, Tulsa, OK",
})
check("A logs attempt on case 2", status == 201, f"{status} {att2}")
status, sign2 = req(server_a, "POST", f"/api/affidavits/{case2_id}/sign", {
    "password": A_PASS,
    "acknowledged": True,
})
check("A signs own case (server_self)", status == 201 and sign2.get("execution", {}).get("applicationMode") == "server_self", f"{status} {sign2}")
check("new version supersedes prior", bool(sign2.get("execution", {}).get("supersedesExecutionId")) is False, str(sign2.get("execution", {})))  # first execution for case2

status, sign3 = req(server_a, "POST", f"/api/affidavits/{case1_id}/sign", {
    "password": A_PASS,
    "acknowledged": True,
})
check("fresh sign after invalidation (new version)", status == 201 and bool(sign3.get("execution", {}).get("supersedesExecutionId")), f"{status} {sign3}")

# 14. Server B cannot sign A's case; B role isolation
status, ub = req(admin, "POST", "/api/users", {
    "username": B_USER,
    "password": B_PASS_TMP,
    "displayName": "Ops Server B",
    "legalName": "Ops Server B Legal",
    "licenseNumber": "PSL-OPS-B",
    "licenseJurisdiction": "OK",
    "licenseExpiresAt": "2035-12-31",
})
check("create server B", status == 201, f"{status} {ub}")
b_id = ub.get("user", {}).get("id")
req(admin, "PUT", f"/api/users/{b_id}", {"onboardingStatus": "active"})

status, bl = req(server_b, "POST", "/api/auth/login", {"username": B_USER, "password": B_PASS_TMP})
check("B first login", status == 200, f"{status} {bl}")
req(server_b, "POST", "/api/me/change-password", {"currentPassword": B_PASS_TMP, "newPassword": B_PASS})

status, b_sign = req(server_b, "POST", f"/api/affidavits/{case1_id}/sign", {
    "password": B_PASS,
    "acknowledged": True,
})
check("B cannot sign A's case", status == 403, f"{status} {b_sign}")

status, b_users = req(server_b, "GET", "/api/users")
check("server cannot list users", status == 403, f"{status} {b_users}")

status, b_prep = req(server_b, "POST", "/api/affidavits/prepare", {"caseId": case1_id})
check("server cannot prepare other's case", status == 403, f"{status} {b_prep}")

# 15. Password reset revokes sessions
status, reset = req(admin, "PUT", f"/api/users/{a_id}", {"password": "OpsReset1!"})
check("admin resets A password", status == 200, f"{status} {reset}")
status, a_me_after = req(server_a, "GET", "/api/auth/me")
check("A old session dead after reset", status == 401, f"{status} {a_me_after}")
status, a_relogin = req(server_a, "POST", "/api/auth/login", {"username": A_USER, "password": "OpsReset1!"})
check("A relogin with reset password, forced change", status == 200 and a_relogin.get("user", {}).get("mustChangePassword") is True, f"{status} {a_relogin}")
status, a_change = req(server_a, "POST", "/api/me/change-password", {"currentPassword": "OpsReset1!", "newPassword": A_PASS_AFTER_RESET})
check("A sets new password after reset", status == 200, f"{status} {a_change}")

# 16. Deactivation blocks immediately
status, deact = req(admin, "PUT", f"/api/users/{a_id}", {"isActive": False})
check("admin deactivates A", status == 200, f"{status} {deact}")
status, a_me_dead = req(server_a, "GET", "/api/auth/me")
check("deactivated session dead", status == 401, f"{status} {a_me_dead}")
status, a_login_dead = req(server_a, "POST", "/api/auth/login", {"username": A_USER, "password": A_PASS_AFTER_RESET})
check("deactivated login blocked", status == 401, f"{status} {a_login_dead}")
status, audit_deact = req(admin, "GET", f"/api/affidavits/{case2_id}/audit")
check("deactivation voided A's signed executions", audit_deact.get("executions", [])[0].get("status") == "void" and audit_deact.get("executions", [])[0].get("invalidationReason") == "server_deactivated", str(audit_deact.get("executions", [])[:1]))

# 17. Reactivate — login works again
status, react = req(admin, "PUT", f"/api/users/{a_id}", {"isActive": True})
check("admin reactivates A", status == 200, f"{status} {react}")
status, a_login_ok = req(server_a, "POST", "/api/auth/login", {"username": A_USER, "password": A_PASS_AFTER_RESET})
check("A login after reactivation", status == 200, f"{status} {a_login_ok}")

# 18. Admin session/self endpoints
status, my_sessions = req(admin, "GET", "/api/me/sessions")
check("admin self sessions", status == 200 and isinstance(my_sessions, list), f"{status} {my_sessions}")
status, my_profile = req(admin, "GET", "/api/me/profile")
check("admin self profile", status == 200 and my_profile.get("id") == "usr_admin_default", f"{status} {my_profile}")

print()
if fails:
    print(f"RESULT FAIL ({len(fails)}): " + ", ".join(fails))
    sys.exit(1)
print("RESULT PASS: all server-operations E2E checks succeeded")

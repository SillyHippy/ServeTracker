#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request
import http.cookiejar

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3153"
ADMIN_PASS = "Password"
SERVER_USER = "e2e_field"
SERVER_PASS = "ServerSecret123!"

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
        with op.open(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw) if raw.startswith("{") or raw.startswith("[") else raw
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
field = opener()

print(f"=== ServeTracker staging E2E against {BASE} ===")

status, health = req(admin, "GET", "/api/health")
check("health", status == 200 and health.get("ok") is True, f"{status} {health}")

status, login = req(admin, "POST", "/api/auth/login", {"password": ADMIN_PASS})
check("admin login", status == 200 and login.get("success") and login.get("user", {}).get("role") == "admin", f"{status} {login}")

status, me = req(admin, "GET", "/api/auth/me")
check("admin /me", status == 200 and me.get("authenticated") and me.get("user", {}).get("role") == "admin", f"{status} {me}")

status, users = req(admin, "GET", "/api/users")
check("admin list users", status == 200 and isinstance(users, list), f"{status} {users}")
field_user = next((u for u in users if u.get("username") == SERVER_USER), None) if isinstance(users, list) else None
if not field_user:
    status, created = req(admin, "POST", "/api/users", {
        "username": SERVER_USER,
        "password": SERVER_PASS,
        "displayName": "E2E Field Server",
        "legalName": "E2E Field Server",
        "licenseNumber": "PSL-E2E",
        "licenseJurisdiction": "OK",
        "licenseExpiresAt": "2035-12-31",
        "serviceTerritory": ["Tulsa"],
        "role": "server",
    })
    check("create field user", status in (200, 201) and created.get("success"), f"{status} {created}")
    field_id = created.get("user", {}).get("id")
else:
    field_id = field_user.get("id")
    check("reuse field user", bool(field_id), str(field_user))

# Assignment requires onboarding complete + active + licensed, so make sure
# the field account qualifies (idempotent on reruns).
if field_id:
    status, onboard = req(admin, "PUT", f"/api/users/{field_id}", {
        "onboardingStatus": "active",
        "legalName": "E2E Field Server",
        "licenseNumber": "PSL-E2E",
        "licenseJurisdiction": "OK",
        "licenseExpiresAt": "2035-12-31",
    })
    check("field user onboarded + licensed", status == 200, f"{status} {onboard}")

status, cases = req(admin, "GET", "/api/cases")
check("admin list cases", status == 200 and isinstance(cases, list) and len(cases) > 0, f"{status}")
assigned = next((c for c in cases if str(c.get("status", "")).lower() not in ("closed", "completed")), cases[0])
assigned_id = assigned["id"]
unassigned = next((c for c in cases if c["id"] != assigned_id), None)

status, updated = req(admin, "PUT", f"/api/cases/{assigned_id}", {
    "assigned_to": field_id,
    "assigned_name": "E2E Field Server",
})
check("admin assign case", status == 200 and updated.get("assigned_to") == field_id, f"{status} {updated}")

status, flogin = req(field, "POST", "/api/auth/login", {"username": SERVER_USER, "password": SERVER_PASS})
check("field login", status == 200 and flogin.get("user", {}).get("role") == "server", f"{status} {flogin}")

# A freshly created account is forced to change its password on first login.
if flogin.get("user", {}).get("mustChangePassword"):
    status, ch = req(field, "POST", "/api/me/change-password", {
        "currentPassword": SERVER_PASS,
        "newPassword": SERVER_PASS + "2",
    })
    check("field forced password change", status == 200 and ch.get("success"), f"{status} {ch}")
    SERVER_PASS = SERVER_PASS + "2"
    status, flogin = req(field, "POST", "/api/auth/login", {"username": SERVER_USER, "password": SERVER_PASS})
    check("field relogin after password change", status == 200, f"{status} {flogin}")

status, fme = req(field, "GET", "/api/auth/me")
check("field /me", status == 200 and fme.get("user", {}).get("role") == "server", f"{status} {fme}")

status, clients = req(field, "GET", "/api/clients")
check("field clients empty", status == 200 and clients == [], f"{status} {clients}")

status, create_client = req(field, "POST", "/api/clients", {"name": "Hacked Client"})
check("field cannot create client", status == 403, f"{status} {create_client}")

status, fcases = req(field, "GET", "/api/cases")
# Isolation invariant: EVERY case returned must be assigned to this field user,
# and the case the admin just assigned must be present. (The shared staging DB
# may hold other pre-existing assignments for e2e_field, so len == 1 is wrong.)
fcases_ok = (
    status == 200
    and isinstance(fcases, list)
    and len(fcases) >= 1
    and all(c.get("assigned_to") == field_id for c in fcases if isinstance(c, dict))
    and any(c.get("id") == assigned_id for c in fcases if isinstance(c, dict))
)
check("field sees only assigned case", fcases_ok, f"{status} {fcases}")
if isinstance(fcases, list) and fcases:
    check("field case client fields stripped", leak_fields(fcases[0]) == [], leak_fields(fcases[0]))

status, search = req(field, "GET", "/api/search?q=a")
check("field search hides clients", status == 200 and search.get("clients") == [], f"{status} {search}")

status, attempt = req(field, "POST", "/api/serves", {
    "case_id": assigned_id,
    "case_number": assigned.get("case_number"),
    "person_being_served": assigned.get("defendant_respondent") or assigned.get("case_name") or "Target",
    "status": "failed",
    "notes": "E2E field attempt: gate locked.",
    "service_address": assigned.get("home_address") or "123 Field Way",
    "coordinates": "36.1539,-95.9928",
    "attempt_type": "physical",
})
check("field can log assigned attempt", status == 201, f"{status} {attempt}")
attempt_id = attempt.get("id") if isinstance(attempt, dict) else None
if isinstance(attempt, dict):
    check("field POST response strips client fields", leak_fields(attempt) == [], leak_fields(attempt))
    check("field POST records logged_by", attempt.get("logged_by") == field_id or attempt.get("logged_by_name") == "E2E Field Server", str(attempt.get("logged_by_name")))

if unassigned:
    status, forbidden_attempt = req(field, "POST", "/api/serves", {
        "case_id": unassigned["id"],
        "case_number": unassigned.get("case_number"),
        "person_being_served": "Should Fail",
        "status": "failed",
        "notes": "Should be blocked",
    })
    check("field cannot log unassigned case", status == 403, f"{status} {forbidden_attempt}")

if attempt_id:
    status, edit = req(field, "PUT", f"/api/serves/{attempt_id}", {"notes": "hacked"})
    check("field cannot edit attempt", status == 403, f"{status} {edit}")
    status, delete = req(field, "DELETE", f"/api/serves/{attempt_id}")
    check("field cannot delete attempt", status == 403, f"{status} {delete}")

# Assigned server may now OPEN the affidavit endpoint (identity + notary info,
# still no client contact data); other/unassigned cases stay 403.
status, aff = req(field, "GET", f"/api/affidavit/{assigned_id}")
check("assigned server can open affidavit", status == 200 and bool(aff.get("assignedServer")), f"{status} {aff}")
if isinstance(aff, dict):
    check("field affidavit response strips client fields", leak_fields(aff) == [], leak_fields(aff))
    check("field affidavit exposes assigned server identity", aff.get("assignedServer", {}).get("legalName") == "E2E Field Server", str(aff.get("assignedServer")))
if unassigned:
    status, aff_other = req(field, "GET", f"/api/affidavit/{unassigned['id']}")
    check("field cannot open unassigned case affidavit", status == 403, f"{status} {aff_other}")
status, docs = req(field, "GET", "/api/documents")
check("field cannot list documents", status == 403, f"{status} {docs}")
status, backup = req(field, "POST", "/api/backup")
check("field cannot backup", status == 403, f"{status} {backup}")

status, fserves = req(field, "GET", f"/api/serves?case_id={assigned_id}")
check("field can list assigned serves", status == 200 and isinstance(fserves, list), f"{status}")
if isinstance(fserves, list) and fserves:
    leaked = [leak_fields(s) for s in fserves if leak_fields(s)]
    check("field serve list strips client fields", leaked == [], leaked[:2])

status, aserves = req(admin, "GET", f"/api/serves?case_id={assigned_id}")
found = next((s for s in aserves if s.get("id") == attempt_id), None) if isinstance(aserves, list) else None
check("admin sees field attempt", found is not None, str(found))
if found:
    check("admin still has client_id", bool(found.get("client_id")), str(found.get("client_id")))
    check("admin sees logged_by_name", found.get("logged_by_name") == "E2E Field Server", str(found.get("logged_by_name")))

status, aclients = req(admin, "GET", "/api/clients")
check("admin still sees clients", status == 200 and isinstance(aclients, list) and len(aclients) > 0, f"{status} count={len(aclients) if isinstance(aclients, list) else '?'}")

print()
if fails:
    print(f"RESULT FAIL ({len(fails)}): " + ", ".join(fails))
    sys.exit(1)
print("RESULT PASS: all staging E2E checks succeeded")

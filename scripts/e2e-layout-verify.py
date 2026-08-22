#!/usr/bin/env python3
"""Production E2E — layout verification on :3150 (admin + server roles)."""
import json, sys, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3150"
fails = []

def check(name, ok, detail=""):
    print(("PASS" if ok else "FAIL") + f" | {name}" + (f" | {detail}" if detail else ""))
    if not ok:
        fails.append(name)

# ---- 0. Register throwaway server (pure API, before any browser state) ----
ts = str(int(time.time()))
srv_user, srv_pass = f"ui_srv_{ts}", "UiSrvPass1!"
payload = {"username": srv_user, "password": srv_pass, "email": f"{srv_user}@test.local",
           "displayName": "UI Test Server", "legalName": "UI Test Server",
           "licenseNumber": "L-UI-1", "phone": "555-000-1111",
           "accepted_tos": True, "tos_version": "2026.1"}
try:
    r = urllib.request.urlopen(urllib.request.Request(
        f"{BASE}/api/auth/register-server", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}))
    check("register throwaway server for UI test", r.status == 201)
except Exception as e:
    check("register throwaway server for UI test", False, str(e))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ================= ADMIN FLOW =================
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.fill("input#username", "admin")
    page.fill("input#password", "Password")
    page.click('button[type="submit"]')
    page.wait_for_url("**/dashboard", timeout=15000)
    page.wait_for_timeout(1500)
    check("admin login + dashboard renders", page.url.endswith("/dashboard"), page.url)
    check("no page errors on admin dashboard", len(page_errors) == 0, "; ".join(page_errors[:3]))

    body = page.inner_text("body")
    check("dashboard shows Active Jobs", "Active Jobs" in body or "Active Cases" in body)

    status_select = page.locator('[aria-label="Case status"]')
    check("quick status dropdown present on active cases", status_select.count() > 0, f"count={status_select.count()}")
    if status_select.count() > 0:
        status_select.first.click()
        page.wait_for_timeout(600)
        opts = page.locator('[role="option"]').all_inner_texts()
        check("status dropdown has Served/Non-Service/On Hold",
              any("Served" in o for o in opts) and any("Non-Service" in o for o in opts) and any("On Hold" in o for o in opts),
              ",".join(o.strip() for o in opts[:8]))

    # Client section
    page.goto(f"{BASE}/clients", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    client_link = page.locator('a[href*="/clients/"]').first
    if client_link.count() > 0:
        href = client_link.get_attribute("href")
        if href and href != "/clients":
            client_link.click()
            page.wait_for_timeout(1800)
    body = page.inner_text("body")
    check("client case has Field Sheet button", "Field Sheet" in body)
    check("client case has Case Documents button", "Case Documents" in body)
    check("client case has Affidavit button", "Affidavit" in body)
    check("client case has Edit + Delete", "Edit" in body and "Delete" in body)
    ctx.close()

    # ================= SERVER FLOW =================
    ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
    page2 = ctx2.new_page()
    errs2 = []
    page2.on("pageerror", lambda e: errs2.append(str(e)))
    page2.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page2.fill("input#username", srv_user)
    page2.fill("input#password", srv_pass)
    page2.click('button[type="submit"]')
    try:
        page2.wait_for_url("**/dashboard", timeout=15000)
        check("server login + dashboard", True)
    except Exception:
        check("server login + dashboard", False, "did not reach /dashboard")
        ctx2.close()
        browser.close()
        sys.exit(1)
    page2.wait_for_timeout(1500)
    check("no page errors on server dashboard", len(errs2) == 0, "; ".join(errs2[:3]))
    body2 = page2.inner_text("body")
    check("server Active Jobs shows Field Sheet", "Field Sheet" in body2)
    check("server Active Jobs shows Service Docs", "Service Docs" in body2)
    check("server Active Jobs shows Affidavit", "Affidavit" in body2)
    check("server Active Jobs shows Log Attempt", "Log Attempt" in body2)
    ctx2.close()
    browser.close()

print()
if fails:
    print(f"E2E RESULT: {len(fails)} FAILURES")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("E2E RESULT: ALL CHECKS PASSED")

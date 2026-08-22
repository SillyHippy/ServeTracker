#!/usr/bin/env python3
"""Comprehensive Human-like Playwright E2E verification script."""
import json, sys, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3150"
SCREENSHOTS_DIR = "/tmp/servetracker_e2e_screenshots"
import os
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

results = []

def record(test_name, success, details=""):
    status = "PASS" if success else "FAIL"
    print(f"[{status}] {test_name}" + (f" -> {details}" if details else ""))
    results.append({"name": test_name, "success": success, "details": details})

# 1. Admin login token for setup
admin_req = urllib.request.Request(
    f"{BASE}/api/auth/login",
    data=json.dumps({"username": "admin", "password": "Password"}).encode(),
    headers={"Content-Type": "application/json"}
)
admin_res = json.loads(urllib.request.urlopen(admin_req).read().decode())
admin_token = admin_res["token"]

# Create a mock client + mock case assigned to test server
ts = str(int(time.time()))
srv_user, srv_pass = f"e2e_server_{ts}", "E2ePass123!"

# Register mock server
reg_req = urllib.request.Request(
    f"{BASE}/api/auth/register-server",
    data=json.dumps({
        "username": srv_user,
        "password": srv_pass,
        "email": f"{srv_user}@mockserver.org",
        "displayName": "Mock Field Server",
        "legalName": "Mock Field Server LLC",
        "licenseNumber": "OK-LIC-9999",
        "phone": "539-555-0199",
        "accepted_tos": True,
        "tos_version": "2026.1"
    }).encode(),
    headers={"Content-Type": "application/json"}
)
reg_res = json.loads(urllib.request.urlopen(reg_req).read().decode())
mock_server_id = reg_res["user"]["id"]

# Create mock client
client_req = urllib.request.Request(
    f"{BASE}/api/clients",
    data=json.dumps({
        "name": f"Mock Test Law Firm {ts}",
        "email": f"client_{ts}@mocklaw.org",
        "phone": "(539) 555-0100",
        "address": "100 E 2nd St, Tulsa, OK 74103",
        "notes": "Mock client for automated visual E2E verification"
    }).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {admin_token}"}
)
client_res = json.loads(urllib.request.urlopen(client_req).read().decode())
mock_client_id = client_res["id"]

# Create mock case
case_req = urllib.request.Request(
    f"{BASE}/api/cases",
    data=json.dumps({
        "client_id": mock_client_id,
        "case_number": f"CJ-2026-{ts[-4:]}",
        "case_name": "State of Oklahoma v. Mock Target Recipient",
        "court_name": "District Court of Tulsa County",
        "plaintiff_petitioner": "State of Oklahoma",
        "defendant_respondent": f"Mock Defendant {ts[-4:]}",
        "home_address": "5309 S Narcissus Ave, Broken Arrow, OK 74011",
        "work_address": "6911 S 66th East Ave, Tulsa, OK 74133",
        "documents_to_serve": "Summons, Petition for Foreclosure, Civil Cover Sheet",
        "service_requirements": "Personal service preferred. Log GPS for all attempts.",
        "contact_info": "(539) 555-7788",
        "assigned_to": mock_server_id,
        "assigned_name": "Mock Field Server",
        "status": "Active"
    }).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {admin_token}"}
)
case_res = json.loads(urllib.request.urlopen(case_req).read().decode())
mock_case_id = case_res["id"]

# Upload a mock PDF document to this case
boundary = "----WebKitFormBoundaryE2ETest"
pdf_content = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000106 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF"
body_bytes = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="description"\r\n\r\nSummons and Petition\r\n'
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="Summons_and_Petition.pdf"\r\n'
    f"Content-Type: application/pdf\r\n\r\n"
).encode() + pdf_content + f"\r\n--{boundary}--\r\n".encode()

doc_req = urllib.request.Request(
    f"{BASE}/api/cases/{mock_case_id}/documents",
    data=body_bytes,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": f"Bearer {admin_token}"}
)
doc_res = urllib.request.urlopen(doc_req)
record("Mock setup: Client, Case, Server, Court Document created", doc_res.status == 201)

# Run Playwright Tests
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # -------------------------------------------------------------
    # TEST SUITE 1: FIELD SERVER WORKFLOW & SERVICE DOCS MODAL
    # -------------------------------------------------------------
    server_ctx = browser.new_context(viewport={"width": 390, "height": 844}) # iPhone 12/13/14 viewport
    page = server_ctx.new_page()
    page_errors = []
    page.on("pageerror", lambda err: page_errors.append(str(err)))

    # 1. Login as Field Server
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.fill("input#username", srv_user)
    page.fill("input#password", srv_pass)
    page.click('button[type="submit"]')
    page.wait_for_url("**/dashboard", timeout=15000)
    page.wait_for_timeout(1500)

    record("Field Server login & dashboard navigation", page.url.endswith("/dashboard"))
    record("Field Server 0 page errors", len(page_errors) == 0, "; ".join(page_errors))

    page.screenshot(path=f"{SCREENSHOTS_DIR}/01_server_dashboard_mobile.png")

    # 2. Check Active Jobs Card Layout
    body_text = page.inner_text("body")
    record("Field Server sees assigned mock case", f"Mock Defendant {ts[-4:]}" in body_text)
    record("Field Server sees Field Sheet button", "Field Sheet" in body_text)
    record("Field Server sees Service Docs button", "Service Docs" in body_text)
    record("Field Server sees Affidavit button", "Affidavit" in body_text)
    record("Field Server sees Log Attempt button", "Log Attempt" in body_text)

    # 3. Click Service Docs button as Server
    service_docs_btn = page.locator('button', has_text="Service Docs").first
    service_docs_btn.click()
    page.wait_for_timeout(1000)

    # Check if Service Documents dialog opened!
    dialog = page.locator('[role="dialog"]')
    dialog_visible = dialog.is_visible()
    record("Field Server Service Docs modal opens", dialog_visible)

    if dialog_visible:
        dialog_text = dialog.inner_text()
        record("Modal contains 'Page 1: Case Field Sheet'", "Page 1: Case Field Sheet" in dialog_text)
        record("Modal contains 'Summons_and_Petition.pdf'", "Summons_and_Petition.pdf" in dialog_text)
        record("Modal shows 'Download / Print Selected (2)'", "Download / Print Selected (2)" in dialog_text)
        page.screenshot(path=f"{SCREENSHOTS_DIR}/02_server_service_docs_modal.png")

        # Close dialog
        close_btn = dialog.locator('button', has_text="Close").first
        if close_btn.count() > 0:
            close_btn.click()
            page.wait_for_timeout(500)

    # 4. Log a successful serve attempt via API as Server
    srv_token = page.evaluate("() => localStorage.getItem('auth_token') || ''")
    if not srv_token:
        # Fallback to direct login endpoint
        login_res = json.loads(urllib.request.urlopen(urllib.request.Request(
            f"{BASE}/api/auth/login",
            data=json.dumps({"username": srv_user, "password": srv_pass}).encode(),
            headers={"Content-Type": "application/json"}
        )).read().decode())
        srv_token = login_res.get("token", "")

    serve_payload = {
        "case_id": mock_case_id,
        "case_number": f"CJ-2026-{ts[-4:]}",
        "person_being_served": f"Mock Defendant {ts[-4:]}",
        "service_type": "serve",
        "service_method": "Personal Service",
        "status": "completed",
        "service_address": "5309 S Narcissus Ave, Broken Arrow, OK 74011",
        "notes": "Delivered in person to defendant at residence.",
        "occurred_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    srv_serve_req = urllib.request.Request(
        f"{BASE}/api/serves",
        data=json.dumps(serve_payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {srv_token}"}
    )
    srv_serve_res = urllib.request.urlopen(srv_serve_req)
    record("Logged successful serve attempt as Field Server", srv_serve_res.status in (200, 201))

    # Return to dashboard and verify Affidavit Queue
    page.goto(f"{BASE}/dashboard", wait_until="domcontentloaded")
    page.wait_for_timeout(2000)

    dash_text = page.inner_text("body")
    record("Affidavits Awaiting Signature queue shows on Server Dashboard", "Affidavits Awaiting Signature" in dash_text)
    record("Queue shows Sign Affidavit button for Server", "Sign Affidavit" in dash_text)

    page.screenshot(path=f"{SCREENSHOTS_DIR}/04_server_affidavit_queue.png")
    server_ctx.close()

    # -------------------------------------------------------------
    # TEST SUITE 2: ADMIN VIEW, CLIENT SECTION, & STATUS DROPDOWN
    # -------------------------------------------------------------
    admin_ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    admin_page = admin_ctx.new_page()
    admin_errors = []
    admin_page.on("pageerror", lambda err: admin_errors.append(str(err)))

    admin_page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    admin_page.fill("input#username", "admin")
    admin_page.fill("input#password", "Password")
    admin_page.click('button[type="submit"]')
    admin_page.wait_for_url("**/dashboard", timeout=15000)
    admin_page.wait_for_timeout(1500)

    record("Admin login & dashboard navigation", admin_page.url.endswith("/dashboard"))
    record("Admin 0 page errors", len(admin_errors) == 0, "; ".join(admin_errors))

    # Check Affidavits Awaiting Signature in Admin
    admin_dash_text = admin_page.inner_text("body")
    record("Admin Dashboard shows Affidavits Awaiting Signature queue", "Affidavits Awaiting Signature" in admin_dash_text)
    admin_page.screenshot(path=f"{SCREENSHOTS_DIR}/05_admin_dashboard_desktop.png")

    # Check Active Cases Quick Status Dropdown
    admin_page.goto(f"{BASE}/active-cases", wait_until="domcontentloaded")
    admin_page.wait_for_timeout(2000)
    status_selects = admin_page.locator('[aria-label="Case status"]')
    record("Admin Active Cases page has Quick Status dropdowns", status_selects.count() > 0, f"count={status_selects.count()}")
    admin_page.screenshot(path=f"{SCREENSHOTS_DIR}/06_admin_active_cases_management.png")

    # Check Client detail page case card buttons layout
    admin_page.goto(f"{BASE}/clients", wait_until="domcontentloaded")
    admin_page.wait_for_timeout(1500)

    # Click on the newly created mock client
    client_card = admin_page.locator('tbody tr, .cursor-pointer, [role="row"]').first
    client_card.click()
    admin_page.wait_for_timeout(1000)

    # Switch to "Cases & Documents" tab
    cases_tab = admin_page.locator('[role="tab"]', has_text="Cases & Documents").first
    if cases_tab.count() > 0:
        cases_tab.click()
        admin_page.wait_for_timeout(1500)

    client_page_text = admin_page.inner_text("body")
    record("Client detail page shows Field Sheet button", "Field Sheet" in client_page_text)
    record("Client detail page shows Case Documents button", "Case Documents" in client_page_text)
    record("Client detail page shows Edit & Delete buttons", "Edit" in client_page_text and "Delete" in client_page_text)

    # Click Case Documents on Client Case Card
    case_docs_btn = admin_page.locator('button', has_text="Case Documents").first
    if case_docs_btn.count() > 0:
        case_docs_btn.click()
        admin_page.wait_for_timeout(1000)
        admin_dialog = admin_page.locator('[role="dialog"]')
        record("Admin Case Documents dialog opens from Client Cases", admin_dialog.is_visible())
        admin_page.screenshot(path=f"{SCREENSHOTS_DIR}/07_admin_case_documents_dialog.png")

    admin_page.screenshot(path=f"{SCREENSHOTS_DIR}/08_client_cases_layout.png")
    admin_ctx.close()
    browser.close()

print("\n" + "="*50)
print("E2E AUDIT RESULTS SUMMARY:")
print("="*50)
fails = [r for r in results if not r["success"]]
for r in results:
    s = "PASS" if r["success"] else "FAIL"
    print(f"  [{s}] {r['name']}")
print("="*50)
if fails:
    print(f"TOTAL FAILED: {len(fails)}")
    sys.exit(1)
else:
    print("ALL TESTS PASSED WITH 100% SUCCESS!")
    sys.exit(0)

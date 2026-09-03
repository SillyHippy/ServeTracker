import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 390, 'height': 844},
            has_touch=True,
            is_mobile=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        )
        page = await context.new_page()
        
        # 1. Login to production
        await page.goto("http://127.0.0.1:3150/login")
        await page.wait_for_selector('input#username')
        await page.fill('input#username', 'admin')
        await page.fill('input#password', 'Password')
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/dashboard")
        await page.wait_for_timeout(800)
        
        # 2. Trigger notification
        await page.goto("http://127.0.0.1:3150/settings")
        await page.wait_for_timeout(800)
        await page.click('button:has-text("Clear Local Data")')
        await page.wait_for_timeout(400)
        await page.click('button:has-text("Clear Data")')
        await page.wait_for_timeout(500)
        
        # 3. Check toast layout and bounds
        toast_el = await page.query_selector('[data-sonner-toast]')
        assert toast_el is not None, "Toast did not appear"
        box = await toast_el.bounding_box()
        print(f"Toast Bounding Box: {box}")
        
        close_btn = await page.query_selector('[data-sonner-toaster] [data-close-button]')
        assert close_btn is not None, "Close button not found"
        close_box = await close_btn.bounding_box()
        print(f"Close Button Bounding Box: {close_box}")
        
        if close_box and box:
            assert close_box['x'] > 0 and close_box['x'] + close_box['width'] <= 390, f"Close button overflowed viewport! {close_box}"
            assert box['x'] >= 0 and box['x'] + box['width'] <= 390, f"Toast card overflowed viewport! {box}"
            
            # 4. Test Tap-To-Dismiss
            print("Testing Tap-To-Dismiss...")
            cx = box['x'] + box['width'] / 2
            cy = box['y'] + box['height'] / 2
            await page.mouse.click(cx, cy)
            await page.wait_for_timeout(800)
            
            # Check if toast was dismissed
            still_mounted = await page.evaluate("() => { const el = document.querySelector('[data-sonner-toast]'); return el ? el.getAttribute('data-mounted') === 'true' && el.getAttribute('data-removed') !== 'true' : false; }")
            print(f"Toast still mounted/active after tap: {still_mounted}")
            assert not still_mounted, "Toast was not dismissed on tap!"
            print(">>> TAP-TO-DISMISS VERIFIED SUCCESSFUL! <<<")
            
        # 5. Now test auto-dismiss on a fresh toast
        print("\nTesting Auto-Dismiss (4 seconds)...")
        await page.click('button:has-text("Clear Local Data")')
        await page.wait_for_timeout(400)
        await page.click('button:has-text("Clear Data")')
        await page.wait_for_timeout(500)
        
        # Toast should be visible initially
        active_1 = await page.evaluate("() => { const el = document.querySelector('[data-sonner-toast]'); return el ? el.getAttribute('data-mounted') === 'true' && el.getAttribute('data-removed') !== 'true' : false; }")
        print(f"Toast active at 0.5s: {active_1}")
        assert active_1, "Toast not active initially"
        
        # Wait 4.5s
        print("Waiting 4.5s for timer...")
        await page.wait_for_timeout(4600)
        active_after = await page.evaluate("() => { const el = document.querySelector('[data-sonner-toast]'); return el ? el.getAttribute('data-mounted') === 'true' && el.getAttribute('data-removed') !== 'true' : false; }")
        print(f"Toast active after 4.6s: {active_after}")
        assert not active_after, "Toast did not auto-dismiss after duration!"
        print(">>> AUTO-DISMISS VERIFIED SUCCESSFUL! <<<")
        
        await browser.close()
        print("\nALL MOBILE TESTS PASSED COMPLETELY!")

asyncio.run(run())

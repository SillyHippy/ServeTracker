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
        
        toast_el = await page.query_selector('[data-sonner-toast]')
        assert toast_el is not None, "Toast did not appear"
        box = await toast_el.bounding_box()
        print(f"Toast Bounding Box: {box}")
        
        # 3. Simulate touch swipe (swipe right by 50px)
        if box:
            cx = box['x'] + box['width'] / 2
            cy = box['y'] + box['height'] / 2
            
            # Dispatch touchstart and touchend with > 20px delta
            await page.evaluate("""([cx, cy]) => {
                const el = document.querySelector('[data-sonner-toast]');
                if (!el) return;
                const tStart = new Touch({
                    identifier: 1,
                    target: el,
                    clientX: cx,
                    clientY: cy
                });
                const tEnd = new Touch({
                    identifier: 1,
                    target: el,
                    clientX: cx + 60,
                    clientY: cy
                });
                el.dispatchEvent(new TouchEvent('touchstart', { touches: [tStart], changedTouches: [tStart], bubbles: true }));
                el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [tEnd], bubbles: true }));
            }""", [cx, cy])
            
            await page.wait_for_timeout(500)
            still_mounted = await page.evaluate("() => { const el = document.querySelector('[data-sonner-toast]'); return el ? el.getAttribute('data-mounted') === 'true' && el.getAttribute('data-removed') !== 'true' : false; }")
            print(f"Toast still mounted/active after touch swipe: {still_mounted}")
            assert not still_mounted, "Toast was not dismissed on touch swipe!"
            print(">>> TOUCH SWIPE DISMISS VERIFIED SUCCESSFUL! <<<")
            
        await browser.close()

asyncio.run(run())

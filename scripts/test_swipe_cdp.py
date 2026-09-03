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
        
        await page.goto("http://127.0.0.1:3150/login")
        await page.wait_for_selector('input#username')
        await page.fill('input#username', 'admin')
        await page.fill('input#password', 'Password')
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/dashboard")
        await page.wait_for_timeout(800)
        
        await page.goto("http://127.0.0.1:3150/settings")
        await page.wait_for_timeout(800)
        await page.click('button:has-text("Clear Local Data")')
        await page.wait_for_timeout(400)
        await page.click('button:has-text("Clear Data")')
        await page.wait_for_timeout(600)
        
        toast_el = await page.query_selector('[data-sonner-toast]')
        box = await toast_el.bounding_box()
        print(f"Toast BEFORE swipe: {box}")
        cx = box['x'] + box['width'] / 2
        cy = box['y'] + box['height'] / 2
        
        # Instrument: track pointer events + swipe state on the toast
        await page.evaluate("""(sel) => {
            window.__evts = [];
            const el = document.querySelector(sel);
            if (!el) return;
            for (const t of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend']) {
                el.addEventListener(t, (e) => {
                    window.__evts.push({t, x: e.clientX, y: e.clientY, pt: e.pointerType});
                }, {capture: true});
            }
            window.__toastEl = el;
        }""", '[data-sonner-toast]')
        
        # Vertical drag with mouse
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.wait_for_timeout(100)
        for i in range(1, 11):
            await page.mouse.move(cx, cy + i * 20, steps=3)
            await asyncio.sleep(0.06)
        await page.mouse.up()
        await page.wait_for_timeout(1500)
        
        state = await page.evaluate("""() => {
            const el = window.__toastEl;
            return {
                events: window.__evts.slice(0, 30),
                totalEvents: window.__evts.length,
                swipeAmount: el ? el.style.getPropertyValue('--swipe-amount') : null,
                removed: el ? el.getAttribute('data-removed') : null,
                swipeOut: el ? el.getAttribute('data-swipe-out') : null,
                stillInDom: !!document.querySelector('[data-sonner-toast]')
            };
        }""")
        print("INSTRUMENTATION:", state)
        
        toast_after = await page.query_selector('[data-sonner-toast]')
        print("Toast element after:", toast_after)
        await browser.close()

asyncio.run(run())

import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 390, 'height': 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        )
        page = await context.new_page()
        
        # 1. Login to production
        await page.goto("http://127.0.0.1:3150/login")
        await page.wait_for_selector('input#username')
        await page.fill('input#username', 'admin')
        await page.fill('input#password', 'Password')
        await page.click('button[type="submit"]')
        
        # 2. Wait for navigation
        await page.wait_for_url("**/dashboard")
        await page.wait_for_timeout(1000)
        
        # 3. Go to settings
        await page.goto("http://127.0.0.1:3150/settings")
        await page.wait_for_timeout(1000)
        
        # Click "Clear Local Data"
        btn = await page.query_selector('button:has-text("Clear Local Data")')
        if btn:
            await btn.click()
            await page.wait_for_timeout(500)
            
            # Click "Clear Data" inside the confirmation dialog
            confirm_btn = await page.query_selector('button:has-text("Clear Data")')
            if confirm_btn:
                await confirm_btn.click()
                await page.wait_for_timeout(500)
                
                await page.screenshot(path="/home/workspace/settings_toast_fired.png")
                print("Captured settings_toast_fired.png")
                
                toast_el = await page.query_selector('[data-sonner-toast]')
                if toast_el:
                    box = await toast_el.bounding_box()
                    if box:
                        print(f"Toast bounding box: {box}")
                        # Test swipe right
                        cx = box['x'] + box['width'] / 2
                        cy = box['y'] + box['height'] / 2
                        await page.mouse.move(cx, cy)
                        await page.mouse.down()
                        await page.mouse.move(cx + 350, cy, steps=15)
                        await page.mouse.up()
                        await page.wait_for_timeout(1000)
                        await page.screenshot(path="/home/workspace/settings_toast_swiped.png")
                        print("Captured settings_toast_swiped.png")
                        
                        # Verify if toast is gone or dismissed
                        toast_after = await page.query_selector('[data-sonner-toast]')
                        print("Toast after swipe:", toast_after)

        await browser.close()
        print("Done!")

asyncio.run(run())

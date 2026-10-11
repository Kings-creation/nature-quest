# Full outdoor loop in a real browser, offline included.  python3 -m http.server 8099 first.
import sys
from playwright.sync_api import sync_playwright
ok = True
def check(n, c):
    global ok; ok &= bool(c); print(("PASS " if c else "FAIL ") + n)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width":390,"height":844}); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8099/"); pg.click("[data-act=local]"); pg.wait_for_selector("text=Give me a quest")
    pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
    pg.click("#startQuest"); pg.wait_for_selector("#go")
    title = pg.inner_text("h1")
    pg.evaluate("window.__nq.state.awayMs = 600"); ctx.set_offline(True)
    pg.click("#go"); pg.wait_for_selector("text=Now put the phone away")
    check("leave-screen moment shown", "Your quest is ready." in pg.inner_text("h1"))
    pg.wait_for_selector(".away.rest", timeout=4000); check("screen rests after a few seconds", True)
    pg.screenshot(path="/tmp/away.png")
    pg.reload(); pg.wait_for_selector("#away"); check("reload during the quest keeps it active", True)
    pg.click("#away"); pg.wait_for_selector("#back2"); check("tap wakes to the active quest", "In progress" in pg.inner_text("main"))
    pg.click("a[href='#/home']"); pg.wait_for_selector("text=Your quest is underway"); check("home reflects the active quest", "I'm back" in pg.inner_text("#startQuest"))
    pg.click("#startQuest"); pg.click("#back2"); pg.wait_for_selector("text=Welcome back.")
    pg.reload(); pg.wait_for_selector("text=Welcome back."); check("return flow survives reload", True)
    pg.click("#resume"); pg.wait_for_selector("#away"); pg.click("#away"); pg.click("#back2"); pg.wait_for_selector("text=Welcome back.")
    check("not done yet goes back outside and returns", True)
    pg.fill("#dd", "The bark was warmer than the stone"); pg.click("#fin"); check("quick finish needs a tick", "That was quick" in pg.inner_text("#rmsg")); pg.check("#cq"); pg.dblclick("#fin"); pg.wait_for_selector("text=Quest complete.")
    check("double-tap finish completes offline", "warmer than the stone" in pg.inner_text("main"))
    check("progress counted once", pg.locator(".stat b").first.inner_text() == "1" and pg.locator(".stat b").nth(1).inner_text() == "1")
    pg.reload(); pg.wait_for_selector("text=Quest complete."); check("done screen survives reload; still 1", pg.locator(".stat b").first.inner_text() == "1")
    pg.wait_for_timeout(800); pg.screenshot(path="/tmp/done.png"); pg.click("#ok"); pg.wait_for_selector("text=Give me a quest")
    check("home shows 1 done, 1 streak, no live quest", pg.locator(".stat b").first.inner_text() == "1")
    ctx.set_offline(False)
    pg.click("#startQuest"); pg.wait_for_selector("#go"); pg.click("#go"); pg.click("#away"); pg.click("#back2"); pg.wait_for_selector("text=Welcome back.")
    pg.click("input[name=outcome][value=skipped]"); check("discovery hidden when skipping", not pg.locator("#disc").is_visible()); pg.click("#fin")
    pg.wait_for_selector("text=Give me a quest"); check("skipped quest: no progress change", pg.locator(".stat b").first.inner_text() == "1")
    check("no uncaught page errors", not errs); print(errs) if errs else None
    b.close()
sys.exit(0 if ok else 1)

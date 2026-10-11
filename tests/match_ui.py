# Smart matching, labelled quest card, mood input and "Show me another" in a real browser.
import sys
from playwright.sync_api import sync_playwright
ok = True
def check(n, c):
    global ok; ok &= bool(c); print(("PASS " if c else "FAIL ") + n)
def tune(pg, mode, **kw):
    pg.evaluate("([m, kw]) => window.__nq.tuneAI({ workerUrl: new URL('tests/fake-worker.js?mode=' + m, location.href).href, ...kw })", [mode, kw])
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def fresh():
        pg = b.new_context(viewport={"width":390,"height":844}).new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8099/"); pg.click("[data-act=local]"); pg.wait_for_selector("text=Give me a quest"); return pg
    pg = fresh(); tune(pg, "ok")
    check("home offers on-device AI with size and offline promise", "25 MB" in pg.inner_text("#mcard") and "offline" in pg.inner_text("#mcard"))
    pg.click("#startQuest"); pg.wait_for_selector("#go", timeout=6000)
    check("one tap still gives a quest without AI", "From the library" in pg.inner_text("main"))
    check("quest card has Why this / Your task / Time", all(x in pg.inner_text("main").lower() for x in ["why this", "your task", "time", "about"]))
    pg.click("#drop"); pg.wait_for_selector("#mOn"); pg.click("#mOn"); pg.wait_for_selector("#mcard", state="detached", timeout=8000)
    check("turning on on-device AI works and the card goes away", True)
    pg.click("text=Choose what I feel like"); pg.wait_for_selector("#mood")
    pg.fill("#mood", "anxious and stressed, want to calm down and breathe"); pg.click("button[type=submit]"); pg.wait_for_selector("ol.steps", timeout=8000)
    calm = pg.inner_text("h1"); check("mood-matched quest is labelled as picked by the AI model", "Picked for you by all-MiniLM-L6-v2" in pg.inner_text("main"))
    pg.click("#drop"); pg.wait_for_selector("text=Give me a quest"); pg.click("text=Choose what I feel like"); pg.wait_for_selector("#mood")
    pg.fill("#mood", "playful fun game for the kids"); pg.click("button[type=submit]"); pg.wait_for_selector("ol.steps", timeout=8000)
    play = pg.inner_text("h1"); check("different feelings give different quests", calm != play)
    seen = {play}
    for i in range(3):
        prev = pg.inner_text("h1"); pg.click("#another"); pg.wait_for_function("p => document.querySelector('h1') && document.querySelector('ol.steps') && document.querySelector('h1').textContent !== p", arg=prev, timeout=8000); t = pg.inner_text("h1"); seen.add(t)
    check("Show me another gives new quests, not repeats", len(seen) == 4)
    pg.click("#drop"); pg.wait_for_selector("text=Give me a quest")
    pg.click("a[href='#/you']"); pg.click("a[href='#/ai']"); pg.click("#mTest"); pg.wait_for_function("document.getElementById('mLog').textContent.includes('RESULT')", timeout=8000)
    check("matching self-test reports success with timings", "RESULT: good" in pg.inner_text("#mLog") and "Matched in" in pg.inner_text("#mLog"))
    pg = fresh(); tune(pg, "ok"); pg.evaluate("window.__nq.matcher.prepare()"); pg.evaluate("window.__nq.embed.unload()")
    tune(pg, "hang", loadIdleMs=800, embedIdleMs=800)
    pg.click("#startQuest"); pg.wait_for_selector("ol.steps", timeout=9000)
    check("a stuck matching model never blocks: quest appears from the rules", "From the library" in pg.inner_text("main"))
    check("no uncaught page errors", not errs); print(errs) if errs else None
    b.close()
sys.exit(0 if ok else 1)

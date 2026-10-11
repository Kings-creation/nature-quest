# The "loading forever" regression: stuck, crashing or slow AI must never trap the user.
import sys
from playwright.sync_api import sync_playwright
ok = True
def check(n, c):
    global ok; ok &= bool(c); print(("PASS " if c else "FAIL ") + n)
def setup(pg, mode, **tune):
    pg.evaluate("""([mode, tune]) => { window.__nq.tuneAI({ workerUrl: new URL('tests/fake-worker.js?mode=' + mode, location.href).href, ...tune });
      return window.__nq.ai.configure({ enabled: true, provider: 'browser', downloadedModels: {smol: true} }); }""", [mode, tune])
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def fresh():
        pg = b.new_context(viewport={"width":390,"height":844}).new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8099/"); pg.click("[data-act=local]"); pg.wait_for_selector("text=Give me a quest"); return pg
    pg = fresh(); setup(pg, "ok")
    pg.click("#startQuest"); pg.wait_for_selector("#wskip"); pg.wait_for_selector("ol.steps", timeout=8000)
    check("one tap makes a quest (no questions asked)", True)
    check("AI path works: written by the model", "Written by SmolLM2-135M-Instruct" in pg.inner_text("main") and "Moss and stone" in pg.inner_text("h1"))
    pg.click("#drop"); pg.wait_for_selector("text=Give me a quest")
    pg.click("a[href='#/home']"); pg.wait_for_function("window.__nq.pantry.count().then(c => c > 0)", timeout=8000)
    t0 = pg.evaluate("Date.now()"); pg.click("#startQuest"); pg.wait_for_selector("ol.steps", timeout=4000)
    check("quest written ahead of time is handed over instantly", pg.evaluate("Date.now()") - t0 < 2500 and "Written by SmolLM2-135M-Instruct" in pg.inner_text("main"))
    pg.click("#drop"); pg.wait_for_selector("text=Give me a quest")
    pg.click("a[href='#/you']"); pg.click("a[href='#/ai']"); pg.click("#aiTest"); pg.wait_for_function("document.getElementById('aiLog').textContent.includes('RESULT')", timeout=8000)
    check("diagnostics report success with timings", "RESULT: good" in pg.inner_text("#aiLog") and "Model ready on:" in pg.inner_text("#aiLog") and "First word" in pg.inner_text("#aiLog"))
    pg = fresh(); setup(pg, "gpu-fail")
    pg.click("#startQuest"); pg.wait_for_selector("ol.steps", timeout=8000)
    check("GPU fails to start: silently falls back to CPU and still writes with the model", "Written by SmolLM2-135M-Instruct" in pg.inner_text("main"))
    pg = fresh(); setup(pg, "hang", loadIdleMs=1500)
    pg.click("#startQuest"); pg.wait_for_selector("ol.steps", timeout=9000)
    check("model that never loads: gives up and falls back", "From the library" in pg.inner_text("main") and "took too long" in pg.inner_text("main"))
    pg = fresh(); setup(pg, "hang-gen", genIdleMs=1500)
    pg.click("#startQuest"); pg.wait_for_selector("ol.steps", timeout=9000)
    check("model that stalls mid-sentence: gives up and falls back", "From the library" in pg.inner_text("main") and "took too long" in pg.inner_text("main"))
    pg = fresh(); setup(pg, "crash")
    pg.click("#startQuest"); pg.wait_for_selector("ol.steps", timeout=9000)
    check("crashing worker: falls back with an honest note", "From the library" in pg.inner_text("main") and "built-in library" in pg.inner_text("main"))
    pg = fresh(); setup(pg, "hang", loadIdleMs=600000)
    pg.click("#startQuest"); pg.wait_for_selector("#wskip"); pg.click("#wskip"); pg.wait_for_selector("ol.steps", timeout=5000)
    check("skip button rescues a stuck load immediately", "ready-made quest" in pg.inner_text("main"))
    pg.click("#drop"); pg.wait_for_selector("text=Give me a quest"); pg.click("#startQuest"); pg.wait_for_selector("#wskip")
    check("another tap right after still works", True)
    check("no uncaught page errors", not errs); print(errs) if errs else None
    b.close()
sys.exit(0 if ok else 1)

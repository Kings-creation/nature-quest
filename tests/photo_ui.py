# Verification, photo evidence, achievements and journal in a real browser.
import sys, random
from PIL import Image
from playwright.sync_api import sync_playwright
random.seed(3)
noisy = Image.new("RGB", (160, 120)); noisy.putdata([(random.randint(20,230),random.randint(20,230),random.randint(20,230)) for _ in range(160*120)]); noisy.save("/tmp/real.png")
Image.new("RGB", (160, 120), (0, 0, 0)).save("/tmp/black.png")
ok = True
def check(n, c):
    global ok; ok &= bool(c); print(("PASS " if c else "FAIL ") + n)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={"width":390,"height":844}).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8099/"); pg.click("[data-act=local]"); pg.wait_for_selector("text=Give me a quest")
    pg.click("#startQuest"); pg.wait_for_selector("#go"); pg.click("#go"); pg.click("#away"); pg.click("#back2"); pg.wait_for_selector("text=Welcome back.")
    check("time outside is shown", "out for about" in pg.inner_text("main"))
    pg.set_input_files("#ph", "/tmp/black.png"); pg.wait_for_function("document.getElementById('phs').textContent.includes('black')")
    check("black photo rejected with a clear message", not pg.locator("#pht").is_visible())
    pg.set_input_files("#ph", "/tmp/real.png"); pg.wait_for_function("document.getElementById('phs').textContent.includes('attached')")
    check("real photo accepted and shown", pg.locator("#pht").is_visible())
    pg.fill("#dd", "Moss felt cold and soft"); pg.check("#cq"); pg.click("#fin"); pg.wait_for_selector("text=Quest complete.")
    t = pg.inner_text("main")
    check("done screen is honest about verification", "Photo attached" in t and "min outside" in t)
    check("first achievement shown", "New: First steps" in t)
    pg.click("#ok"); pg.wait_for_selector("text=Latest:"); check("home shows latest achievement", "First steps" in pg.inner_text("main"))
    pg.click("a[href='#/journal']"); pg.wait_for_selector(".entry")
    check("journal lists the quest with discovery and photo", "Moss felt cold and soft" in pg.inner_text(".entry") and pg.locator(".entry img").count() == 1)
    pg.reload(); pg.wait_for_selector(".entry"); check("journal survives reload", True)
    check("no uncaught page errors", not errs); print(errs) if errs else None
    b.close()
sys.exit(0 if ok else 1)

# Browser test of the AI path against a mock OpenAI-compatible server (stands in for Ollama/gpt-oss).
import json, threading, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
GOOD = "TITLE: Moss and stone\nINTRO: Slow looking beats fast scrolling.\nSTEP: Find a mossy stone.\nSTEP: Describe it in three words.\nSTEP: Put it back exactly as it was.\nREFLECTION: Which word fits best?"
seen = []
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def _cors(self): self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Access-Control-Allow-Headers","*"); self.send_header("Access-Control-Allow-Methods","*")
    def do_OPTIONS(self): self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self): self.send_response(200); self._cors(); self.send_header("content-type","application/json"); self.end_headers(); self.wfile.write(b'{"data":[]}')
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"]))); seen.append(body)
        self.send_response(200); self._cors(); self.send_header("content-type","application/json"); self.end_headers()
        self.wfile.write(json.dumps({"choices":[{"message":{"content":GOOD}}]}).encode())
srv = HTTPServer(("127.0.0.1", 8101), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True
def check(n, c):
    global ok; ok &= bool(c); print(("PASS " if c else "FAIL ") + n)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={"width":390,"height":844}).new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8099/"); pg.click("[data-act=local]"); pg.wait_for_selector("text=Give me a quest")
    pg.click("a[href='#/you']"); pg.click("a[href='#/ai']"); pg.wait_for_selector("text=On-device AI")
    check("AI screen shows model, license, size", "SmolLM2-135M-Instruct" in pg.inner_text("main") and "Apache-2.0" in pg.inner_text("main") and "200 MB" in pg.inner_text("main"))
    pg.once("dialog", lambda d: d.dismiss()); pg.click("#aiOn"); pg.wait_for_timeout(300)
    check("declining the download confirmation downloads nothing and stays off", "Off" in pg.inner_text("#aiStatus") or pg.locator("#aiOff").count()==0)
    pg.click("input[name=prov][value=endpoint]"); pg.wait_for_selector("#bu"); pg.fill("#bu","http://127.0.0.1:8101/v1"); pg.fill("#mn","gpt-oss:20b")
    pg.click("#aiOn"); pg.wait_for_selector("#aiOff", timeout=8000)
    check("local server connects", "Ready" in pg.inner_text("#aiStatus"))
    pg.click("a[href='#/home']"); pg.click("text=Choose what I feel like"); pg.wait_for_selector("#qf")
    check("new-quest screen shows AI writer", "gpt-oss:20b" in pg.inner_text(".aiLine"))
    pg.click("input[name=environment][value=trail]"); pg.click("input[name=company][value=friends]"); pg.click("button[type=submit]"); pg.wait_for_selector("ol.steps")
    check("quest is AI-written and labelled", "Moss and stone" in pg.inner_text("h1") and "Written by gpt-oss:20b" in pg.inner_text("main"))
    u = seen[-1]["messages"][1]["content"]; check("model received the person's choices", "friends" in u and "trail" in u)
    pg.reload(); pg.wait_for_selector("ol.steps"); check("AI setting + quest survive reload", "Written by gpt-oss:20b" in pg.inner_text("main"))
    srv.shutdown(); srv.server_close(); pg.click("#drop"); pg.wait_for_selector("text=Give me a quest"); pg.click("#startQuest"); pg.wait_for_selector("ol.steps", timeout=15000)
    check("server down: still gets a quest from the library", "From the library" in pg.inner_text("main"))
    check("no uncaught page errors", not errs)
    b.close()
sys.exit(0 if ok else 1)

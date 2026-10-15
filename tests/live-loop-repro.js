// Live-loop repro: 2P PVP on map2, loop NOT halted; capture exceptions + check frames advance.
const { spawn } = require("child_process");
const path = require("path"), fs = require("fs"), os = require("os");
const gameDir = "C:/Users/lrafy/OneDrive/Desktop/New folder";
const mapId = process.env.MAP || "map2";
const port = 9333 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rp-"));
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1280,720", "--allow-file-access-from-files", "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let t; for (let i = 0; i < 50; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const logs = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    let s = null;
    if (m.method === "Runtime.exceptionThrown") s = "EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") s = "ERR " + m.params.args.map((a) => a.value || a.description).join(" ");
    if (s) { s = s.slice(0, 600); logs.set(s, (logs.get(s) || 0) + 1); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result;
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: "file:///" + gameDir + "/index.html#envtest" });
  await sleep(6000);
  const r1 = await ev(`(() => { const H = window.__gameTestHooks; if (!H) return "no hooks"; H.startPvpForTest(2, "deathmatch", "${mapId}"); return "started"; })()`);
  console.log("start:", JSON.stringify(r1.result?.value || r1.exceptionDetails?.exception?.description));
  await sleep(4000);
  const f = async () => (await ev(`(() => { const H = window.__gameTestHooks; return JSON.stringify({ t: performance.now()|0, p0: H.players[0].camera.position.toArray().map(v=>+v.toFixed(2)) }); })()`)).result?.value;
  console.log("frame a:", await f()); await sleep(1500);
  await ev(`window.__fc = 0; (function c(){ window.__fc++; requestAnimationFrame(c); })()`); await sleep(2000);
  console.log("rAF count in 2s:", (await ev("window.__fc")).result?.value);
  console.log("LOGS:"); for (const [k, v] of logs) console.log(v + "x " + k);
  ws.close(); proc.kill(); process.exit(0);
})();

// Runs the frame-cost benchmark (tests/perf-test.js) in headless Chrome
// on the real GPU and prints the results, plus a CPU profile of the live
// phase next to the output file.
//
//   node tests/run-perf.js [outFile.json] [cpuSlowdown] [devicePixelRatio]
//
// e.g. `node tests/run-perf.js perf.json 4 1.5` roughly approximates a
// laptop (4x slower CPU, 150% display scaling). HASH=#spawntest with
// RESULT_EXPR="document.getElementById('spawn-test-results').textContent"
// runs the campus spawn test the same way. Needs Chrome installed at the
// path below and Node 22+ (built-in fetch/WebSocket).
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const gameDir = path.join(__dirname, "..");
const mode = process.env.GL_MODE || "gpu"; // or "swiftshader" (software, for machines without a GPU)
const outFile = process.argv[2];
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9333 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "perfprof-"));
const args = [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--window-size=1920,1080", "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required",
  "--disable-gpu-vsync", "--disable-frame-rate-limit", "--no-first-run",
  ...(mode === "gpu" ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
  "about:blank",
];
const proc = spawn(chrome, args, { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); }
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") logs.push("EXC " + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 400));
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") logs.push("ERR " + msg.params.args.map((a) => a.value || a.description).join(" ").slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  const cpuRate = +(process.argv[3] || 1), dpr = +(process.argv[4] || 1);
  if (cpuRate > 1) await send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  if (dpr !== 1) await send("Emulation.setDeviceMetricsOverride", { width: 1904, height: 985, deviceScaleFactor: dpr, mobile: false });
  const url = "file:///" + path.resolve(gameDir, "index.html").replace(/\\/g, "/") + (process.env.HASH || "#perftest");
  await send("Page.navigate", { url });
  let result = null;
  let profiling = false, profile = null;
  await send("Profiler.enable");
  await send("Profiler.setSamplingInterval", { interval: 200 });
  for (let i = 0; i < 2000; i++) {
    await sleep(100);
    const ph = (await send("Runtime.evaluate", { expression: "window.__perfPhase || ''", returnByValue: true })).result.result.value;
    if (ph === "preLive" && !profiling) { profiling = true; await send("Profiler.start"); }
    if (ph === "liveDone" && profiling && !profile) { profile = (await send("Profiler.stop")).result.profile; }
    const r = await send("Runtime.evaluate", { expression: process.env.RESULT_EXPR || "window.__perfResults || null", returnByValue: true });
    if (r.result && r.result.result && r.result.result.value) { result = r.result.result.value; break; }
  }
  const text = result ? JSON.stringify(JSON.parse(result), null, 1) : "TIMEOUT";
  if (outFile) fs.writeFileSync(outFile, text);
  if (profile && outFile) {
    // Self time per function (+ file:line), top 40.
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    const dts = profile.timeDeltas;
    profile.samples.forEach((sid, i) => {
      const n = byId.get(sid); const cf = n.callFrame;
      const key = (cf.functionName || "(anon)") + " " + (cf.url.split("/").pop() || "") + ":" + (cf.lineNumber + 1);
      self.set(key, (self.get(key) || 0) + (dts[i] || 0));
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).filter(([k]) => process.env.PROFILE_FILTER ? new RegExp(process.env.PROFILE_FILTER).test(k) : true).slice(0, 45)
      .map(([k, v]) => (v / 1000).toFixed(1).padStart(8) + "ms " + (100 * v / total).toFixed(1).padStart(5) + "%  " + k);
    fs.writeFileSync(outFile.replace(/\.json$/, "-profile.txt"), top.join("\n"));
  }
  console.log(text);
  if (logs.length) console.log("PAGE ERRORS:\n" + logs.slice(0, 15).join("\n"));
  ws.close();
  proc.kill();
  process.exit(0);
})();

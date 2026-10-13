// PVP deathmatch smoke test. Loaded only when the game is opened as
// index.html#pvptest (see the test hooks at the end of index.html's script).
// Run:  HASH=#pvptest node tests/run-perf.js pvp.json
// Drives the real match code with a simulated clock (no rendering) and
// writes window.__perfResults = JSON { pass, checks:[{name, ok, detail}] }.
(function () {
  "use strict";
  const H = window.__gameTestHooks;
  H.haltLoop = true;
  const checks = [];
  const DT = 1 / 30;
  function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail: detail === undefined ? "" : String(detail) }); }
  function step(seconds) { for (let t = 0; t < seconds; t += DT) H.updateCoopMatchFrame(DT); }
  const visible = (id) => { const el = document.getElementById(id); return !!el && el.classList.contains("visible"); };
  const place = (p, x, z, yaw) => { p.camera.position.set(x, H.EYE_HEIGHT, z); p.campusGroundY = 0; p.yaw = yaw; p.pitch = 0; H.applyCameraRotation(p); };

  function run() {
    H.setMap("campus");
    const P = H.players;

    // 1. start
    H.startPvpForTest(2);
    check("1 pvp+coop flags", H.isPvpMatchActive && H.isCoopMatchActive);
    check("1 all awaiting spawn", P.every((p) => p.pvpAwaitingSpawn && p.isDead));
    check("1 panel p1 visible", visible("pvp-panel-p1"));
    check("1 body class", document.body.classList.contains("pvp-mode"));
    check("13 zone first delay 60", H.zoneState.phaseDuration === 60, H.zoneState.phaseDuration);

    // 2. deploy
    P.forEach((p) => H.pvpRespawnPlayer(p));
    const [a, b] = P;
    check("2 single slot pistol", a.inventorySlots[0].weaponId === "pistol" && a.inventorySlots[1] === null);
    check("2 infinite reserve", a.inventorySlots[0].reserveAmmo === H.PVP_INFINITE_RESERVE);
    check("2 infinity symbol", H.hudRefsFor(a).ammoReserveEl.textContent === "∞", H.hudRefsFor(a).ammoReserveEl.textContent);
    check("2 clock started", H.pvpMatch.started === true);
    check("2 panel hidden after deploy", !visible("pvp-panel-p1"));

    // 3/4. spawn points: apart, walkable, in the zone, mostly unseen
    const world = H.campusWorld;
    let bad = 0, hidden = 0, N = 50, minSeen = Infinity;
    const z = H.zoneState;
    for (let i = 0; i < N; i++) {
      const s = H.pickPvpSpawnPoint(a);
      const d = Math.hypot(s.x - b.camera.position.x, s.z - b.camera.position.z);
      minSeen = Math.min(minSeen, d);
      if (d < H.PVP_SPAWN.MIN_DISTANCE || !world.isWalkable(s.x, s.z, H.PVP_SPAWN.CLEARANCE) || Math.hypot(s.x - z.center.x, s.z - z.center.z) > z.radius) bad++;
      if (world.segmentBlocked(b.camera.position.x, b.camera.position.z, s.x, s.z, 0, false, H.targetStandingY(b), 0)) hidden++;
    }
    check("3 spawn points valid", bad === 0, "bad=" + bad + " minDist=" + minSeen.toFixed(1));
    check("4 spawn points mostly hidden", hidden >= N * 0.5, "hidden=" + hidden + "/" + N);

    // 5. shooting: P2 ten metres ahead of P1 in the open
    const sp = world.spawn;
    let dir = null;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const fx = sp.x - Math.sin(yaw) * 10, fz = sp.z - Math.cos(yaw) * 10;
      if (world.isWalkable(fx, fz, 0.5) && !world.segmentBlocked(sp.x, sp.z, fx, fz, 0.2, false, 0, 0)) { dir = { yaw, fx, fz }; break; }
    }
    check("5 found open firing lane", !!dir);
    if (dir) {
      place(a, sp.x, sp.z, dir.yaw);
      place(b, dir.fx, dir.fz, 0);
      a.pvpProtectedFor = b.pvpProtectedFor = 0;
      const hp0 = b.health;
      const slot = a.inventorySlots[0];
      slot.fireCooldownRemaining = 0; slot.loadedAmmo = 12;
      H.fireWeapon(a);
      check("5 pistol hit lowers health", b.health < hp0, hp0 + " -> " + b.health);
      let shots = 0;
      while (!b.isDead && shots++ < 60) { slot.fireCooldownRemaining = 0; slot.loadedAmmo = 12; slot.isReloading = false; a.pvpProtectedFor = 0; H.fireWeapon(a); }
      check("5 victim dead not downed", b.isDead && !b.isDowned && b.pvpAwaitingSpawn);
      check("5 kill credit", a.pvpKills === 1 && b.pvpDeaths === 1, "k=" + a.pvpKills + " d=" + b.pvpDeaths);
      check("5 panel says by P1", document.querySelector("#pvp-panel-p2 .pvp-panel-sub").textContent === "by P1", document.querySelector("#pvp-panel-p2 .pvp-panel-sub").textContent);
      check("5 respawn timer 5", Math.abs(b.pvpRespawnTimer - H.PVP_RESPAWN_DELAY_SECONDS) < 1e-6, b.pvpRespawnTimer);
      // 6. respawn gate
      check("9 respawn blocked early", H.pvpTryRespawn(b) === false && b.pvpAwaitingSpawn);
      step(5.1);
      check("9 respawn after timer", H.pvpTryRespawn(b) === true && !b.pvpAwaitingSpawn && b.health > 0);
      // 8. spawn protection
      place(b, dir.fx, dir.fz, 0);
      const hpP = b.health;
      b.pvpProtectedFor = 2;
      slot.fireCooldownRemaining = 0; slot.loadedAmmo = 12;
      H.takeDamage(b, 10, { x: a.camera.position.x, z: a.camera.position.z }, a);
      check("8 spawn protection blocks damage", b.health === hpP, b.health);
      // 6. self damage
      const hpA = a.health;
      H.takeDamage(a, 10, { x: 0, z: 0 }, a);
      check("6 self damage ignored", a.health === hpA);
    }

    // 10/11/12 no PVE + PVP rules
    P.forEach((p) => { if (p.isDead) { p.pvpRespawnTimer = 0; H.pvpTryRespawn(p); } });
    step(120);
    check("10 no enemies/waves", H.enemies.length === 0 && H.waveNumber === 0, "enemies=" + H.enemies.length + " wave=" + H.waveNumber);
    check("10 wave hud hidden", getComputedStyle(document.getElementById("wave-hud")).display === "none");
    a.isInventoryOpen = false;
    H.toggleInventory(a);
    check("11 inventory disabled", a.isInventoryOpen === false);
    check("11 stamina doubled", H.getMaxStamina(a) === 200, H.getMaxStamina(a));
    check("11 teammate markers hidden", P.every((p) => !p.teammateMarker.visible));
    place(a, sp.x, sp.z, 0);
    a.isGrounded = true; a.slideCooldown = 0; a.stamina = 200; a.isDead = false;
    a.velocity.set(0, 0, -8);
    H.tryStartSlide(a);
    check("12 slide without skill", a.isSliding === true);

    // 14 end of match
    P.forEach((p) => { p.pvpKills = 0; });
    a.pvpKills = 3;
    H.pvpMatch.timeLeft = 0.01;
    step(0.2);
    check("14 results visible", visible("pvp-results"));
    check("14 banner names P1", document.getElementById("pvp-results-banner").textContent === "P1 WINS", document.getElementById("pvp-results-banner").textContent);
    check("14 frozen", H.pvpMatch.ended === true);

    // 15 reset + singleplayer behaves normally
    H.resetGame();
    check("15 flags cleared", !H.isPvpMatchActive && !document.body.classList.contains("pvp-mode") && !visible("pvp-results") && !visible("pvp-panel-p1"));
    H.startRun();
    check("15 singleplayer stamina 100", H.getMaxStamina(H.players[0]) === 100, H.getMaxStamina(H.players[0]));

    // 16 four players
    H.startPvpForTest(4);
    check("16 four players pvp", H.players.length === 4 && H.isPvpMatchActive && H.players.every((p) => p.pvpAwaitingSpawn));
    H.players.forEach((p) => H.pvpRespawnPlayer(p));
    step(1);
    check("16 kills board rows", document.querySelectorAll("#pvp-kills .pvp-board-row").length === 4);
    H.resetGame();
  }

  try { run(); } catch (e) { check("exception", false, e && e.stack || e); }
  const pass = checks.every((c) => c.ok);
  window.__perfResults = JSON.stringify({ pass, checks });
})();

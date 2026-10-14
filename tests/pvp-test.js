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

    // 0. setup-screen mode picker (difficulty row is replaced in PVP)
    H.setPvpSetup(true);
    check("0 default mode deathmatch", H.pvpMode === "deathmatch", H.pvpMode);
    check("0 setup panels flagged", document.getElementById("title-coop-setup").classList.contains("pvp-setup") && document.getElementById("title-quad-setup").classList.contains("pvp-setup"));
    check("0 difficulty hidden, mode shown", getComputedStyle(document.getElementById("coop-difficulty-options")).display === "none" && getComputedStyle(document.getElementById("coop-pvp-mode-options")).display === "flex");
    check("0 deathmatch option active", document.querySelector("#coop-pvp-mode-options [data-pvp-mode=deathmatch]").classList.contains("active"));
    document.querySelector("#quad-pvp-mode-options [data-pvp-mode=gungame]").click();
    check("0 click selects gungame", H.pvpMode === "gungame" && document.querySelector("#quad-pvp-mode-options [data-pvp-mode=gungame]").classList.contains("active"));
    H.stepPvpMode(-1);
    check("0 stick step back to deathmatch", H.pvpMode === "deathmatch");
    H.stepPvpMode(1);
    check("0 stick step to gungame", H.pvpMode === "gungame");
    H.setPvpSetup(false);
    check("0 PVE setup unflagged", !document.getElementById("title-coop-setup").classList.contains("pvp-setup") && getComputedStyle(document.getElementById("coop-difficulty-options")).display !== "none");

    // 1. start
    H.startPvpForTest(2);
    check("1 mode passed to match", H.pvpMatch.mode === "deathmatch", H.pvpMatch.mode);
    check("1 match is 15 minutes", H.PVP_MATCH_SECONDS === 900 && H.pvpMatch.timeLeft === 900, H.PVP_MATCH_SECONDS + "/" + H.pvpMatch.timeLeft);
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
    check("2 infinity symbol enlarged", H.hudRefsFor(a).ammoReserveEl.classList.contains("pvp-inf") && parseFloat(getComputedStyle(H.hudRefsFor(a).ammoReserveEl).fontSize) > 18 * 1.3, getComputedStyle(H.hudRefsFor(a).ammoReserveEl).fontSize);
    check("2 players glow (own body material)", a.human.meshes.every((m) => m.material !== H.humanSystem.bodyMaterial) && a.human.meshes[0].material !== b.human.meshes[0].material);
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
      // the glow material must compile and render (shader errors go to console.error)
      step(0.2);
      const shaderErrors = [];
      const origError = console.error;
      console.error = (...args) => { shaderErrors.push(args.join(" ").slice(0, 300)); };
      H.updatePlayerBodyMeshes(DT); P.forEach((p) => { p.human.root.visible = true; }); // (updatePlayerBodyMeshes normally runs from animate(), which is halted)
      try { H.renderFrame(); } finally { console.error = origError; }
      check("4 glow material renders without shader errors", shaderErrors.length === 0, shaderErrors[0] || "");
      const glowProps = H.renderer.properties.get(b.human.meshes[0].material);
      check("4 glow program was compiled", !!(glowProps && glowProps.currentProgram) && /pvpGlow/.test(glowProps.currentProgram.cacheKey), glowProps && glowProps.currentProgram ? glowProps.currentProgram.cacheKey.slice(0, 120) : "no program");
      const hp0 = b.health;
      const slot = a.inventorySlots[0];
      slot.fireCooldownRemaining = 0; slot.loadedAmmo = 12;
      for (let tries = 0; tries < 6 && b.health >= hp0; tries++) { slot.fireCooldownRemaining = 0; slot.loadedAmmo = 12; H.fireWeapon(a); } // pistol spread is random: allow a few shots
      check("5 pistol hit lowers health", b.health < hp0, hp0 + " -> " + b.health);
      a.health = 30;
      let shots = 0;
      while (!b.isDead && shots++ < 60) { slot.fireCooldownRemaining = 0; slot.loadedAmmo = 12; slot.isReloading = false; a.pvpProtectedFor = 0; H.fireWeapon(a); }
      check("5 victim dead not downed", b.isDead && !b.isDowned && b.pvpAwaitingSpawn);
      check("5 heal on kill +50", a.health >= 80 && a.health <= 100, a.health);
      const feedLines = () => Array.from(document.querySelectorAll("#pvp-killfeed .pvp-feed-line"));
      check("5 kill feed line", feedLines().length === 1 && /pistol/i.test(feedLines()[0].textContent) && feedLines()[0].querySelectorAll("img").length === 2, feedLines().map((l) => l.textContent).join("|"));
      check("5 kill feed top-right", getComputedStyle(document.getElementById("pvp-killfeed")).right === "10px" && getComputedStyle(document.getElementById("pvp-killfeed")).top === "10px");
      check("5 kill credit", a.pvpKills === 1 && b.pvpDeaths === 1, "k=" + a.pvpKills + " d=" + b.pvpDeaths);
      check("5 panel says by P1", document.querySelector("#pvp-panel-p2 .pvp-panel-sub").textContent === "by P1", document.querySelector("#pvp-panel-p2 .pvp-panel-sub").textContent);
      check("5 respawn timer 5", Math.abs(b.pvpRespawnTimer - H.PVP_RESPAWN_DELAY_SECONDS) < 1e-6, b.pvpRespawnTimer);
      // 6. respawn gate
      check("9 respawn blocked early", H.pvpTryRespawn(b) === false && b.pvpAwaitingSpawn);
      // weapon list: eight weapons, vertical, no fists; selection scrolls into view
      const listEl = document.querySelector("#pvp-panel-p2 .pvp-weapon-list");
      check("7 weapon list 8 rows", listEl.children.length === 8 && !Array.from(listEl.children).some((li) => /fist/i.test(li.textContent)), listEl.children.length);
      check("7 list is a vertical scroller", getComputedStyle(listEl).overflowY === "auto" && getComputedStyle(listEl).flexDirection === "column");
      listEl.style.maxHeight = "70px";
      H.pvpSelectWeapon(b, "katana");
      check("7 katana highlighted + scrolled into view", listEl.querySelector("li.selected").dataset.weaponId === "katana" && listEl.scrollTop > 0, "scrollTop=" + listEl.scrollTop);
      H.pvpSelectWeapon(b, "pistol");
      check("7 scroll back up", listEl.scrollTop === 0, listEl.scrollTop);
      listEl.style.maxHeight = "";
      check("7 respawn hidden during countdown", getComputedStyle(document.querySelector("#pvp-panel-p2 .pvp-respawn")).display === "none");
      step(5.1);
      check("5 kill feed faded out", feedLines().length === 0, feedLines().length);
      check("7 respawn button appears after 5s", getComputedStyle(document.querySelector("#pvp-panel-p2 .pvp-respawn")).display !== "none");
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

    // 17 fall damage x0.5 in PVP only; the glow material is removed afterwards
    check("17 pve fall damage 10m = 33", H.fallDamageAmount(10) === 33, H.fallDamageAmount(10));
    H.startPvpForTest(2);
    check("17 pvp fall damage 10m = 16", H.fallDamageAmount(10) === 16, H.fallDamageAmount(10));
    const glowBody = H.players[0].human.meshes[0].material;
    H.resetGame();
    check("17 glow removed after match", H.players[0].human.meshes.every((m) => m.material === H.humanSystem.bodyMaterial) && glowBody !== H.humanSystem.bodyMaterial);

    // 18 kill feed: max 5 lines, zone / fall labels, heal clamps at max health
    H.startPvpForTest(2);
    const [fa, fb] = H.players;
    const ready = (p) => { if (p.pvpAwaitingSpawn) { p.pvpRespawnTimer = 0; H.pvpTryRespawn(p); } p.pvpProtectedFor = 0; };
    const kill = (att, vic) => { ready(vic); ready(att); H.takeDamage(vic, 9999, { x: 0, z: 0 }, att); };
    H.players.forEach((p) => H.pvpRespawnPlayer(p));
    const feed = () => Array.from(document.querySelectorAll("#pvp-killfeed .pvp-feed-line"));
    for (let i = 0; i < 6; i++) kill(fa, fb);
    check("18 feed capped at 5", feed().length === 5, feed().length);
    check("18 heal clamped to 100", fa.health === 100, fa.health);
    ready(fb); H.takeDamage(fb, 9999, null);
    check("18 zone death labelled", /zone/i.test(feed()[feed().length - 1].textContent), feed()[feed().length - 1].textContent);
    ready(fb); H.takeDamage(fb, 9999);
    check("18 fall death labelled", /fell/i.test(feed()[feed().length - 1].textContent), feed()[feed().length - 1].textContent);
    check("18 zone/fall give no kills", fa.pvpKills === 6 && fb.pvpDeaths === 8, fa.pvpKills + "/" + fb.pvpDeaths);
    H.resetGame();

    // 19 Gun Game
    H.startPvpForTest(2, "gungame");
    const [ga, gb] = H.players;
    const LAD = H.PVP_GUN_GAME_LADDER;
    check("19 gungame ladder", H.pvpMatch.mode === "gungame" && LAD.join() === "pistol,glock,shotgun,smg,ak47,sniper,ak47,smg,shotgun,glock,pistol,katana,bat", LAD.join());
    const pickerEl = document.querySelector("#pvp-panel-p1 .pvp-weapon-list");
    check("19 prematch has no weapon picker", getComputedStyle(pickerEl).display === "none");
    H.players.forEach((p) => H.pvpRespawnPlayer(p));
    step(0.5);
    check("19 board header Level + 1/13", document.querySelector("#pvp-kills .pvp-board-title").textContent === "Level" && /1\/13/.test(document.querySelector("#pvp-kills .pvp-board-row").textContent), document.getElementById("pvp-kills").textContent);
    check("19 start weapon pistol, infinite reserve", ga.inventorySlots[0].weaponId === "pistol" && ga.inventorySlots[0].reserveAmmo === H.PVP_INFINITE_RESERVE);
    let ladderOk = true, ladderDetail = "";
    for (let lvl = 1; lvl <= 12; lvl++) {
      ga.inventorySlots[0].loadedAmmo = 0; // must come back full on the swap
      kill(ga, gb);
      const slot = ga.inventorySlots[0];
      const melee = LAD[lvl] === "katana" || LAD[lvl] === "bat";
      if (ga.pvpLevel !== lvl || slot.weaponId !== LAD[lvl] || ga.inventorySlots[1] !== null || (!melee && (slot.loadedAmmo <= 0 || slot.reserveAmmo !== H.PVP_INFINITE_RESERVE))) {
        ladderOk = false; ladderDetail = "lvl=" + ga.pvpLevel + " weapon=" + slot.weaponId + " want " + LAD[lvl] + " mag=" + slot.loadedAmmo; break;
      }
    }
    check("19 ladder advances one weapon per kill (full mag, infinite reserve)", ladderOk && ga.pvpLevel === 12, ladderDetail);
    check("19 victim level unchanged by dying", gb.pvpLevel === 0 && gb.pvpDeaths === 12, gb.pvpLevel + "/" + gb.pvpDeaths);
    ready(gb);
    check("19 victim respawns with their own level weapon", gb.inventorySlots[0].weaponId === "pistol");
    check("19 death panel: no picker", getComputedStyle(document.querySelector("#pvp-panel-p2 .pvp-weapon-list")).display === "none");
    step(0.5);
    check("19 board shows 13/13", /13\/13/.test(document.getElementById("pvp-kills").textContent), document.getElementById("pvp-kills").textContent);
    ready(ga); H.takeDamage(ga, 9999, null);
    check("19 zone death does not advance or kill", ga.pvpLevel === 12 && gb.pvpKills === 0);
    ready(ga);
    kill(ga, gb); // a kill on the last weapon wins
    step(0.1);
    check("19 last-weapon kill ends match", H.pvpMatch.ended === true && visible("pvp-results"));
    check("19 banner P1 wins", document.getElementById("pvp-results-banner").textContent === "P1 WINS", document.getElementById("pvp-results-banner").textContent);
    check("19 results header Level", document.querySelector("#pvp-results-board .pvp-board-title").textContent === "Level");
    H.resetGame();

    // 19b Gun Game timer end: furthest level wins, then whoever reached it first
    H.startPvpForTest(2, "gungame");
    H.players.forEach((p) => H.pvpRespawnPlayer(p));
    H.players[0].pvpLevel = 4; H.players[1].pvpLevel = 6;
    H.pvpMatch.timeLeft = 0.01;
    step(0.2);
    check("19b furthest level wins", document.getElementById("pvp-results-banner").textContent === "P2 WINS", document.getElementById("pvp-results-banner").textContent);
    H.resetGame();
    H.startPvpForTest(2, "gungame");
    H.players.forEach((p) => H.pvpRespawnPlayer(p));
    H.players[0].pvpLevel = H.players[1].pvpLevel = 5;
    H.players[0].pvpLevelAt = 200; H.players[1].pvpLevelAt = 100;
    H.pvpMatch.timeLeft = 0.01;
    step(0.2);
    check("19b level tie -> first to reach wins", document.getElementById("pvp-results-banner").textContent === "P2 WINS", document.getElementById("pvp-results-banner").textContent);
    H.resetGame();

    // 20 damage table + hit zones (needs the open firing lane found in section 5)
    const T = H.PVP_DAMAGE_TABLE;
    check("20 table: 1911 25/50, glock 34/50, smg 25/34, ak 37/50",
      T.pistol.torso === 25 && T.pistol.head === 50 && T.glock.torso === 34 && T.glock.head === 50 && T.smg.legs === 25 && T.smg.head === 34 && T.ak47.arms === 37 && T.ak47.head === 50);
    check("20 table: sniper 100 torso/neck, 60 arms/legs, 200 head", T.sniper.torso === 100 && T.sniper.neck === 100 && T.sniper.arms === 60 && T.sniper.legs === 60 && T.sniper.head === 200);
    check("20 table: shotgun 11.5 per pellet", T.shotgun.pellet === 11.5);
    check("20 pvpGunDamage reads the table", H.pvpGunDamage({ id: "sniper", gun: { damage: 1 } }, "arms") === 60 && H.pvpGunDamage({ id: "smg", gun: { damage: 1 } }, "head") === 34 && H.pvpGunDamage({ id: "unknown", gun: { damage: 7 } }, "head") === 7);
    if (dir) {
      H.setPvpSetting("health", 300);
      H.startPvpForTest(2);
      const [za, zb] = H.players;
      H.players.forEach((p) => H.pvpRespawnPlayer(p));
      za.pvpProtectedFor = zb.pvpProtectedFor = 0;
      const lx = (dir.fx - sp.x) / 10, lz = (dir.fz - sp.z) / 10;   // unit vector along the lane
      const perp = { x: -lz, z: lx };
      place(za, sp.x, sp.z, dir.yaw);
      place(zb, dir.fx, dir.fz, Math.atan2(-perp.z, perp.x));         // zb's view-right axis = perp
      const zoneAt = (y, lateral) => {
        const hit = H.findPvpPlayerHits(za, { origin: { x: sp.x + perp.x * lateral, y, z: sp.z + perp.z * lateral }, direction: { x: lx, y: 0, z: lz } }, Infinity)[0];
        return hit ? hit.zone : "miss";
      };
      const cases = [[1.65, 0, "head"], [1.47, 0, "neck"], [1.47, 0.3, "torso"], [1.41, 0.3, "torso"], [1.2, 0, "torso"], [1.2, 0.2, "arms"], [1.2, -0.2, "arms"],
        [0.9, 0, "torso"], [0.9, 0.22, "arms"], [0.85, 0, "torso"], [0.6, 0, "legs"], [0.2, 0.1, "legs"]];
      const bad = cases.map(([y, lat, want]) => { const got = zoneAt(y, lat); return got === want ? null : y + "/" + lat + " " + got + "!=" + want; }).filter(Boolean);
      check("20 hit zones: head, neck, shoulders=torso, arms, groin=torso, legs", bad.length === 0, bad.join("; "));
      // crouching shrinks the zones with the body
      zb.currentEyeHeight = 1.0;
      zb.camera.position.y = 1.0;
      check("20 crouched: the standing neck height is now over the head", zoneAt(1.0, 0) === "head" && zoneAt(0.5, 0) === "torso", zoneAt(1.0, 0) + "/" + zoneAt(0.5, 0));
      zb.currentEyeHeight = H.EYE_HEIGHT; zb.camera.position.y = H.EYE_HEIGHT;
      // end to end: aimed pistol shot at head height (eye 1.7 vs eye 1.7) -> 50 on a 300 HP target
      check("20 setting: 300 max HP at spawn", zb.health === 300 && H.getMaxHealth(zb) === 300, zb.health);
      const pslot = za.inventorySlots[0];
      za.isAiming = true;
      pslot.fireCooldownRemaining = 0; pslot.loadedAmmo = 12; pslot.isReloading = false;
      H.fireWeapon(za);
      check("20 pistol headshot = 50", zb.health === 250, zb.health);
      za.isAiming = false;
      H.resetGame();
    }

    // 21 Settings panel + health / speed settings
    check("21 settings defaults", H.PVP_SETTINGS_DEFAULT.health === 100 && H.PVP_SETTINGS_DEFAULT.speed === 100);
    H.setPvpSetting("health", 100); H.setPvpSetting("speed", 100);
    H.setPvpSetup(true);
    const settingsBtn = document.getElementById("coop-pvp-settings-button");
    check("21 settings button shown in PVP setup", getComputedStyle(settingsBtn).display !== "none");
    settingsBtn.click();
    check("21 panel opens", H.isPvpSettingsOpen() && getComputedStyle(document.getElementById("pvp-settings-panel")).display === "flex");
    const hs = document.getElementById("pvp-health-slider"), ss = document.getElementById("pvp-speed-slider");
    check("21 slider ranges", hs.min === "25" && hs.max === "300" && hs.step === "25" && ss.min === "50" && ss.max === "200" && ss.step === "5");
    hs.value = "275"; hs.dispatchEvent(new Event("input"));
    ss.value = "130"; ss.dispatchEvent(new Event("input"));
    check("21 sliders write settings + labels", H.pvpSettings.health === 275 && H.pvpSettings.speed === 130 && document.getElementById("pvp-health-value").textContent === "275" && document.getElementById("pvp-speed-value").textContent === "130%",
      H.pvpSettings.health + "/" + H.pvpSettings.speed);
    H.setPvpSetting("health", 5); H.setPvpSetting("speed", 500);
    check("21 values clamp", H.pvpSettings.health === 25 && H.pvpSettings.speed === 200);
    H.setPvpSetting("health", 160); H.setPvpSetting("speed", 52);
    check("21 values snap to step", H.pvpSettings.health === 150 && H.pvpSettings.speed === 50, H.pvpSettings.health + "/" + H.pvpSettings.speed);
    document.getElementById("pvp-settings-reset").click();
    check("21 reset to default", H.pvpSettings.health === 100 && H.pvpSettings.speed === 100 && hs.value === "100" && ss.value === "100" && document.getElementById("pvp-speed-value").textContent === "100%");
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
    check("21 Esc closes panel", !H.isPvpSettingsOpen());
    settingsBtn.click();
    document.getElementById("pvp-settings-done").click();
    check("21 Done closes panel", !H.isPvpSettingsOpen());
    H.setPvpSetup(false);
    check("21 settings button hidden outside PVP", getComputedStyle(settingsBtn).display === "none");

    H.setPvpSetting("health", 200); H.setPvpSetting("speed", 150);
    H.startPvpForTest(2);
    const [sa, sb] = H.players;
    H.players.forEach((p) => H.pvpRespawnPlayer(p));
    check("21 match: speed multiplier = 1.15 x 1.5", Math.abs(H.pvpMoveSpeedMultiplier() - 1.15 * 1.5) < 1e-9, H.pvpMoveSpeedMultiplier());
    check("21 match: start + max health 200", sa.health === 200 && sb.health === 200 && H.getMaxHealth(sa) === 200, sa.health);
    check("21 HUD max text + full bar", H.hudRefsFor(sa).healthMaxTextEl.textContent === "200" && H.hudRefsFor(sa).healthBarFillEl.style.width === "100%", H.hudRefsFor(sa).healthMaxTextEl.textContent + " " + H.hudRefsFor(sa).healthBarFillEl.style.width);
    sa.pvpProtectedFor = sb.pvpProtectedFor = 0;
    sa.health = 100; H.updateHealthUI(sa);
    check("21 HUD bar scales to max (100/200 = 50%)", H.hudRefsFor(sa).healthBarFillEl.style.width === "50%", H.hudRefsFor(sa).healthBarFillEl.style.width);
    H.takeDamage(sb, 9999, { x: 0, z: 0 }, sa);
    check("21 heal on kill +50 under the chosen max", sa.health === 150, sa.health);
    sa.health = 180;
    sb.pvpRespawnTimer = 0; H.pvpTryRespawn(sb); sb.pvpProtectedFor = 0;
    H.takeDamage(sb, 9999, { x: 0, z: 0 }, sa);
    check("21 heal on kill clamps to chosen max (200)", sa.health === 200, sa.health);
    H.resetGame();
    check("21 PVE unaffected: max health 100, speed x1", H.getMaxHealth(H.players[0]) === 100 && H.pvpMoveSpeedMultiplier() === 1, H.getMaxHealth(H.players[0]) + "/" + H.pvpMoveSpeedMultiplier());
    H.setPvpSetting("health", 100); H.setPvpSetting("speed", 100);
  }

  try { run(); } catch (e) { check("exception", false, e && e.stack || e); }
  const pass = checks.every((c) => c.ok);
  window.__perfResults = JSON.stringify({ pass, checks });
})();

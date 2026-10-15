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

    // 00. menu flow: player count -> game type (PVE / PVP) -> setup screen, Back through every step
    const panelActive = (id) => document.getElementById(id).classList.contains("active");
    const click = (sel) => document.querySelector(sel).click();
    check("00 player-count screen has no PVP rows", !document.querySelector("[data-pvp-players]") && document.querySelectorAll("#player-count-options .mode-option").length === 3);
    click('.mode-option[data-mode="multiplayer"]');
    check("00 multiplayer opens the player count", panelActive("title-player-count"));
    click('.mode-option[data-players="3"]');
    check("00 a count opens the game-type screen", panelActive("title-game-type") && !panelActive("title-player-count"));
    click("#game-type-back-button");
    check("00 game-type back -> player count", panelActive("title-player-count"));
    click('.mode-option[data-players="2"]'); click('.mode-option[data-game-type="pvp"]');
    check("00 2 players + PVP -> coop setup, pvp-flagged", panelActive("title-coop-setup") && document.getElementById("title-coop-setup").classList.contains("pvp-setup"));
    click("#coop-setup-back-button");
    check("00 coop setup back -> game type", panelActive("title-game-type"));
    click('.mode-option[data-game-type="pve"]');
    check("00 2 players + PVE -> coop setup, not pvp", panelActive("title-coop-setup") && !document.getElementById("title-coop-setup").classList.contains("pvp-setup"));
    click("#coop-setup-back-button"); click("#game-type-back-button");
    click('.mode-option[data-players="4"]'); click('.mode-option[data-game-type="pvp"]');
    check("00 4 players + PVP -> quad setup, pvp-flagged", panelActive("title-quad-setup") && document.getElementById("title-quad-setup").classList.contains("pvp-setup"));
    check("00 quad setup lists five categories", document.querySelectorAll("#title-quad-setup .customize-list")[0].querySelectorAll(".customize-row").length === 5);
    click("#quad-setup-back-button");
    check("00 quad setup back -> game type", panelActive("title-game-type"));
    click('.mode-option[data-game-type="pve"]');
    check("00 4 players + PVE -> quad setup, not pvp", panelActive("title-quad-setup") && !document.getElementById("title-quad-setup").classList.contains("pvp-setup"));
    click("#quad-setup-back-button"); click("#game-type-back-button"); click("#player-count-back-button");
    check("00 player count back -> mode screen", panelActive("title-mode"));

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
      check("5 kill feed line", feedLines().length === 1 && /pistol/i.test(feedLines()[0].querySelector("img.pvp-feed-gun").alt) && feedLines()[0].querySelectorAll("img").length === 3 && getComputedStyle(feedLines()[0].querySelector("img.pvp-feed-gun")).filter.includes("brightness(0)"), feedLines().map((l) => l.textContent).join("|"));
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
    // win screen: the cursor must stay un-hidden for mouse clicks even if something re-hides it (a controller player's input), and the mouse stays free
    document.body.classList.add("hide-cursor"); document.dispatchEvent(new MouseEvent("mousemove"));
    check("19 win screen: a mouse move frees the cursor", !document.body.classList.contains("hide-cursor") && document.pointerLockElement === null);
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

    // 22. controller aim assist works in PVP (slowdown + magnetism toward the other players)
    {
      H.startPvpForTest(2);
      const [ca, cb] = H.players;
      H.players.forEach((p) => H.pvpRespawnPlayer(p));
      cb.pvpProtectedFor = 0;
      const realGetGamepads = navigator.getGamepads;
      const pad = { axes: [0, 0, 0, 0], buttons: [] };
      navigator.getGamepads = () => [pad, null, null, null];
      const prevScale = H.getAimAssistScale();
      H.setAimAssistScale(0.4 * 0.6); // default 60% slider
      const aim = (yawOff) => { // face cb from ca, yawOff radians away
        const dx = cb.camera.position.x - ca.camera.position.x, dz = cb.camera.position.z - ca.camera.position.z;
        const yaw = Math.atan2(-dx, -dz) + yawOff;
        const pitch = Math.atan2(cb.camera.position.y - 0.1 - ca.camera.position.y, Math.hypot(dx, dz));
        ca.yaw = yaw; ca.pitch = pitch;
        ca.camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
        ca.camera.updateMatrixWorld(true);
      };
      let placed = false;
      for (let k = 0; k < 16 && !placed; k++) {
        const ang = (k / 16) * Math.PI * 2;
        cb.camera.position.set(ca.camera.position.x + Math.sin(ang) * 8, ca.camera.position.y, ca.camera.position.z + Math.cos(ang) * 8);
        aim(0);
        placed = !!H.findAimAssistTarget(ca);
      }
      check("22 aim assist finds the other player in PVP", placed);
      if (placed) {
        aim(0.04); // ~2.3 deg off: inside the magnetism cone, stick centred
        const near = ca.input.pollLookDelta(1 / 60, ca);
        check("22 magnetism pulls yaw toward target with stick centred", near.dYaw !== 0 && Math.sign(near.dYaw) === 1 && Math.abs(near.dYaw) < 0.04, JSON.stringify(near));
        pad.axes[2] = 0.8; // right stick pushed: slowdown vs. no target
        const withTarget = ca.input.pollLookDelta(1 / 60, ca);
        aim(1.0); // 57 deg off: no target
        const without = ca.input.pollLookDelta(1 / 60, ca);
        check("22 slowdown reduces look speed near target", Math.abs(withTarget.dYaw) < Math.abs(without.dYaw), Math.abs(withTarget.dYaw) + " vs " + Math.abs(without.dYaw));
        pad.axes[2] = 0;
        aim(0.04);
        H.setAimAssistScale(0);
        const off = ca.input.pollLookDelta(1 / 60, ca);
        check("22 slider 0% disables aim assist", off.dYaw === 0 && off.dPitch === 0, JSON.stringify(off));
        H.setAimAssistScale(0.4 * 0.6);
        cb.isDead = true;
        check("22 dead players are not targeted", !H.findAimAssistTarget(ca));
        cb.isDead = false;
        cb.pvpAwaitingSpawn = true;
        check("22 players awaiting spawn are not targeted", !H.findAimAssistTarget(ca));
        cb.pvpAwaitingSpawn = false;
        cb.camera.position.set(ca.camera.position.x + 40, ca.camera.position.y, ca.camera.position.z);
        aim(0);
        check("22 no assist beyond range", !H.findAimAssistTarget(ca));
      }
      // 23. minimap draws round buildings (Nelson Hall) -- regression
      if (H.isCampusMap && H.campusWorld) {
        const tower = H.campusWorld.minimapFootprints().find((c) => c.shape === "cylinder" && c.radius >= 2);
        check("23 a round building exists in the minimap footprints", !!tower);
        if (tower) {
          H.zoneUi.layerKey = null; H.ensureZoneStaticLayer();
          const m = H.zoneMapRect(), k = H.zoneUi.layerPxPerM;
          const px = Math.round((tower.cx - m.minX) * k), py = Math.round((tower.cz - m.minZ) * k);
          const d = H.zoneUi.layer.getContext("2d").getImageData(px, py, 1, 1).data;
          check("23 minimap layer shows the tower fill (not ground green)", d[0] === 0x8b && d[1] === 0x91 && d[2] === 0x99, d[0] + "," + d[1] + "," + d[2]);
        }
      }
      navigator.getGamepads = realGetGamepads;
      H.setAimAssistScale(prevScale);
      H.resetGame();
    }
  }

  // ---- Map 2 ("Residential") checks, prefix M2 ----
  function runMap2() {
    const disp = (id) => getComputedStyle(document.getElementById(id)).display;
    H.setMap("campus");
    H.setPvpSetup(true);
    check("M2.0a coop+quad setups show the map picker in PVP", disp("coop-pvp-map-options") === "flex" && disp("quad-pvp-map-options") === "flex");
    check("M2.0b default map is campus and active", H.pvpMapId === "campus" && document.querySelector("#coop-pvp-map-options [data-pvp-map=campus]").classList.contains("active"));
    const modeBefore = H.pvpMode;
    document.querySelector("#coop-pvp-map-options [data-pvp-map=map2]").click();
    check("M2.0c clicking Residential sets map2 without touching the mode", H.pvpMapId === "map2" && H.pvpMode === modeBefore && document.querySelector("#coop-pvp-map-options [data-pvp-map=map2]").classList.contains("active"), H.pvpMapId + "/" + H.pvpMode);
    H.stepPvpMap(-1); const a = H.pvpMapId; H.stepPvpMap(-1); const b = H.pvpMapId; H.stepPvpMap(1); H.stepPvpMap(1); const c = H.pvpMapId;
    check("M2.0d stepPvpMap steps and clamps", a === "campus" && b === "campus" && c === "map2", [a, b, c]);
    H.setPvpSetup(false);
    check("M2.0e PVE setup hides the map picker", disp("coop-pvp-map-options") === "none" && disp("quad-pvp-map-options") === "none");
    H.setPvpMap("map2");
    H.startPvpForTest(2, "deathmatch", "map2");
    const W = H.map2World;
    check("M2.1 map2 is the current world", !!W && H.currentWorld === W && H.selectedMapId === "map2" && W.root.visible && !(H.campusWorld && H.campusWorld.root.visible));
    const bd = W.bounds, sx = bd.maxX - bd.minX, sz = bd.maxZ - bd.minZ;
    check("M2.1 bounds span 100..140 m", sx >= 100 && sx <= 140 && sz >= 100 && sz <= 140, sx + "x" + sz);
    // spawns
    const sp = W.pvpSpawnPoints;
    check("M2.2 8 spawn points", sp.length >= 8, sp.length);
    check("M2.2 spawns walkable and inside", sp.every((p) => W.isWalkable(p[0], p[1], 0.8) && W.insidePlayableEdge(p[0], p[1], 2)));
    const ref = W.mapToWorld(432, 408);
    check("M2.2 S1 at the red dot, yaw -0.11", Math.hypot(sp[0][0] - ref.x, sp[0][1] - ref.z) < 1 && Math.abs(sp[0][2] + 0.11) < 0.05);
    let minD = Infinity;
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) minD = Math.min(minD, Math.hypot(sp[i][0] - sp[j][0], sp[i][1] - sp[j][1]));
    check("M2.2 spawns >= 15 m apart", minD >= 15, minD);
    let badPick = 0;
    for (let i = 0; i < 200; i++) { const r = H.pickPvpSpawnPoint(H.players[i % H.players.length]); if (!W.isWalkable(r.x, r.z, 0.4) || !W.insidePlayableEdge(r.x, r.z, 0)) badPick++; }
    check("M2.2 pickPvpSpawnPoint results are walkable and inside", badPick === 0, badPick);
    // signs
    const roads = [[177.5, 98, "x"], [50, 411, "z"], [177.5, 535, "x"], [619, 411, "z"]];
    check("M2.3 4 road closures at the orange marks", W.closures.roads.length === 4 && roads.every(([px, py, ax]) => { const w = W.mapToWorld(px, py); return W.closures.roads.some((r) => Math.hypot(r.x - w.x, r.z - w.z) < 1.5 && r.axis === ax); }), JSON.stringify(W.closures.roads));
    const sws = [[120, 98], [240, 96], [54, 338], [52, 490], [118, 533], [238, 528], [604, 338], [608, 490]];
    check("M2.3 8 sidewalk closures at the purple marks", W.closures.sidewalks.length === 8 && sws.every(([px, py]) => { const w = W.mapToWorld(px, py); return W.closures.sidewalks.some((s) => Math.hypot(s.x - w.x, s.z - w.z) < 1.5); }), JSON.stringify(W.closures.sidewalks));
    // boundary
    let escaped = 0;
    const starts = [[sp[0][0], sp[0][1]], [0, 0]];
    for (const [x0, z0] of starts) for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2, body = { x: x0, y: 0, z: z0 };
      const pos = new THREE.Vector3(x0, 0, z0);
      for (let s = 0; s < 500; s++) {
        pos.x += Math.cos(a) * 0.3; pos.z += Math.sin(a) * 0.3;
        W.resolveCircle(pos, 0.35, 0, true);
      }
      if (!W.insidePlayableEdge(pos.x, pos.z, -0.6)) escaped++;
    }
    check("M2.4 no ray escapes the boundary", escaped === 0, escaped);
    let leaked = 0;
    for (const [dx, dz, cx, cz] of [[0, -1, 0, -61.82], [-1, 0, -25.18, 0], [0, 1, 0, 24.49], [1, 0, 87.2, 0]]) {
      const pos = new THREE.Vector3(cx - dx * 4, 0, cz - dz * 4);
      for (let s = 0; s < 67; s++) { pos.x += dx * 0.3; pos.z += dz * 0.3; W.resolveCircle(pos, 0.35, 0, true); }
      if (!W.insidePlayableEdge(pos.x, pos.z, -0.6)) leaked++;
    }
    check("M2.4 barricades hold on the road centrelines", leaked === 0, leaked);
    const a1 = W.mapToWorld(416, 300), a2 = W.mapToWorld(416, 190);
    check("M2.5 1108 blocks the lawn -> back yard line", W.segmentBlocked(a1.x, a1.z, a2.x, a2.z, 0, false, 1.6, 1.6));
    check("M2.5 4th Ave is open from S1 to the intersection", !W.segmentBlocked(sp[0][0], sp[0][1], 0, 0, 0, false, 1.6, 1.6));
    // fences + back alley (streeview2): solid wooden fences, alley passable west of the garage
    {
      const P = (px, py) => W.mapToWorld(px, py);
      // walk a circle from px point 1 toward px point 2 in ~0.3 m steps at the given feet height
      const walk = (px1, py1, px2, py2, feetY) => {
        const a = P(px1, py1), b = P(px2, py2), n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.3);
        const pos = new THREE.Vector3(a.x, feetY, a.z);
        for (let s = 0; s < n; s++) { pos.x += (b.x - a.x) / n; pos.z += (b.z - a.z) / n; W.resolveCircle(pos, 0.35, feetY, feetY === 0); }
        return Math.hypot(pos.x - b.x, pos.z - b.z) < 0.5;
      };
      const eyeBlocked = (p1, p2) => { const a = P(...p1), b = P(...p2); return W.segmentBlocked(a.x, a.z, b.x, b.z, 0, false, 0, 0); };
      check("M2.8a front fence of 1104 blocks walking in from the lawn", !walk(240, 210, 275, 210, 0));
      check("M2.8a ...and its north side", !walk(275, 150, 275, 175, 0));
      check("M2.8a ...and its south side", !walk(275, 275, 275, 240, 0));
      check("M2.8b fences cannot be jumped (apex 1.36 m < fence height)", !walk(240, 210, 275, 210, 1.36) && !walk(280, 110, 280, 85, 1.36));
      const r0 = P(240, 210), ray = W.raycast(r0.x, 1.6, r0.z, 1, 0, 0, 30);
      check("M2.8c fences block sight and shots at eye height", eyeBlocked([240, 210], [275, 210]) && ray && !ray.ground && ray.distance < 8, ray && ray.distance);
      check("M2.8d alley is passable west -> east", walk(246, 110, 400, 110, 0) && !eyeBlocked([246, 110], [400, 110]));
      check("M2.8d alley cells are walkable", [[250, 110], [300, 110], [350, 110], [398, 110]].every(([px, py]) => W.isWalkable(P(px, py).x, P(px, py).z, 0.4)));
      check("M2.8e dark fence closes the alley's north side", !walk(275, 112, 275, 90, 0) && !walk(390, 112, 390, 90, 0));
      check("M2.8f garage still blocks", !walk(315, 112, 315, 140, 0));
      check("M2.8g fences are on the minimap", W.minimapFootprints().filter((c) => c.fx === "wood" && c.height >= 1.4 && c.height <= 1.9).length >= 5);
    }
    H.zoneUi.layerKey = null; H.ensureZoneStaticLayer();
    check("M2.6 minimap layer keyed to map2 with >=12 footprints", /^map2/.test(H.zoneUi.layerKey) && W.minimapFootprints().length >= 12, H.zoneUi.layerKey + " " + W.minimapFootprints().length);
    H.resetGame();
    H.startPvpForTest(2, "deathmatch", "campus");
    check("M2.7 switching back restores campus", H.isCampusMap && H.currentWorld === H.campusWorld && H.campusWorld.root.visible && !W.root.visible);
    H.resetGame();
  }


  // ---- Map 2 storm (prefix M2S): full-size start, converges on the final circle in 5 min, then holds ----
  function runMap2Storm() {
    H.startPvpForTest(2, "deathmatch", "map2");
    const W = H.map2World, P = H.players, z = H.zoneState, f = W.pvpFinalZone;
    const fw = W.mapToWorld(462, 245);
    check("M2S.0 final circle = pink circle (px 462,245 r 78)", Math.hypot(f.x - fw.x, f.z - fw.z) < 0.01 && Math.abs(f.radius - 78 * W.constants.MAP2_M_PER_PX) < 0.01 && f.radius > 14 && f.radius < 17, JSON.stringify(f));
    check("M2S.1 match is 15 minutes on map2", H.PVP_MATCH_SECONDS === 900 && H.pvpMatch.timeLeft === 900, H.pvpMatch.timeLeft);
    let far = 0;
    for (const q of W.playablePolygon) far = Math.max(far, Math.hypot(q.x - z.center.x, q.z - z.center.z));
    check("M2S.2 starts full size around the whole boundary, no waves/warning", z.phase === "converge" && z.next === null && z.radius >= far && z.radius < far + 5, z.phase + " r=" + z.radius.toFixed(1) + " far=" + far.toFixed(1));
    check("M2S.2 every spawn point is safe at the start", W.pvpSpawnPoints.every((s) => Math.hypot(s[0] - z.center.x, s[1] - z.center.z) < z.radius));
    P.forEach((p) => H.pvpRespawnPlayer(p));
    check("M2S.3 clock started and spawns picked inside the circle", H.pvpMatch.started && P.every((p) => Math.hypot(p.camera.position.x - z.center.x, p.camera.position.z - z.center.z) < z.radius));
    P.forEach((p) => place(p, f.x, f.z, 0)); // park both inside the final circle so the storm never touches them in this test
    P.forEach((p) => { p.health = 100; });
    const r0 = z.radius, c0 = { x: z.center.x, z: z.center.z };
    let prev = { x: z.center.x, z: z.center.z, r: z.radius }, monotone = true, maxJump = 0, mid = null, label1 = "";
    const T = 5; // seconds per update
    for (let t = T; t <= 300; t += T) {
      H.updateZone(T);
      maxJump = Math.max(maxJump, Math.hypot(z.center.x - prev.x, z.center.z - prev.z), Math.abs(z.radius - prev.r));
      if (z.radius > prev.r + 1e-6) monotone = false;
      prev = { x: z.center.x, z: z.center.z, r: z.radius };
      if (t === 150) { mid = { x: z.center.x, z: z.center.z, r: z.radius }; label1 = H.zoneUi.label.textContent; }
    }
    check("M2S.4 shrinks monotonically and smoothly (small steps)", monotone && maxJump < 3, "maxStep=" + maxJump.toFixed(2));
    check("M2S.4 halfway it is halfway", mid && Math.abs(mid.r - (r0 + f.radius) / 2) < 1 && Math.abs(mid.x - (c0.x + f.x) / 2) < 1 && Math.abs(mid.z - (c0.z + f.z) / 2) < 1, JSON.stringify(mid));
    check("M2S.4 HUD says the storm is closing", /Storm closing/.test(label1), label1);
    check("M2S.5 after 5 minutes it is exactly the final circle and holds", Math.abs(z.radius - f.radius) < 1e-6 && Math.abs(z.center.x - f.x) < 1e-6 && Math.abs(z.center.z - f.z) < 1e-6 && z.phase === "stay", z.phase + " r=" + z.radius);
    H.updateZone(60); H.updateZone(60);
    check("M2S.5 still the final circle 2 minutes later", Math.abs(z.radius - f.radius) < 1e-6 && Math.abs(z.center.x - f.x) < 1e-6 && z.next === null && /Final circle/.test(H.zoneUi.label.textContent), z.radius);
    // damage outside the final circle works as usual; inside it does not
    const out = P[0], inn = P[1];
    place(out, f.x + f.radius + 30, f.z, 0);
    out.pvpProtectedFor = 0; inn.pvpProtectedFor = 0;
    const hp0 = out.health;
    for (let t = 0; t < 8; t += 0.5) H.updateZone(0.5);
    check("M2S.6 outside the final circle takes damage, inside does not", out.health < hp0 && inn.health === 100, out.health + "/" + inn.health);
    // respawn late in the match still lands inside the small circle
    let badSp = 0;
    for (let i = 0; i < 40; i++) { const s = H.pickPvpSpawnPoint(P[i % 2]); if (Math.hypot(s.x - f.x, s.z - f.z) > f.radius || !W.isWalkable(s.x, s.z, 0.4)) badSp++; }
    check("M2S.7 late respawns land inside the final circle", badSp === 0, badSp);
    H.resetGame();
    // campus keeps its own cycle
    H.startPvpForTest(2, "deathmatch", "campus");
    check("M2S.8 campus storm unchanged (60 s delay, stay phase, LARGE)", H.zoneState.phase === "stay" && H.zoneState.phaseDuration === 60 && H.zoneState.sizeName === "LARGE", H.zoneState.phase + "/" + H.zoneState.phaseDuration);
    H.resetGame();
  }

  // ---- Parked-car hitboxes (prefix CAR): walk + jump onto a car, stand on its roof, never clip ----
  function carRoofTest(label, W) {
    const P = H.players, p = P[0];
    const lowRoof = (r) => (r.roofY - r.bodyTop) <= W.stepUpHeight - 0.05;
    let car = null, start = null;
    for (const r of W.carRecords) {
      if (!lowRoof(r) || Math.abs(r.groundY) > 0.01) continue;
      const s = { x: r.x + r.fx * (r.halfL + 3), z: r.z + r.fz * (r.halfL + 3) };
      let clear = true;
      for (let d = 1.0; d <= 3.4 && clear; d += 0.3) clear = W.isWalkable(r.x + r.fx * (r.halfL + d), r.z + r.fz * (r.halfL + d), 0.45) && !W.carAt(r.x + r.fx * (r.halfL + d), r.z + r.fz * (r.halfL + d), 0.4);
      if (clear && W.insidePlayableEdge(s.x, s.z, 2)) { car = r; start = s; break; }
    }
    check("CAR " + label + " found a low-roof car with a clear approach", !!car, W.carRecords.length + " cars");
    if (!car) return;
    // the collider box matches the rendered car: centred, L x W, along the heading; the corners are solid, just outside is free
    const probe = (u, v, rad) => { const o = { x: car.x + u * car.fx - v * car.fz, z: car.z + u * car.fz + v * car.fx }; const before = { x: o.x, z: o.z }; W.resolveCircle(o, rad, 0, true); return Math.hypot(o.x - before.x, o.z - before.z); };
    check("CAR " + label + " footprint solid at the four corners, free 0.5 m outside", [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([a, b]) => probe(a * (car.halfL - 0.25), b * (car.halfW - 0.25), 0.1) > 0.05 && probe(a * (car.halfL + 0.5), b * (car.halfW + 0.5), 0.1) < 1e-6));
    check("CAR " + label + " support height: body top over the hood, roof over the cabin, ground beside", Math.abs(W.supportHeightAt(car.x + car.fx * (car.halfL - 0.3), car.z + car.fz * (car.halfL - 0.3), 0.1, 3) - car.bodyTop) < 0.01 && Math.abs(W.supportHeightAt(car.x, car.z, 0.1, 3) - car.roofY) < 0.01 && Math.abs(W.supportHeightAt(car.x - car.fz * (car.halfW + 0.6), car.z + car.fx * (car.halfW + 0.6), 0.1, 3) - car.groundY) < 0.01);
    // walk up to the nose, jump onto it, keep walking over the roof; track clipping
    place(P[1], W.spawn.x, W.spawn.z, 0);
    place(p, start.x, start.z, Math.atan2(car.fx, car.fz)); // faces -heading, i.e. the nose
    p.health = P[1].health = 100; p.pvpProtectedFor = P[1].pvpProtectedFor = 0;
    const real = p.input, fake = Object.create(real);
    let jumpQueued = false;
    fake.isActionHeld = (a) => a === "moveForward";
    fake.wasActionJustPressed = (a) => { if (a === "jump" && jumpQueued) { jumpQueued = false; return true; } return false; };
    p.input = fake;
    let roofFrames = 0, clip = 0, below = 0, popped = 0, minHeightOnCar = Infinity, prevX = start.x, prevZ = start.z, prevFeet = 0, jumps = 0;
    try {
      for (let i = 0; i < 30 * 8; i++) {
        const dx0 = p.camera.position.x - car.x, dz0 = p.camera.position.z - car.z;
        const u0 = dx0 * car.fx + dz0 * car.fz;
        if (p.isGrounded && p.campusGroundY < 0.05 && u0 > car.halfL - 0.5 && u0 < car.halfL + 1.1 && roofFrames < 5) { jumpQueued = true; jumps++; }
        H.updateCoopMatchFrame(DT);
        const x = p.camera.position.x, zz = p.camera.position.z, feet = p.campusGroundY + p.jumpOffset;
        const dx = x - car.x, dz = zz - car.z, u = dx * car.fx + dz * car.fz, v = -dx * car.fz + dz * car.fx;
        const onFootprint = Math.abs(u) < car.halfL - 0.02 && Math.abs(v) < car.halfW - 0.02;
        if (onFootprint) minHeightOnCar = Math.min(minHeightOnCar, feet);
        if (onFootprint && feet < car.bodyTop - 0.05) clip++;
        if (feet < car.groundY - 0.02) below++;
        if (Math.hypot(x - prevX, zz - prevZ) > 1 || Math.abs(feet - prevFeet) > 0.7) popped++;
        if (onFootprint && Math.abs(u) < car.halfL * 0.3 && Math.abs(v) < car.halfW * 0.4 && feet >= car.roofY - 0.06 && p.isGrounded) roofFrames++;
        prevX = x; prevZ = zz; prevFeet = feet;
      }
    } finally { p.input = real; }
    check("CAR " + label + " walk/jump reaches and stands on the roof (" + car.name + ")", roofFrames >= 5, "roofFrames=" + roofFrames + " jumps=" + jumps + " roofY=" + car.roofY.toFixed(2));
    check("CAR " + label + " no clipping into the car, no falling through, no popping", clip === 0 && below === 0 && popped === 0, "clip=" + clip + " below=" + below + " popped=" + popped + " minFeetOnCar=" + minHeightOnCar.toFixed(2));
  }

  function runCars() {
    H.startPvpForTest(2, "deathmatch", "map2");
    H.players.forEach((q) => H.pvpRespawnPlayer(q));
    carRoofTest("map2", H.map2World);
    H.resetGame();
    H.startPvpForTest(2, "deathmatch", "campus");
    H.players.forEach((q) => H.pvpRespawnPlayer(q));
    carRoofTest("campus", H.campusWorld);
    H.resetGame();
  }


  // ---- Porch steps, railings and the hollow houses 1108 / 1114 (prefix HS) ----
  function runHouses() {
    H.startPvpForTest(2, "deathmatch", "map2");
    H.players.forEach((q) => H.pvpRespawnPlayer(q));
    const W = H.map2World, P = H.players;
    const STEP = W.stepUpHeight, R = 0.35;
    // walk like the game does: resolveCircle for walls, then the support height (campusSupportHeight) for the feet
    function walkPath(from, to, feet0, grounded) {
      const dist = Math.hypot(to.x - from.x, to.z - from.z), n = Math.max(1, Math.ceil(dist / 0.15));
      const pos = new THREE.Vector3(from.x, feet0, from.z);
      let feet = feet0, maxJump = 0;
      for (let i = 0; i < n; i++) {
        pos.x += (to.x - from.x) / n; pos.z += (to.z - from.z) / n;
        W.resolveCircle(pos, R, feet, grounded);
        if (grounded) { const f = W.supportHeightAt(pos.x, pos.z, R, feet + STEP); maxJump = Math.max(maxJump, Math.abs(f - feet)); feet = f; }
      }
      return { x: pos.x, z: pos.z, feet, maxJump, arrived: Math.hypot(pos.x - to.x, pos.z - to.z) < 0.25 };
    }
    const doors = W.houses.filter((h) => h.door);
    check("HS.1 every porch house exposes its door record", doors.length >= 9, doors.length);

    // 1. steps: walkable stair heights, monotone climb, no popping, ends on the slab
    let stairFail = [], railFail = [], tested = 0;
    for (const h of doors) {
      const d = h.door, along = { x: Math.abs(d.nz), z: Math.abs(d.nx) };
      const at = (u, v) => ({ x: d.x + d.nx * u + along.x * v, z: d.z + d.nz * u + along.z * v }); // u out from the wall, v sideways
      const stepD = 0.32;
      const s2 = at(d.slabD + stepD * 1.5, 0), s1 = at(d.slabD + stepD * 0.5, 0), slab = at(d.slabD / 2, 0);
      const e2 = W.supportHeightAt(s2.x, s2.z, 0.05, 0.6), e1 = W.supportHeightAt(s1.x, s1.z, 0.05, 0.6), es = W.supportHeightAt(slab.x, slab.z, 0.05, 0.6);
      if (Math.abs(e2 - d.slabH / 3) > 0.02 || Math.abs(e1 - d.slabH * 2 / 3) > 0.02 || Math.abs(es - d.slabH) > 0.02) stairFail.push(h.name + " heights " + [e2, e1, es].map((v) => v.toFixed(2)));
      const start = at(d.slabD + stepD * 2 + 0.8, 0);
      if (!W.isWalkable(start.x, start.z, 0.4)) continue; // something (a fence, a car) in the way of this approach
      tested++;
      const r = walkPath(start, at(d.slabD / 2, 0), 0, true);
      if (!r.arrived || Math.abs(r.feet - d.slabH) > 0.02 || r.maxJump > 0.3) stairFail.push(h.name + " arrived=" + r.arrived + " feet=" + r.feet.toFixed(2) + " jump=" + r.maxJump.toFixed(2));
      // 2. railings: the slab side rails stop a sideways walk, shots hit them, sight passes, they are never a floor
      for (const k of [-1, 1]) {
        const rr = walkPath(at(d.slabD / 2, 0), at(d.slabD / 2, k * (d.slabW / 2 + 1.2)), d.slabH, true);
        const ray = W.raycast(at(d.slabD / 2, k * (d.slabW / 2 + 2)).x, d.slabH + 0.5, at(d.slabD / 2, k * (d.slabW / 2 + 2)).z, -along.x * k, 0, -along.z * k, 6);
        const o = at(d.slabD / 2, k * (d.slabW / 2 + 2)), i = at(d.slabD / 2, 0);
        const top = W.supportHeightAt(at(d.slabD / 2, k * (d.slabW / 2 - 0.05)).x, at(d.slabD / 2, k * (d.slabW / 2 - 0.05)).z, 0.02, 5);
        const rail = ray && ray.collider && ray.collider.noStand;
        if (rr.arrived || Math.abs((rr.x - i.x) * along.x + (rr.z - i.z) * along.z) > d.slabW / 2 - 0.05 || !rail || Math.abs(ray.distance - 1.95) > 0.2 || W.segmentBlocked(o.x, o.z, i.x, i.z, 0, false, d.slabH, d.slabH) || top > d.slabH + 0.02) {
          railFail.push(h.name + " k=" + k + " arrived=" + rr.arrived + " rail=" + !!rail + " d=" + (ray && ray.distance.toFixed(2)) + " top=" + top.toFixed(2));
        }
      }
    }
    check("HS.2 steps give stair support heights 1/3, 2/3, 1 of the slab and can be walked up without popping", stairFail.length === 0 && tested >= 8, tested + " tested; " + stairFail.join(" | "));
    check("HS.3 porch railings block walking and shots, not sight, and are never a floor", railFail.length === 0, railFail.join(" | "));

    // 3. hollow houses
    const hol = W.houses.filter((h) => h.hollow);
    check("HS.4 exactly 1108 and 1114 are hollow", hol.length === 2 && hol.map((h) => h.name).sort().join() === "1108,1114", hol.map((h) => h.name));
    for (const h of hol) {
      const d = h.door, n = { x: d.nx, z: d.nz }, along = { x: Math.abs(n.z), z: Math.abs(n.x) };
      const half = Math.abs(n.x) ? h.halfX : h.halfZ, halfAlong = Math.abs(n.x) ? h.halfZ : h.halfX;
      const at = (u, v) => ({ x: h.x + n.x * u + along.x * v, z: h.z + n.z * u + along.z * v }); // u toward the front, v sideways
      const L = "HS." + h.name + " ";
      const centre = at(0, 0), out = at(half + 4, 0);
      const wi = walkPath(out, centre, 0, true);
      check(L + "walk in through the open doorway to the middle, level on the floor (0.34)", wi.arrived && Math.abs(wi.feet - 0.34) < 0.02 && wi.maxJump < 0.3, JSON.stringify(wi));
      const wo = walkPath(centre, out, 0.34, true);
      check(L + "...and back out", wo.arrived && Math.abs(wo.feet) < 0.02, JSON.stringify(wo));
      check(L + "floor support 0.34 inside, doorway threshold 0.34", Math.abs(W.supportHeightAt(centre.x, centre.z, R, 0.84) - 0.34) < 0.01 && Math.abs(W.supportHeightAt(at(half - 0.15, 0).x, at(half - 0.15, 0).z, 0.05, 0.84) - 0.34) < 0.01);
      // walls: from inside toward each wall and the front wall away from the door; from outside into wall, window and back wall
      const inside = (r) => Math.abs((r.x - h.x) * n.x + (r.z - h.z) * n.z) < half - 0.2 && Math.abs((r.x - h.x) * along.x + (r.z - h.z) * along.z) < halfAlong - 0.2;
      const blocks = [at(0, halfAlong + 3), at(0, -halfAlong - 3), at(-half - 3, 0), at(half + 3, 3.2), at(half + 3, -3.2)].map((t) => walkPath(centre, t, 0.34, true));
      check(L + "walls block from inside (both sides, back, front wall beside the doorway)", blocks.every((r) => !r.arrived && inside(r)), blocks.map((r) => r.arrived + "/" + inside(r)).join(" "));
      const outs = [[at(-half - 4, 0), at(0, 0)], [at(half + 4, 4), at(0, 4)], [at(0, halfAlong + 4), at(0, 0)], [at(half + 4, -4), at(0, -4)]].map(([a, b]) => walkPath(a, b, 0, true));
      check(L + "walls block from outside (back, front beside the door, both sides)", outs.every((r) => !r.arrived && !inside(r)), outs.map((r) => r.arrived + "/" + inside(r)).join(" "));
      const jump = walkPath(at(half + 1.5, 0), at(half - 1.5, 0), 1.2, false); // airborne through the doorway: the lintel stops it
      check(L + "a jump cannot go through the doorway (lintel)", !jump.arrived || Math.abs((jump.x - h.x) * n.x + (jump.z - h.z) * n.z) > half - 0.2, JSON.stringify(jump));
      const head = { x: centre.x, y: 1.7, z: centre.z };
      const hb = new THREE.Vector3(centre.x, 1.7, centre.z); W.resolveCircle(hb, R, 1.7, false);
      check(L + "no head-bump push-out under the roof at a jump apex", Math.hypot(hb.x - head.x, hb.z - head.z) < 1e-6);
      // sight and shots
      const door = at(half + 6, 0), side = at(half + 6, 5), back = at(-half - 6, 0);
      const sb = (a, b) => W.segmentBlocked(a.x, a.z, b.x, b.z, 0, false, 0.34, 0.34);
      check(L + "sight: out through the doorway is open, through the front wall / back wall is blocked", !sb(centre, door) && sb(centre, side) && sb(centre, back) && sb(door, back));
      const shot = (o, dir, y, dy) => W.raycast(o.x, y, o.z, dir.x, dy || 0, dir.z, 40);
      const rDoor = shot(centre, { x: n.x, z: n.z }, 1.7), rBack = shot(centre, { x: -n.x, z: -n.z }, 1.7), rSide = shot(centre, { x: along.x, z: along.z }, 1.7);
      check(L + "shots: out the doorway fly free (>14 m), back/side walls stop them at the wall", (!rDoor || rDoor.distance > 14) && rBack && Math.abs(rBack.distance - (half - 0.3)) < 0.2 && rSide && Math.abs(rSide.distance - (halfAlong - 0.3)) < 0.2, [rDoor && rDoor.distance, rBack && rBack.distance, rSide && rSide.distance].join("/"));
      const rUp = shot(centre, { x: 0, z: 0 }, 1.7, 1), rTop = W.raycast(centre.x, h.height + 5, centre.z, 0, -1, 0, 30);
      check(L + "shots: the ceiling/roof is solid from inside and from above", rUp && rUp.collider && rUp.collider.ceiling && Math.abs(rUp.y - 3.2) < 0.05 && rTop && !rTop.ground && Math.abs(rTop.y - h.height) < 0.05, (rUp && rUp.y) + "/" + (rTop && rTop.y));
      const lintelShot = shot(at(half + 2, 0), { x: -n.x, z: -n.z }, 2.5);
      check(L + "shots at lintel height hit it; at head height they pass the doorway", lintelShot && Math.abs(lintelShot.distance - 2) < 0.2 && !!shot(at(half + 2, 0), { x: -n.x, z: -n.z }, 1.7) && shot(at(half + 2, 0), { x: -n.x, z: -n.z }, 1.7).distance > 3);
      // minimap: wall ring with the doorway gap, nothing across the interior
      const feet = W.minimapFootprints().filter((c) => c.style === "house" && Math.abs(c.cx - h.x) < Math.max(half, halfAlong) + 1 && Math.abs(c.cz - h.z) < Math.max(half, halfAlong) + 1);
      const covers = (pt) => feet.some((c) => Math.abs(pt.x - c.cx) <= c.halfX && Math.abs(pt.z - c.cz) <= c.halfZ);
      check(L + "minimap: wall ring with an open doorway and an empty middle", feet.length >= 4 && !covers(centre) && !covers(at(half - 0.15, 0)) && covers(at(-half + 0.15, 0)) && covers(at(half - 0.15, 3)), feet.length);
      check(L + "interior is walkable at spawn clearance", W.isWalkable(centre.x, centre.z, 0.8));
    }
    // other houses stay solid boxes
    const solids = W.houses.filter((h) => !h.hollow);
    check("HS.5 every other house is still a solid block (middle not walkable, minimap fills it)", solids.every((h) => !W.isWalkable(h.x, h.z, 0.4) && W.minimapFootprints().some((c) => Math.abs(c.cx - h.x) <= c.halfX && Math.abs(c.cz - h.z) <= c.halfZ)), solids.length);
    check("HS.6 fixed spawns stay valid and outside the hollow houses", W.pvpSpawnPoints.every((s) => W.isWalkable(s[0], s[1], 0.8) && hol.every((h) => Math.abs(s[0] - h.x) > h.halfX + 0.5 || Math.abs(s[1] - h.z) > h.halfZ + 0.5)));

    // 4. real game loop: a player walks forward up the steps and through the 1108 doorway, never clips
    const h = hol[0], d = h.door, n = { x: d.nx, z: d.nz };
    const p = P[0];
    place(P[1], W.spawn.x, W.spawn.z, 0);
    const halfF = Math.abs(n.x) ? h.halfX : h.halfZ, startPos = { x: h.x + n.x * (halfF + 5), z: h.z + n.z * (halfF + 5) };
    place(p, startPos.x, startPos.z, Math.atan2(n.x, n.z));
    p.health = P[1].health = 100; p.pvpProtectedFor = P[1].pvpProtectedFor = 0;
    const real = p.input, fake = Object.create(real);
    fake.isActionHeld = (a) => a === "moveForward";
    fake.wasActionJustPressed = () => false;
    p.input = fake;
    let popped = 0, below = 0, prevFeet = 0, prevX = startPos.x, prevZ = startPos.z, reachedFeet = 0, insideFrames = 0;
    try {
      for (let i = 0; i < 30 * 4; i++) {
        H.updateCoopMatchFrame(DT);
        const x = p.camera.position.x, zz = p.camera.position.z, feet = p.campusGroundY + p.jumpOffset;
        if (Math.hypot(x - prevX, zz - prevZ) > 0.6 || Math.abs(feet - prevFeet) > 0.3) popped++;
        if (feet < -0.02) below++;
        const u = (x - h.x) * n.x + (zz - h.z) * n.z, v = (x - h.x) * Math.abs(n.z) + (zz - h.z) * Math.abs(n.x);
        if (u < halfF - 0.5 && Math.abs(v) < 1) { insideFrames++; reachedFeet = feet; }
        prevX = x; prevZ = zz; prevFeet = feet;
      }
    } finally { p.input = real; }
    check("HS.7 game loop: walking forward up the stoop steps and through the doorway of " + h.name, insideFrames >= 10 && Math.abs(reachedFeet - 0.34) < 0.03 && popped === 0 && below === 0, "inside=" + insideFrames + " feet=" + reachedFeet.toFixed(2) + " popped=" + popped + " below=" + below);
    H.resetGame();
  }

  try { run(); runMap2(); runMap2Storm(); runCars(); runHouses(); } catch (e) { check("exception", false, e && e.stack || e); }
  const pass = checks.every((c) => c.ok);
  window.__perfResults = JSON.stringify({ pass, checks });
})();

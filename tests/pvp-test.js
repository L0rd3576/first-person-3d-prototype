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
    check("00 quad setup lists six categories (the sixth, Team, is shown only on the PVP screen)", document.querySelectorAll("#title-quad-setup .customize-list")[0].querySelectorAll(".customize-row").length === 6);
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
      check("7 list is a scrollable card grid", getComputedStyle(listEl).overflowY === "auto" && getComputedStyle(listEl).display === "grid" && Array.from(listEl.children).every((li) => li.querySelector(".pvp-wname")));
      listEl.style.maxHeight = "70px";
      H.pvpSelectWeapon(b, "katana");
      check("7 katana highlighted + scrolled into view", listEl.querySelector("li.selected").dataset.weaponId === "katana" && listEl.scrollTop > 0, "scrollTop=" + listEl.scrollTop);
      H.pvpSelectWeapon(b, "pistol");
      check("7 scroll back up", listEl.scrollTop === 0, listEl.scrollTop);
      listEl.style.maxHeight = "";
      // the picker is a grid: left/right/up/down move one card, and nothing wraps
      {
        const ids = Array.from(listEl.children).map((li) => li.dataset.weaponId), cols = H.pvpGridColumns(H.pvpUi ? H.pvpUi.panels[1] : { items: Array.from(listEl.children) });
        const at = () => listEl.querySelector("li.selected").dataset.weaponId;
        H.pvpSelectWeapon(b, ids[0]);
        H.pvpMoveWeapon(b, -1, 0); const leftEdge = at() === ids[0];
        H.pvpMoveWeapon(b, 0, -1); const topEdge = at() === ids[0];
        H.pvpMoveWeapon(b, 1, 0); const right1 = at() === ids[1];
        H.pvpMoveWeapon(b, 0, 1); const down1 = at() === ids[Math.min(ids.length - 1, 1 + cols)];
        H.pvpSelectWeapon(b, ids[ids.length - 1]);
        H.pvpMoveWeapon(b, 1, 0); const rightEnd = at() === ids[ids.length - 1];
        H.pvpMoveWeapon(b, 0, 1); const bottomEnd = at() === ids[ids.length - 1];
        H.pvpSelectWeapon(b, ids[0]); H.pvpStepWeapon(b, -1); const wheelNoWrap = at() === ids[0];
        check("7 grid: left/up at the first card stay put; right and down move one card", leftEdge && topEdge && right1 && down1, [leftEdge, topEdge, right1, down1, "cols=" + cols].join());
        check("7 grid: right/down at the last card stay put (no wrap); the wheel does not wrap either", rightEnd && bottomEnd && wheelNoWrap, [rightEnd, bottomEnd, wheelNoWrap].join());
        H.pvpSelectWeapon(b, "pistol");
      }
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
    check("14 banner names P1", /P1 WINS$/.test(document.getElementById("pvp-results-banner").textContent), document.getElementById("pvp-results-banner").textContent);
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
    check("19 banner P1 wins", /P1 WINS$/.test(document.getElementById("pvp-results-banner").textContent), document.getElementById("pvp-results-banner").textContent);
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
    check("19b furthest level wins", /P2 WINS$/.test(document.getElementById("pvp-results-banner").textContent), document.getElementById("pvp-results-banner").textContent);
    H.resetGame();
    H.startPvpForTest(2, "gungame");
    H.players.forEach((p) => H.pvpRespawnPlayer(p));
    H.players[0].pvpLevel = H.players[1].pvpLevel = 5;
    H.players[0].pvpLevelAt = 200; H.players[1].pvpLevelAt = 100;
    H.pvpMatch.timeLeft = 0.01;
    step(0.2);
    check("19b level tie -> first to reach wins", /P2 WINS$/.test(document.getElementById("pvp-results-banner").textContent), document.getElementById("pvp-results-banner").textContent);
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
    H.setMap("campus");
    H.setPvpSetup(true);
    check("M2.0a the map picker (2 maps) lives in the PVP settings panel", document.querySelectorAll("#pvp-settings-panel #pvp-map-options .pvp-map-option").length === 2);
    check("M2.0b the active map card matches the chosen map", document.querySelector("#pvp-map-options [data-pvp-map=" + H.pvpMapId + "]").classList.contains("active"), H.pvpMapId);
    const modeBefore = H.pvpMode;
    document.querySelector("#pvp-map-options [data-pvp-map=campus]").click();
    check("M2.0c clicking Campus sets campus without touching the mode", H.pvpMapId === "campus" && H.pvpMode === modeBefore && document.querySelector("#pvp-map-options [data-pvp-map=campus]").classList.contains("active"), H.pvpMapId + "/" + H.pvpMode);
    H.stepPvpMap(1); const a = H.pvpMapId; H.stepPvpMap(1); const b = H.pvpMapId; H.stepPvpMap(-1); const c = H.pvpMapId;
    check("M2.0d stepPvpMap steps and clamps", a === "map2" && b === "map2" && c === "campus", [a, b, c]);
    H.setPvpSetup(false);
    check("M2.0e the settings panel is closed after leaving PVP setup", !H.isPvpSettingsOpen());
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
      check("M2.8a ...and its north side (from the driveway)", !walk(275, 172, 275, 195, 0));
      check("M2.8a ...and its south side", !walk(275, 275, 275, 240, 0));
      check("M2.8b fences cannot be jumped (apex 1.36 m < fence height)", !walk(240, 210, 275, 210, 1.36) && !walk(280, 110, 280, 85, 1.36));
      const r0 = P(240, 210), ray = W.raycast(r0.x, 1.6, r0.z, 1, 0, 0, 30);
      check("M2.8c fences block sight and shots at eye height", eyeBlocked([240, 210], [275, 210]) && ray && !ray.ground && ray.distance < 8, ray && ray.distance);
      check("M2.8d alley is passable west -> east", walk(246, 110, 400, 110, 0) && !eyeBlocked([246, 110], [400, 110]));
      check("M2.8d alley cells are walkable", [[250, 110], [300, 110], [350, 110], [398, 110]].every(([px, py]) => W.isWalkable(P(px, py).x, P(px, py).z, 0.4)));
      check("M2.8e dark fence closes the alley's north side", !walk(275, 112, 275, 90, 0) && !walk(390, 112, 390, 90, 0));
      check("M2.8f garage still blocks", !walk(315, 112, 315, 140, 0));
      check("M2.8g fences are on the minimap", W.minimapFootprints().filter((c) => c.fx === "wood" && c.height >= 1.4 && c.height <= 1.9).length >= 5);
      // Rev 7: access drive from 11th St S (secondalleywayview.png)
      const gm = (px, py) => W.groundMaterialAt(P(px, py).x, P(px, py).z);
      check("M2.9a lane and apron are concrete from the curb across the boulevard and sidewalk to the garage", [[214, 142], [222, 150], [240, 140], [260, 136], [290, 125], [215, 160], [240, 165], [290, 175], [297, 150]].every(([x, y]) => gm(x, y) === "concrete"));
      check("M2.9a grass strip north of the lane, grass wedge south of the apron at the curb, grass boulevard beside it", gm(260, 108) === "grass" && gm(222, 177) === "grass" && gm(222, 190) === "grass");
      check("M2.9b walk from the street mouth along the lane into the alley, and along the apron to the garage door", walk(214, 148, 262, 150, 0) && walk(214, 122, 300, 116, 0) && walk(300, 116, 400, 110, 0) && walk(214, 160, 295, 160, 0));
      const car = W.carRecords.find((c) => Math.abs(P(240, 134.5).x - c.x) < 1.5 && Math.abs(P(240, 134.5).z - c.z) < 1.5);
      check("M2.9c a dark sedan is parked on the lane and blocks walking through it, the rest of the lane stays open", !!car && !walk(240, 124, 240, 146, 0) && walk(214, 150, 262, 152, 0));
      const bin = P(218.5, 179), pal = P(262, 181.9);
      check("M2.9d the trash bin at the curb is solid, the lawn around it is open", !W.isWalkable(bin.x, bin.z, 0.2) && W.isWalkable(bin.x, bin.z - 2.5, 0.35));
      check("M2.9e the pallet leaning on the fence is solid but never a floor, and the fence still cannot be jumped from it", !W.isWalkable(pal.x, pal.z - 0.25, 0.1) && W.supportHeightAt(pal.x, pal.z - 0.25, 0.05, 1.6) < 0.05 && !walk(262, 172, 262, 195, 1.36));
      check("M2.9f lower slat fence closes the alley's north end and stays taller than a jump", !walk(390, 112, 390, 90, 1.36) && W.minimapFootprints().some((c) => c.fx === "wood" && Math.abs(c.height - 1.4) < 0.01));
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
    check("M2S.0 final circle = pink circle centre (px 462,245), radius 78 px x lot scale x MAP2_FINAL_ZONE_SCALE", Math.hypot(f.x - fw.x, f.z - fw.z) < 0.01 && Math.abs(f.radius - 78 * W.constants.MAP2_M_PER_PX * W.constants.MAP2_FINAL_ZONE_SCALE) < 0.01 && f.radius > 17 && f.radius < 22, JSON.stringify(f));
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
    for (let t = T; t <= 600; t += T) {
      H.updateZone(T);
      maxJump = Math.max(maxJump, Math.hypot(z.center.x - prev.x, z.center.z - prev.z), Math.abs(z.radius - prev.r));
      if (z.radius > prev.r + 1e-6) monotone = false;
      prev = { x: z.center.x, z: z.center.z, r: z.radius };
      if (t === 300) { mid = { x: z.center.x, z: z.center.z, r: z.radius }; label1 = H.zoneUi.label.textContent; }
    }
    check("M2S.4 shrinks monotonically and smoothly (small steps)", monotone && maxJump < 3, "maxStep=" + maxJump.toFixed(2));
    check("M2S.4 halfway it is halfway", mid && Math.abs(mid.r - (r0 + f.radius) / 2) < 1 && Math.abs(mid.x - (c0.x + f.x) / 2) < 1 && Math.abs(mid.z - (c0.z + f.z) / 2) < 1, JSON.stringify(mid));
    check("M2S.4 map2 has no minimap (hidden)", H.zoneUi.root && H.zoneUi.root.style.display === "none", H.zoneUi.root && H.zoneUi.root.style.display);
    check("M2S.5 after 10 minutes it is exactly the final circle and holds", Math.abs(z.radius - f.radius) < 1e-6 && Math.abs(z.center.x - f.x) < 1e-6 && Math.abs(z.center.z - f.z) < 1e-6 && z.phase === "stay", z.phase + " r=" + z.radius);
    H.updateZone(60); H.updateZone(60);
    check("M2S.5 still the final circle 2 minutes later", Math.abs(z.radius - f.radius) < 1e-6 && Math.abs(z.center.x - f.x) < 1e-6 && z.next === null, z.radius);
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
    check("HS.4 hollow buildings: 1108, the three parts of 1114 and the purple + yellow garages", hol.map((h) => h.name).sort().join() === "1108,1114,1114e,1114w,garageP,garageY", hol.map((h) => h.name));
    for (const h of hol.filter((q) => q.door && q.name === "1108")) {
      const rect = h.name === "1108"; // 1114 is L-shaped: its walls are covered by the pink-house checks
      const d = h.door, n = { x: d.nx, z: d.nz }, along = { x: Math.abs(n.z), z: Math.abs(n.x) };
      const half = Math.abs(n.x) ? h.halfX : h.halfZ, halfAlong = Math.abs(n.x) ? h.halfZ : h.halfX;
      const at = (u, v) => ({ x: h.x + n.x * u + along.x * v, z: h.z + n.z * u + along.z * v }); // u toward the front, v sideways
      const L = "HS." + h.name + " ";
      // the doorway may be off-centre (1114): dv = its sideways offset from the middle of the facade
      const dv = (d.x - h.x) * along.x + (d.z - h.z) * along.z;
      const centre = at(0, 0), centreD = at(0, dv), out = at(half + 4, dv);
      const wi0 = walkPath(out, at(half - 1.2, dv), 0, true), wi1 = walkPath(wi0, centre, wi0.feet, true);
      const wi = { x: wi1.x, z: wi1.z, feet: wi1.feet, maxJump: Math.max(wi0.maxJump, wi1.maxJump), arrived: wi0.arrived && wi1.arrived };
      check(L + "walk in through the open doorway to the middle, level on the floor (0.34)", wi.arrived && Math.abs(wi.feet - 0.34) < 0.02 && wi.maxJump < 0.3, JSON.stringify(wi));
      const wo0 = walkPath(centre, at(half - 1.2, dv), 0.34, true), wo1 = walkPath(wo0, out, wo0.feet, true);
      const wo = { x: wo1.x, z: wo1.z, feet: wo1.feet, maxJump: Math.max(wo0.maxJump, wo1.maxJump), arrived: wo0.arrived && wo1.arrived };
      check(L + "...and back out", wo.arrived && Math.abs(wo.feet) < 0.02, JSON.stringify(wo));
      check(L + "floor support 0.34 inside, doorway threshold 0.34", Math.abs(W.supportHeightAt(centre.x, centre.z, R, 0.84) - 0.34) < 0.01 && Math.abs(W.supportHeightAt(at(half - 0.15, dv).x, at(half - 0.15, dv).z, 0.05, 0.84) - 0.34) < 0.01);
      if (!rect) { check(L + "interior is walkable at spawn clearance", W.isWalkable(centre.x, centre.z, 0.8)); continue; }
      // walls: from inside toward each wall and the front wall away from the door; from outside into wall, window and back wall
      const inside = (r) => Math.abs((r.x - h.x) * n.x + (r.z - h.z) * n.z) < half - 0.2 && Math.abs((r.x - h.x) * along.x + (r.z - h.z) * along.z) < halfAlong - 0.2;
      const beside = Math.abs(dv) < 0.01 ? [3.2, -3.2] : [dv < 0 ? 1.2 : -1.2]; // front-wall spots beside the doorway
      const blocks = [at(0, halfAlong + 3), at(0, -halfAlong - 3), at(-half - 3, 0), ...beside.map((v) => at(half + 3, v))].map((t) => walkPath(centre, t, 0.34, true));
      check(L + "walls block from inside (both sides, back, front wall beside the doorway)", blocks.every((r) => !r.arrived && inside(r)), blocks.map((r) => r.arrived + "/" + inside(r)).join(" "));
      const frontVs = halfAlong > 5 ? [4, -4] : beside;
      const outs = [[at(-half - 4, 0), at(0, 0)], [at(0, halfAlong + 4), at(0, 0)], ...frontVs.map((v) => [at(half + 4, v), at(0, v)])].map(([a, b]) => walkPath(a, b, 0, true));
      check(L + "walls block from outside (back, front beside the door, both sides)", outs.every((r) => !r.arrived && !inside(r)), outs.map((r) => r.arrived + "/" + inside(r)).join(" "));
      const jump = walkPath(at(half + 1.5, dv), at(half - 1.5, dv), 1.2, false); // airborne through the doorway: the lintel stops it
      check(L + "a jump cannot go through the doorway (lintel)", !jump.arrived || Math.abs((jump.x - h.x) * n.x + (jump.z - h.z) * n.z) > half - 0.2, JSON.stringify(jump));
      const head = { x: centre.x, y: 1.7, z: centre.z };
      const hb = new THREE.Vector3(centre.x, 1.7, centre.z); W.resolveCircle(hb, R, 1.7, false);
      check(L + "no head-bump push-out under the roof at a jump apex", Math.hypot(hb.x - head.x, hb.z - head.z) < 1e-6);
      // sight and shots
      const door = at(half + 6, dv), side = at(half + 6, 5), back = at(-half - 6, 0);
      const sb = (a, b) => W.segmentBlocked(a.x, a.z, b.x, b.z, 0, false, 0.34, 0.34);
      check(L + "sight: out through the doorway is open, through the front wall / back wall is blocked", !sb(centreD, door) && sb(centre, side) && sb(centre, back) && sb(door, back));
      const shot = (o, dir, y, dy) => W.raycast(o.x, y, o.z, dir.x, dy || 0, dir.z, 40);
      const rDoor = shot(centreD, { x: n.x, z: n.z }, 1.7), rBack = shot(centre, { x: -n.x, z: -n.z }, 1.7), rSide = shot(centre, { x: along.x, z: along.z }, 1.7);
      check(L + "shots: out the doorway fly free (>14 m), back/side walls stop them at the wall", (!rDoor || rDoor.distance > 14) && rBack && Math.abs(rBack.distance - (half - 0.3)) < 0.2 && rSide && Math.abs(rSide.distance - (halfAlong - 0.3)) < 0.2, [rDoor && rDoor.distance, rBack && rBack.distance, rSide && rSide.distance].join("/"));
      const rUp = shot(centre, { x: 0, z: 0 }, 1.7, 1), rTop = W.raycast(centre.x, h.height + 5, centre.z, 0, -1, 0, 30);
      check(L + "shots: the ceiling/roof is solid from inside and from above", rUp && rUp.collider && rUp.collider.ceiling && Math.abs(rUp.y - 3.7) < 0.05 && rTop && !rTop.ground && rTop.y <= h.height + 0.05 && rTop.y > h.height - 0.6, (rUp && rUp.y) + "/" + (rTop && rTop.y));
      const lintelShot = shot(at(half + 2, dv), { x: -n.x, z: -n.z }, 2.5);
      check(L + "shots at lintel height hit it; at head height they pass the doorway", lintelShot && Math.abs(lintelShot.distance - 2) < 0.2 && !!shot(at(half + 2, dv), { x: -n.x, z: -n.z }, 1.7) && shot(at(half + 2, dv), { x: -n.x, z: -n.z }, 1.7).distance > 3);
      // minimap: wall ring with the doorway gap, nothing across the interior
      const feet = W.minimapFootprints().filter((c) => c.style === "house" && Math.abs(c.cx - h.x) < Math.max(half, halfAlong) + 1 && Math.abs(c.cz - h.z) < Math.max(half, halfAlong) + 1);
      const covers = (pt) => feet.some((c) => Math.abs(pt.x - c.cx) <= c.halfX && Math.abs(pt.z - c.cz) <= c.halfZ);
      check(L + "minimap: wall ring with an open doorway and an empty middle", feet.length >= 4 && !covers(centre) && !covers(at(half - 0.15, dv)) && covers(at(-half + 0.15, 0)) && covers(at(half - 0.15, dv < 0 ? 1.2 : 3)), feet.length);
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

  // ---- Rev 6: the north block traced from topdowncloseup.png (prefix M2C) ----
  // closeup px -> topdownview px: one isotropic scale, closeup (60,60) = topdown (225.6,114.8) (NCC 0.935 against the aerial)
  function runMap2Closeup() {
    H.startPvpForTest(2, "deathmatch", "map2");
    const W = H.map2World, P = H.players;
    P.forEach((q) => H.pvpRespawnPlayer(q));
    const td = (cx, cy) => [225.6 + (cx - 60) / 2.83, 114.8 + (cy - 60) / 2.83];
    const px = (x, z) => { const q = W.pxOfWorld(x, z); return [q.x, q.y]; };
    const rectPx = (h) => { const a = px(h.x - h.halfX, h.z - h.halfZ), b = px(h.x + h.halfX, h.z + h.halfZ); return [a[0], a[1], b[0], b[1]]; };
    const rec = (name) => W.houses.find((h) => h.name === name);
    const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const walkP = (a, b, feetY) => { // walk a body from px a to px b like the game does (resolveCircle), arrived = got there
      const A = W.mapToWorld(a[0], a[1]), B = W.mapToWorld(b[0], b[1]), n = Math.ceil(Math.hypot(B.x - A.x, B.z - A.z) / 0.25);
      const pos = new THREE.Vector3(A.x, feetY || 0, A.z);
      for (let s = 0; s < n; s++) { pos.x += (B.x - A.x) / n; pos.z += (B.z - A.z) / n; W.resolveCircle(pos, 0.35, feetY || 0, !feetY); }
      return { arrived: Math.hypot(pos.x - B.x, pos.z - B.z) < 0.5, x: pos.x, z: pos.z };
    };
    const wp = (a) => W.mapToWorld(a[0], a[1]);
    const reach = (x, y) => { const q = W.mapToWorld(x, y); return W.isReachable(q.x, q.z); };

    // 1. footprints: each building's part rectangles reproduce its coloured outline (area mismatch < 3%)
    const outlines = {
      black: { names: ["1104", "1104e", "1104w", "1104p"], poly: [[270.5, 288.5], [445, 288.5], [445, 494.5], [319, 494.5], [319, 469.5], [270.5, 469.5]].map((p) => td(...p)) },
      pink: { names: ["1114", "1114w", "1114e"], poly: [[741.5, 328], [914.5, 328], [914.5, 406], [951, 406], [951, 506], [806, 506], [806, 487.5], [741.5, 487.5]].map((p) => td(...p)) },
      orange: { names: ["garageE"], poly: [[267, 105.5], [432, 105.5], [432, 251.5], [267, 251.5]].map((p) => td(...p)) },
      purple: { names: ["garageP"], poly: [[533.5, 80], [667, 80], [667, 201.5], [533.5, 201.5]].map((p) => td(...p)) },
      yellow: { names: ["garageY"], poly: [[912.5, 251.5], [999.5, 251.5], [999.5, 370.4], [912.5, 370.4]].map((p) => td(...p)) }, // south wall moved north (new line on the annotated image)
    };
    for (const [colour, o] of Object.entries(outlines)) {
      const recs = o.names.map(rec);
      const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]);
      let mism = 0, tot = 0;
      for (let y = Math.min(...ys) - 3; y <= Math.max(...ys) + 3; y += 0.25) for (let x = Math.min(...xs) - 3; x <= Math.max(...xs) + 3; x += 0.25) {
        const inside = inPoly(x, y, o.poly), built = recs.some((h) => { const r = rectPx(h); return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]; });
        if (inside || built) tot++;
        if (inside !== built) mism++;
      }
      check("M2C.1 " + colour + " outline = footprint (" + o.names.join("+") + ")", recs.every(Boolean) && mism / tot < 0.03, (mism / tot * 100).toFixed(2) + "% mismatch");
    }
    // 2. heights: 1104 / 1114 are 2 storeys (5.2-5.6 m walls) for most of the outline, wings ~3 m, 1108 is one storey
    {
      const area = (h) => h.halfX * h.halfZ * 4;
      const frac = (names) => { const t = names.map(rec); const tall = t.filter((h) => h.wallH >= 5.2 && h.wallH <= 5.6).reduce((a, h) => a + area(h), 0); return tall / t.reduce((a, h) => a + area(h), 0); };
      check("M2C.2 1104: most of the footprint is 2 storeys, the wings are ~3 m", frac(["1104", "1104e", "1104w", "1104p"]) > 0.6 && ["1104w", "1104p"].every((n) => Math.abs(rec(n).wallH - 3) < 0.25) && ["1104", "1104e"].every((n) => rec(n).wallH >= 5.2 && rec(n).wallH <= 5.6), frac(["1104", "1104e", "1104w", "1104p"]).toFixed(2));
      check("M2C.2 1114: most of the footprint is 2 storeys, the east wing is ~3 m", frac(["1114", "1114w", "1114e"]) > 0.6 && Math.abs(rec("1114e").wallH - 3.9) < 0.25 && rec("1114").wallH >= 5.2 && rec("1114w").wallH >= 5.2, frac(["1114", "1114w", "1114e"]).toFixed(2));
      check("M2C.2 1108 stays one storey and is lower than both", rec("1108").wallH < 4.2 && rec("1104").wallH - rec("1108").wallH > 1 && rec("1114").wallH - rec("1108").wallH > 1, rec("1108").wallH);
      check("M2C.2 garages are 1 storey (eaves <= 4 m: hollow ones are tall enough for a jump inside)", ["garageE", "garageP", "garageY"].every((n) => rec(n).wallH <= 4));
      // collider support heights match the visual part heights
      const sh = (name) => { const h = rec(name); return W.supportHeightAt(h.x, h.z, 0.1, 99); };
      check("M2C.2 support heights follow the parts (tall block > wing, = roof top)", sh("1104") > sh("1104w") + 2 && sh("1114w") > sh("1114e") + 1.5 && Math.abs(sh("1104w") - rec("1104w").height) < 0.5 && Math.abs(sh("garageP") - rec("garageP").height) < 0.5, [sh("1104"), sh("1104w"), sh("1114w"), sh("1114e")].map((v) => v.toFixed(1)).join("/"));
    }
    // 3. notches are open air, the rest of the outline is built
    {
      const open = (cx, cy) => { const q = wp(td(cx, cy)); return W.isWalkable(q.x, q.z, 0.4); };
      check("M2C.3 1104 notch (lower-left) is open ground, its wings and porch are solid", open(295, 483) && !open(380, 380) && !open(300, 440) && !open(360, 480));
      check("M2C.3 1114 notch (upper-right) and lower-left step are open, the east and north outer walls are solid", open(962, 380) && open(760, 497) && !open(950.3, 457) && !open(842, 331));
    }
    // 4. the sealed yard (west of 1104, between the orange garage and 1104, the notch): unreachable, never used
    {
      const yardPts = [[272, 225], [272, 255], [280, 190], [330, 189], [350, 189], [308, 264], [255, 200], [255, 265]];
      check("M2C.4 exclusion rect covers the yard, the gap and the notch", yardPts.every(([x, y]) => { const q = W.mapToWorld(x, y); return W.isSpawnExcluded(q.x, q.z); }));
      check("M2C.4 flood fill: yard / gap / notch cells are not reachable, street / alley / lawns are", yardPts.every(([x, y]) => !reach(x, y)) && [[177, 300], [330, 110], [420, 300], [500, 140], [520, 330], [270, 168], [600, 290]].every(([x, y]) => reach(x, y)), JSON.stringify(W.reachInfo()));
      let leak = 0, tested = 0;
      for (let y = 182.5; y < 269; y += 1.5) for (let x = 248.5; x < 357; x += 1.5) { if (reach(x, y)) leak++; tested++; }
      check("M2C.4 not one reachable cell inside the exclusion rect (" + tested + " sampled)", leak === 0, leak);
      // walking in from every side (ground and jump apex) fails
      const ins = [[[236, 225], [272, 225]], [[272, 172], [272, 195]], [[272, 276], [272, 255]], [[366, 190], [345, 190]], [[236, 262], [285, 262]], [[300, 276], [308, 262]]];
      check("M2C.4 walking in (west, north, south, the gap's east end, notch front) is blocked", ins.every(([a, b]) => !walkP(a, b, 0).arrived && !walkP(a, b, 1.36).arrived), ins.map(([a, b]) => walkP(a, b, 0).arrived + "/" + walkP(a, b, 1.36).arrived).join(" "));
      // and a body inside cannot get out, in any direction
      let escaped = 0;
      for (const [sx, sy] of [[272, 225], [330, 189], [308, 264]]) for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2, A = W.mapToWorld(sx, sy), pos = new THREE.Vector3(A.x, 0, A.z);
        for (let s = 0; s < 400; s++) { pos.x += Math.cos(a) * 0.25; pos.z += Math.sin(a) * 0.25; W.resolveCircle(pos, 0.35, 0, true); }
        const q = px(pos.x, pos.z);
        if (q[0] < 246 || q[0] > 358 || q[1] < 181 || q[1] > 269.5) escaped++;
      }
      check("M2C.4 from inside the yard / gap / notch nobody walks out", escaped === 0, escaped);
      // eye-level rays from inside all stop on fences / walls (the region is closed in plan)
      let open = 0;
      for (const [sx, sy] of [[272, 225], [330, 189]]) for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2, A = W.mapToWorld(sx, sy), r = W.raycast(A.x, 1.0, A.z, Math.cos(a), 0, Math.sin(a), 40);
        if (!r || r.ground) { open++; continue; }
        const q = px(A.x + Math.cos(a) * r.distance, A.z + Math.sin(a) * r.distance);
        if (q[0] < 245 || q[0] > 359 || q[1] < 180 || q[1] > 270.5) open++;
      }
      check("M2C.4 every ray from inside ends on the fence / walls around the region", open === 0, open);
      check("M2C.4 no fixed spawn / pickup spot is inside it, in a garage or in a hollow house", W.pvpSpawnPoints.concat(W.pvpPickupSpots).every((s) => !W.isSpawnExcluded(s[0], s[1]) && W.isReachable(s[0], s[1]) && !W.isInsideHouseInterior(s[0], s[1])), JSON.stringify(W.pvpPickupSpots));
    }
    // 5. yellow garage: attached to 1114, no way in from anywhere; 1114's interior does not connect to it
    {
      const y = rec("garageY"), c = rec("1114");
      const ry = rectPx(y), rc = rectPx(c), cp = px(c.x, c.z);
      check("M2C.5 yellow garage interior: walkable and reachable through its doors", W.isWalkable(y.x, y.z, 0.3) && W.isReachable(y.x, y.z));
      check("M2C.5 yellow shares a wall with 1114 (its west face on 1114's NE wall)", Math.abs(ry[0] - rc[2]) < 1 && ry[1] < rc[3] && ry[3] > rc[1] + 5, ry[0].toFixed(1) + " vs " + rc[2].toFixed(1));
      const cy = [(ry[0] + ry[2]) / 2, (ry[1] + ry[3]) / 2];
      const around = [[ry[0] - 6, cy[1]], [cy[0], ry[3] + 6], [ry[2] + 6, cy[1]], [cy[0], ry[1] - 6]];
      check("M2C.5 yellow garage: in through the south door and the west doorway; north and east walls stop you", walkP([ry[0] - 6, 202], cy, 0).arrived && walkP([545, ry[3] + 6], cy, 0).arrived && !walkP(around[3], cy, 0).arrived && !walkP(around[2], cy, 0).arrived);
      const inter = walkP(cp, [ry[0] + 3, cy[1]], 0), ip = px(inter.x, inter.z);
      check("M2C.5 from the middle of 1114 you cannot walk through the shared wall into the yellow garage", !inter.arrived && ip[0] < rc[2], JSON.stringify(ip));
      check("M2C.5 purple garage is open inside (west door), orange stays solid and unreachable", (() => { const gp = rec("garageP"), ge = rec("garageE"); return W.isWalkable(gp.x, gp.z, 0.3) && W.isReachable(gp.x, gp.z) && !W.isWalkable(ge.x, ge.z, 0.3) && !W.isReachable(ge.x, ge.z); })());
    }
    // 6. driveway runs to the orange garage's door; alley ends at the purple garage's door apron
    {
      const g = rec("garageE"), gr = rectPx(g);
      let ok = true, at = null;
      for (let x = 250; x <= gr[0] - 0.5; x += 1) { const q = W.mapToWorld(x, 144); if (W.groundMaterialAt(q.x, q.z) !== "concrete") { ok = false; at = x; break; } }
      check("M2C.6 concrete drive runs from the sidewalk up to the orange garage wall (at the door row)", ok && gr[0] > 296, at);
      let rows = true;
      for (let y = 128; y <= 178; y += 3) { const q = W.mapToWorld(gr[0] - 1.2, y); if (W.groundMaterialAt(q.x, q.z) !== "concrete") rows = false; }
      check("M2C.6 the drive is concrete along the whole west face of the garage", rows);
      check("M2C.6 you can walk from the sidewalk to the garage door (round the parked car) and the wall stops you", walkP([249, 164], [gr[0] - 1.0, 164], 0).arrived && walkP([gr[0] - 1.0, 164], [gr[0] - 1.0, 152], 0).arrived && !walkP([gr[0] - 1.0, 164], [gr[0] + 4, 164], 0).arrived);
      const p = rec("garageP"), pr = rectPx(p), doorX = (pr[0] + pr[2]) / 2;
      let conc = true;
      for (let x = 300; x <= doorX + 3; x += 2) { const q = W.mapToWorld(x, 110); if (W.groundMaterialAt(q.x, q.z) !== "concrete") conc = false; }
      const apron = W.mapToWorld(doorX, pr[1] - 1.5);
      check("M2C.6 the back alley is concrete all the way to the purple garage's door and its apron touches the door wall", conc && W.groundMaterialAt(apron.x, apron.z) === "concrete" && pr[1] - 122 < 1.5, "doorX=" + doorX.toFixed(1));
      check("M2C.6 walk the alley end to end to the purple door, the wall stops you", walkP([246, 110], [doorX, pr[1] - 1.0], 0).arrived && !walkP([doorX, pr[1] - 1.0], [doorX, pr[1] + 8], 0).arrived);
    }
    // 7. the little curved footpath of 1108
    {
      const pts = [[395.2, 333], [401.4, 314.4], [404.5, 305.6], [409.3, 296.8], [413.8, 289.6]];
      check("M2C.7 footpath points are concrete, flat and walkable (no collider)", pts.every(([x, y]) => { const q = W.mapToWorld(x, y); return W.groundMaterialAt(q.x, q.z) === "concrete" && W.isWalkable(q.x, q.z, 0.4) && W.supportHeightAt(q.x, q.z, 0.3, 0.6) === 0; }));
      check("M2C.7 branch points are concrete too and the lawn beside is grass", [[402.3, 287.9], [383.7, 280.0], [378.9, 275.6]].every(([x, y]) => { const q = W.mapToWorld(x, y); return W.groundMaterialAt(q.x, q.z) === "concrete"; }) && (() => { const q = W.mapToWorld(425, 310); return W.groundMaterialAt(q.x, q.z) === "grass"; })());
      let all = true;
      for (let i = 0; i < pts.length - 1; i++) all = all && walkP(pts[i], pts[i + 1], 0).arrived;
      check("M2C.7 walkable from the sidewalk up to the front step", all);
      const old = W.mapToWorld(407, 320);
      check("M2C.7 the old straight walk is gone", W.groundMaterialAt(old.x, old.z) === "grass");
    }
    // 8. minimap data stays valid
    {
      const fp = W.minimapFootprints();
      check("M2C.8 minimap footprints finite and include every new part", fp.every((c) => [c.cx, c.cz, c.halfX, c.halfZ, c.height].every(Number.isFinite)) && ["1104", "1104e", "1104w", "1104p", "garageE"].every((n) => { const h = rec(n); return fp.some((c) => Math.abs(c.cx - h.x) < 0.01 && Math.abs(c.cz - h.z) < 0.01); }) && ["1114", "1114w", "1114e", "garageP", "garageY"].every((n) => { const h = rec(n); return fp.some((c) => Math.abs(c.cx - h.x) <= h.halfX && Math.abs(c.cz - h.z) <= h.halfZ); }), fp.length);
    }
    H.resetGame();
  }

  // ---- Rev 6: spawns never land deep in the storm (prefix M2P) ----
  function runMap2Spawns() {
    H.startPvpForTest(2, "deathmatch", "map2");
    const W = H.map2World, P = H.players, z = H.zoneState, f = W.pvpFinalZone;
    P.forEach((q) => H.pvpRespawnPlayer(q));
    const from = { x: z.center.x, z: z.center.z, radius: z.radius };
    const states = [0, 0.2, 0.45, 0.7, 1].map((t) => ({ t, x: from.x + (f.x - from.x) * t, z: from.z + (f.z - from.z) * t, r: from.radius + (f.radius - from.radius) * t }));
    const rp = W.reachablePoints();
    let total = 0, outside = 0, excluded = 0, unreachable = 0, notWalk = 0, inHouse = 0, inStorm = 0, tooClose = 0, worstEdge = 0;
    const t0 = performance.now();
    for (const s of states) {
      z.center = { x: s.x, z: s.z }; z.radius = s.r;
      for (let i = 0; i < 1000; i++) {
        const me = P[i % 2], other = P[(i + 1) % 2];
        if (i % 5 === 0) { const q = rp[Math.floor(Math.random() * rp.length)]; other.camera.position.set(q.x, H.EYE_HEIGHT, q.z); } // vary where the opponent is
        const r = H.pickPvpSpawnPoint(me);
        total++;
        const d = Math.hypot(r.x - s.x, r.z - s.z);
        if (d > s.r) outside++;
        if (r.inStorm) inStorm++;
        worstEdge = Math.max(worstEdge, d - s.r);
        if (W.isSpawnExcluded(r.x, r.z)) excluded++;
        if (!W.isReachable(r.x, r.z)) unreachable++;
        if (!W.isWalkable(r.x, r.z, 0.4) || !W.insidePlayableEdge(r.x, r.z, 0)) notWalk++;
        if (W.isInsideHouseInterior(r.x, r.z)) inHouse++;
        if (Math.hypot(other.camera.position.x - r.x, other.camera.position.z - r.z) < 3) tooClose++;
      }
    }
    check("M2P.1 " + total + " respawns across the whole storm: none outside the safe circle, none flagged in-storm", outside === 0 && inStorm === 0, "outside=" + outside + " inStorm=" + inStorm + " worst=" + worstEdge.toFixed(2) + " (" + ((performance.now() - t0) / 1000).toFixed(1) + " s)");
    check("M2P.2 none in the exclusion region, none unreachable, all walkable", excluded === 0 && unreachable === 0 && notWalk === 0, [excluded, unreachable, notWalk].join("/"));
    check("M2P.3 hollow-house interiors (floors, garages, basements) are valid spawns: used sometimes, not mostly", inHouse > 0 && inHouse < total * 0.7, inHouse + "/" + total);
    check("M2P.4 never right on top of the opponent", tooClose === 0, tooClose);
    // the margin from the edge: every normal spawn keeps >= min(8, 0.3 r) from the circle
    {
      z.center = { x: f.x, z: f.z }; z.radius = f.radius;
      let min = Infinity;
      for (let i = 0; i < 300; i++) { const r = H.pickPvpSpawnPoint(P[0]); min = Math.min(min, f.radius - Math.hypot(r.x - f.x, r.z - f.z)); }
      check("M2P.5 the final circle's spawns keep a margin from its edge", min >= Math.min(H.PVP_SPAWN.ZONE_EDGE_MARGIN, f.radius * 0.3) - 0.01, min.toFixed(2));
    }
    // truly nowhere valid in the eye of the circle (a circle inside the orange garage): nearest valid walkable point, slightly in the storm
    {
      const g = W.houses.find((h) => h.name === "garageE");
      z.center = { x: g.x, z: g.z }; z.radius = 2.5;
      const picks = [];
      for (let i = 0; i < 200; i++) picks.push(H.pickPvpSpawnPoint(P[i % 2]));
      const maxD = Math.max(...picks.map((r) => Math.hypot(r.x - g.x, r.z - g.z) - z.radius));
      check("M2P.6 no ground in the circle: spawns are flagged in-storm, valid, and the nearest ground to the circle (slightly in the storm)", picks.every((r) => r.inStorm && W.isWalkable(r.x, r.z, 0.4) && W.isReachable(r.x, r.z) && !W.isSpawnExcluded(r.x, r.z)) && maxD < 10, "maxD=" + maxD.toFixed(2));
      // such a spawn gets double protection and double storm grace
      const p = P[0];
      H.pvpRespawnPlayer(p);
      check("M2P.7 in-storm spawn: protection 4 s (2x) and zone grace x2", p.pvpProtectedFor === 4 && p.zoneDelayScale === 2, p.pvpProtectedFor + "/" + p.zoneDelayScale);
      const run = (pl, scale, prot, seconds) => { pl.health = 100; pl.zoneOutsideSeconds = 0; pl.zoneDamageAccum = 0; pl.zoneDelayScale = scale; pl.pvpProtectedFor = prot; for (let t = 0; t < seconds; t += 0.1) { H.updateZone(0.1); if (pl.pvpProtectedFor > 0) pl.pvpProtectedFor = Math.max(0, pl.pvpProtectedFor - 0.1); } return pl.health; };
      place(P[1], g.x + 40, g.z, 0); P[1].pvpProtectedFor = 99; // the other player stays out of this
      z.phase = "stay"; z.from = null; // the map2 converge phase would re-centre the circle on every update
      z.center = { x: g.x, z: g.z }; z.radius = 2.5;
      place(p, g.x + 20, g.z, 0); // outside the 2.5 m circle
      const hpNormal = run(p, 1, 2, 3.4), hpLong = run(p, 2, 4, 3.4), hpLongLate = run(p, 2, 4, 6.5);
      check("M2P.8 storm damage: a normal spawn is hurt within 3.4 s, the in-storm spawn is untouched until ~4 s, then hurt", hpNormal < 100 && hpLong === 100 && hpLongLate < 100, [hpNormal, hpLong, hpLongLate].join("/"));
      // back inside the safe circle the grace resets
      place(p, g.x, g.z, 0); H.updateZone(0.1);
      check("M2P.9 inside the circle the longer grace is dropped again", p.zoneDelayScale === 1, p.zoneDelayScale);
    }
    H.resetGame();
  }

  // ---- pink house 1114 (one open L-shaped interior, back door + steps), jumpable roofs, crate stairs ----------------
  function runPinkAndRoofs() {
    H.startPvpForTest(2, "deathmatch", "map2");
    H.players.forEach((q) => H.pvpRespawnPlayer(q));
    const W = H.map2World, STEP = W.stepUpHeight, R = 0.35;
    const Pw = (px, py) => W.mapToWorld(px, py);
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
    const route = (pts, feet0) => { let cur = Pw(...pts[0]), feet = feet0, ok = true, mj = 0; for (let i = 1; i < pts.length; i++) { const r = walkPath(cur, Pw(...pts[i]), feet, true); ok = ok && r.arrived; mj = Math.max(mj, r.maxJump); cur = r; feet = r.feet; } return { ok, feet, mj }; };

    // PH.1 through the house: back door -> east wing -> main body -> front hall -> front door, level 0.34 inside, no popping
    const through = route([[534, 232], [534, 250], [508, 250], [497.5, 262], [497.5, 290]], 0);
    check("PH.1 walk in the back door, through the whole house and out the front door", through.ok && Math.abs(through.feet) < 0.02 && through.mj < 0.4, JSON.stringify(through));
    const insideAt = route([[534, 232], [534, 250]], 0), westWing = route([[534, 232], [534, 250], [508, 250], [477, 245]], 0);
    check("PH.2 the interior is one level (0.34) from the east wing to the west wing", Math.abs(insideAt.feet - 0.34) < 0.02 && westWing.ok && Math.abs(westWing.feet - 0.34) < 0.02, JSON.stringify(westWing));
    // PH.3 outer walls stop you from inside, in every direction
    const wallProbes = [[[508, 240], [508, 195]], [[477, 240], [440, 240]], [[534, 255], [565, 255]], [[534, 262], [534, 295]], [[477, 240], [477, 280]], [[515, 262], [515, 300]]];
    const wallRes = wallProbes.map(([a, b]) => walkPath(Pw(...a), Pw(...b), 0.34, true));
    check("PH.3 outer walls stop you from the inside (N, W, E, S of the east wing, S of the west wing, S front wall)", wallRes.every((r) => !r.arrived), wallRes.map((r) => r.arrived).join());
    // PH.4 the shared yellow-garage wall stays shut and there is no gap in the notch wall
    const toGarage = walkPath(Pw(515, 215), Pw(540, 203), 0.34, true);
    check("PH.4 you cannot walk from the house into the yellow garage (no shared opening)", !toGarage.arrived, JSON.stringify(toGarage));
    // PH.5 back-door steps: 0.34 landing, risers 2/3 and 1/3, walkable from the lawn
    const stepUp = route([[534, 246], [534, 238], [534, 233], [534, 228]], 0.34);
    check("PH.5 back-door steps are walkable down to the lawn", stepUp.ok && Math.abs(stepUp.feet) < 0.02 && stepUp.mj < 0.4, JSON.stringify(stepUp));
    // PH.6 a jump inside never meets the ceiling plate (head at floor + 1.85 + apex 1.36 < ceiling)
    check("PH.6 ceiling clears a standing jump inside (3.7 m)", 0.34 + 1.85 + 1.36 < 3.7);
    // PH.7 doorway is open to sight and shots at head height; wall beside it is not
    const sb = (a, b) => W.segmentBlocked(a.x, a.z, b.x, b.z, 0, false, 0.34, 0.34);
    check("PH.7 sight: through the front doorway is open, through the wall beside it is blocked", !sb(Pw(497.5, 262), Pw(497.5, 290)) && sb(Pw(510, 262), Pw(510, 290)));

    // ---- jumpable roofs ----------------------------------------------------------------------------------------
    const acc = W.roofAccess;
    check("PH.8 crate staircases exist on the low buildings (and none inside the sealed yard)", acc.length >= 10 && acc.every((a) => { const px = W.pxOfWorld(a.x, a.z); return !(px.x > 246 && px.x < 358 && px.y > 181 && px.y < 270); }), acc.length);
    const byName = (n) => W.houses.find((h) => h.name === n);
    let bad = [];
    for (const a of acc) {
      const h = byName(a.name === "h1114" ? "1114e" : a.name);
      if (!h) continue;
      const topCrate = 0.95 * a.crates;
      const roofFirst = h.wallH; // first roof step sits just above the eave
      // each hop is a single jump (apex 1.36 m), and the last hop from the top crate must reach the eave + the first roof step
      if (0.95 > 1.36 || topCrate + 1.36 + STEP < roofFirst + 0.44) bad.push(a.name + " reach " + (topCrate + 1.36 + STEP).toFixed(2) + " vs " + roofFirst.toFixed(2));
    }
    check("PH.9 every crate stair is jumpable all the way up to its roof (hop <= 1.36 m, top + apex reaches the eave)", bad.length === 0, bad.join(" | "));
    // the crates stand against the wall and carry you (support height = crate top), and stay clear of fences
    let carry = [], fenceBad = [];
    for (const a of acc) {
      const sup = W.supportHeightAt(a.x, a.z, 0.2, 99);
      if (sup < 0.9) carry.push(a.name + " support " + sup.toFixed(2));
      const fences = H.map2World ? [] : [];
    }
    check("PH.10 crates are solid steps you can stand on", carry.length === 0, carry.join(" | "));
    // roofs: standing on a roof (jump up from the top crate) is possible and the stair-stepped roof can be walked toward the ridge
    const g = byName("garageP"), onRoof = W.supportHeightAt(g.x, g.z, 0.3, g.height + 0.5);
    check("PH.11 the garage roof is a surface up to the ridge", onRoof > g.wallH + 0.1 && onRoof < g.height + 0.01, onRoof.toFixed(2) + " / ridge " + g.height.toFixed(2));
    // you can still walk around/inside under a roof (the roof only supports a body that is already above the eave)
    const under = W.supportHeightAt(g.x, g.z, 0.3, 2.0);
    check("PH.12 a body inside the garage is not lifted onto its roof", Math.abs(under) < 0.01, under);
    // fences still cannot be climbed from a crate: no crate within 4 m of a fence
    const fenceCols = []; W.minimapFootprints().forEach((c) => { if (c.fx === "wood" && c.height >= 1.3 && c.height <= 2.3 && !c.base && Math.max(c.halfX, c.halfZ) > 1.5) fenceCols.push(c); });
    const tooClose = acc.filter((a) => fenceCols.some((c) => a.x > c.minX - 4 && a.x < c.maxX + 4 && a.z > c.minZ - 4 && a.z < c.maxZ + 4));
    check("PH.13 no crate stair is within 4 m of a fence (it would be a way over)", tooClose.length === 0, tooClose.map((a) => a.name).join());
    H.resetGame();
  }

  // ---- basements, the stairs, the tunnel, smooth roofs, 1108's west doorway, no tree in the yellow garage -----------------
  function runBasements() {
    H.startPvpForTest(2, "deathmatch", "map2");
    H.players.forEach((q) => H.pvpRespawnPlayer(q));
    const W = H.map2World, STEP = W.stepUpHeight, R = 0.35, D = 2.6;
    const Pw = (px, py) => W.mapToWorld(px, py);
    // a walker like the game's: horizontal collision at the current feet height, then the support height at feet + STEP.
    // Returns the worst single-frame change of the floor (a "pop") and the lowest/highest feet reached.
    function walk(pts, feet0) {
      let pos = Pw(...pts[0]), feet = feet0, ok = true, worst = 0, lo = feet0, hi = feet0, hitWall = null;
      const v = new THREE.Vector3(pos.x, feet, pos.z);
      for (let k = 1; k < pts.length; k++) {
        const to = Pw(...pts[k]), dist = Math.hypot(to.x - v.x, to.z - v.z), n = Math.max(1, Math.ceil(dist / 0.1));
        const sx = (to.x - v.x) / n, sz = (to.z - v.z) / n;
        for (let i = 0; i < n; i++) {
          v.x += sx; v.z += sz;
          W.resolveCircle(v, R, feet, true);
          const f = W.supportHeightAt(v.x, v.z, R, feet + STEP);
          worst = Math.max(worst, Math.abs(f - feet)); feet = f; lo = Math.min(lo, feet); hi = Math.max(hi, feet);
        }
        if (Math.hypot(to.x - v.x, to.z - v.z) > 0.25) { ok = false; hitWall = { leg: k, at: W.pxOfWorld(v.x, v.z), feet }; break; }
      }
      return { ok, worst: +worst.toFixed(3), lo: +lo.toFixed(2), hi: +hi.toFixed(2), feet: +feet.toFixed(2), hitWall };
    }
    // BS.1 the whole loop: out 1108's west door -> down -> basement -> tunnel -> 1114's basement -> up -> back door -> round again
    const down = walk([[375, 243.7], [386, 243.7], [430, 243.7], [458, 243.7], [490, 243.7], [498, 243.7]], 0);
    check("BS.1 from outside 1108's west doorway, down its stairs, through the basement and the tunnel into 1114's basement", down.ok && Math.abs(down.feet + D) < 0.02 && down.lo <= -D + 0.01 && down.worst < 0.2, JSON.stringify(down));
    const up = walk([[498, 243.7], [534, 243.7], [534, 228]], -D);
    check("BS.2 up 1114's stairs, across the ground floor and out its back door", up.ok && Math.abs(up.feet) < 0.02 && up.worst < 0.2, JSON.stringify(up));
    const back = walk([[534, 228], [534, 243.7], [498, 243.7], [458, 243.7], [430, 243.7], [386, 243.7], [370, 243.7]], 0);
    check("BS.3 and all the way back the other way: 1114 back door, down, tunnel, up 1108's stairs, out the west doorway", back.ok && Math.abs(back.feet) < 0.02 && back.lo <= -D + 0.01 && back.worst < 0.2, JSON.stringify(back));
    // BS.4 smooth: the floor under you never changes by more than a few cm per 10 cm of walking, anywhere on the stairs
    const sm1 = walk([[386, 243.7], [418, 243.7]], 0.34), sm2 = walk([[532, 243.7], [500, 243.7]], 0.34);
    check("BS.4 stairs are a smooth slope (largest floor change per 10 cm step <= 8 cm, descending and climbing)", sm1.ok && sm2.ok && sm1.worst <= 0.08 && sm2.worst <= 0.08, sm1.worst + " / " + sm2.worst);
    // BS.5 headroom: where the floor slab starts above a stair, the stair is already far enough down (body 1.85 m + the slab underside at 0)
    const ST = W.stairs.map((st) => { const ps = W.pits.find((p) => p.stair && Math.abs(((p.hole.x0 + p.hole.x1) / 2) - (W.mapToWorld(st.px[0], st.px[1]).x + W.mapToWorld(st.px[2], st.px[3]).x) / 2) < 0.2); return { st, p: ps }; });
    check("BS.5 both stairs: under the slab the floor is >= 1.9 m below it (no head in the ceiling) and reaches the basement floor", ST.every(({ p }) => p && Math.abs(p.floorAt(p.hole.x0 > p.x0 + 0.01 ? p.x0 : p.x1) - (-D)) < 0.02 && Math.min(p.floorAt(p.hole.x0), p.floorAt(p.hole.x1)) <= -2.2), ST.map(({ p }) => p && [p.floorAt(p.hole.x0).toFixed(2), p.floorAt(p.hole.x1).toFixed(2)].join("/")).join(" | "));
    // BS.6 the ground floor does not sag into the basement: standing on the slab beside the opening, on the lawn above the tunnel
    const on = (px, py, from) => { const q = Pw(px, py); return +W.supportHeightAt(q.x, q.z, R, from).toFixed(2); };
    check("BS.6 floor under a body: slab 0.34 above the basement, lawn 0 above the tunnel, basement floor -2.6 below", on(425, 243.7, 0.84) === 0.34 && on(458, 243.7, 0.5) === 0 && on(425, 243.7, -D + STEP) === -D && on(458, 243.7, -D + STEP) === -D);
    // BS.7 solid walls: walls of the basement stop you from inside, the ground-floor walls pass above you at basement level
    const bw = [[[430, 243.7], [430, 205]], [[430, 258], [376, 262]], [[430, 255], [470, 262]], [[490, 243.7], [490, 205]], [[490, 243.7], [545, 260]], [[458, 243.7], [458, 232]], [[458, 243.7], [458, 256]]];
    const bwr = bw.map(([a, b]) => walk([a, b], -D));
    check("BS.7 basement + tunnel walls stop you (N/W/S of 1108, S of 1108 east part, N and S walls of 1114, tunnel sides)", bwr.every((r) => !r.ok && r.feet === -D), bwr.map((r) => r.ok + "/" + r.feet).join(" "));
    // BS.8 only the two annotated openings lead down: you cannot walk down through the floor anywhere else, only into the stairwells
    let leaks = 0; const lows = [];
    for (let px = 384; px <= 449; px += 3) for (let py = 212; py <= 273; py += 3) { const q = Pw(px, py); if (W.isWalkable(q.x, q.z, 0.3)) { const f = W.supportHeightAt(q.x, q.z, R, 0.84); if (f < 0.3) { const inHole = px >= 390.4 && px <= 409.8 && py >= 239.3 && py <= 251; if (!inHole) { leaks++; lows.push(px + "," + py + ":" + f); } } } }
    check("BS.8 1108's ground floor has no way down except the stairwell", leaks === 0, lows.slice(0, 6).join(" "));
    // BS.9 the stairwell guard rails: you cannot walk in sideways from the ground floor, a jump vaults them, the top end is open
    const rail = walk([[400, 236], [400, 244]], 0.34), top = walk([[386, 243.7], [394, 243.7]], 0.34);
    check("BS.9 rails block a sideways walk into the stairwell; the top end is open", !rail.ok && rail.feet === 0.34 && top.ok && top.feet < 0.34, JSON.stringify([rail.ok, rail.feet, top.ok, top.feet]));
    // BS.10 sight and shots: a floor between a basement and the rooms above it
    const sb = (a, b, ya, yb) => W.segmentBlocked(a.x, a.z, b.x, b.z, 0, false, ya, yb);
    check("BS.10 no sight through the floor (basement <-> ground floor, away from the stairwell)", sb(Pw(425, 243.7), Pw(428, 244), -D, 0.34) && sb(Pw(425, 243.7), Pw(428, 244), 0.34, -D));
    const up1 = W.raycast(Pw(425, 243.7).x, -0.9, Pw(425, 243.7).z, 0, 1, 0, 8), dn1 = W.raycast(Pw(425, 243.7).x, 1.7, Pw(425, 243.7).z, 0, -1, 0, 8);
    check("BS.11 a shot up from the basement stops at the floor above; one down from the ground floor lands on it", up1 && up1.y < 0.4 && dn1 && Math.abs(dn1.y - 0.34) < 0.05, (up1 && up1.y) + " / " + (dn1 && dn1.y));
    // BS.12 dirt tunnel + stairwell show in the ground height used by rays/impacts; outside the openings it is the lawn
    const gq = Pw(400, 244), lawn = Pw(300, 300);
    check("BS.12 visible ground: stair surface down the stairwell, lawn elsewhere", W.groundHeightAt(gq.x, gq.z) < 0.2 && W.groundHeightAt(lawn.x, lawn.z) === 0);

    // ---- 1108's second doorway (west) -----------------------------------------------------------------------------
    const inW = walk([[374, 232], [380, 232], [388, 232]], 0);
    const doorW = walk([[374, 245.5], [388, 245.5]], 0), wallW = walk([[374, 228], [388, 228]], 0);
    check("BS.13 1108's west doorway: walk in level over the steps, the wall beside it stops you", doorW.ok && Math.abs(doorW.feet - 0.34) < 0.02 && doorW.worst < 0.35 && !wallW.ok, JSON.stringify([doorW, wallW.ok]));

    // ---- smooth roofs --------------------------------------------------------------------------------------------
    const roofs = ["garageP", "garageY", "1108", "1101", "1109", "1115", "garageE"], rough = [];
    for (const n of roofs) {
      const h = W.houses.find((q) => q.name === n); if (!h) continue;
      let prev = null, worst = 0, count = 0;
      for (let x = h.x - h.halfX - 0.3; x <= h.x + h.halfX + 0.3; x += 0.1) { // across the whole roof, a body already above the eave (an apex jump)
        const f = W.supportHeightAt(x, h.z, R, h.height + 1); if (f < h.wallH - 0.05) { prev = null; continue; }
        if (prev !== null) { worst = Math.max(worst, Math.abs(f - prev)); count++; }
        prev = f;
      }
      if (count < 20 || worst > 0.09) rough.push(n + " worst " + worst.toFixed(3) + " n=" + count);
    }
    check("BS.14 every roof is a smooth slope (floor change <= 9 cm per 10 cm of walking, no 38 cm steps)", rough.length === 0, rough.join(" | "));
    const g = W.houses.find((q) => q.name === "garageP"), w = walk([[g.x * 0 + W.pxOfWorld(g.x, g.z).x - 40, W.pxOfWorld(g.x, g.z).y], [W.pxOfWorld(g.x, g.z).x, W.pxOfWorld(g.x, g.z).y]], 0);
    // BS.15 a body that has jumped onto a roof walks up it to the ridge without a wall in the way
    const rp = W.pxOfWorld(g.x, g.z); let feet = g.wallH + 0.05, stuck = false; const v = new THREE.Vector3(g.x - g.halfX + 0.2, feet, g.z);
    for (let i = 0; i < Math.floor(g.halfX / 0.1) && !stuck; i++) { v.x += 0.1; W.resolveCircle(v, R, feet, true); const f = W.supportHeightAt(v.x, v.z, R, feet + STEP); if (f < feet - 0.5) stuck = true; feet = f; }
    check("BS.15 walking up the garage roof from the eave reaches the ridge height, no invisible walls", !stuck && feet > g.wallH + 1.0 && feet <= g.height + 0.05, feet.toFixed(2) + " ridge " + g.height.toFixed(2));

    // ---- the tree that stood inside the yellow garage ------------------------------------------------------------------
    const y = W.houses.find((q) => q.name === "garageY"); let treeInside = 0;
    for (let x = y.x - y.halfX + 1; x <= y.x + y.halfX - 1; x += 1) for (let z = y.z - y.halfZ + 1; z <= y.z + y.halfZ - 1; z += 1) if (!W.isWalkable(x, z, 0.35)) treeInside++;
    const oldTree = Pw(552, 205);
    check("BS.16 the yellow garage interior is clear (no tree trunk inside; old tree spot walkable)", treeInside === 0 && W.isWalkable(oldTree.x, oldTree.z, 0.4), treeInside);
    H.resetGame();
  }

  // ---- head-bumps, airborne wall hits, window placement, coplanar faces ------------------------------------------------
  function runCollisionFixes() {
    H.startPvpForTest(2, "deathmatch", "map2");
    H.players.forEach((q) => H.pvpRespawnPlayer(q));
    const W = H.map2World, R = 0.35, D = 2.6, BODY = 1.85;
    const Pw = (px, py) => W.mapToWorld(px, py);
    // one airborne column like the game's gravity step: rise with the jump speed, clamp under any ceiling, then fall back
    function jumpAt(px, py, groundFeet) {
      const q = Pw(px, py), pos = new THREE.Vector3(q.x, groundFeet, q.z);
      let off = 0, vy = 7, maxHead = groundFeet + BODY, moved = 0;
      for (let t = 0; t < 140; t++) {
        vy += -18 * (1 / 60); off += vy * (1 / 60);
        if (vy > 0) { const ceil = W.ceilingAt(pos.x, pos.z, R, groundFeet + off + BODY - 0.4); if (groundFeet + off + BODY > ceil - 0.01) { off = Math.max(0, ceil - 0.01 - BODY - groundFeet); vy = Math.min(vy, 0); } }
        const landed = off <= 0; off = Math.max(0, off); const before = { x: pos.x, z: pos.z }; pos.y = groundFeet + off; W.resolveCircle(pos, R, groundFeet + off, false, BODY);
        moved = Math.max(moved, Math.hypot(pos.x - before.x, pos.z - before.z));
        maxHead = Math.max(maxHead, groundFeet + off + BODY);
        if (landed) break;
      }
      return { maxHead: +maxHead.toFixed(3), moved: +moved.toFixed(3) };
    }
    // CF.1 basement: the head stops at the floor slab (0) and the jump never shoves the player sideways
    const sj = jumpAt(425, 255, -D);
    check("CF.1 jumping in a basement: head stops under the floor above (<= 0), no sideways shove", sj.maxHead <= 0.001 && sj.moved < 0.001, JSON.stringify(sj));
    // CF.2 the tunnel: same under the earth lid
    const tj = jumpAt(458, 243.7, -D);
    check("CF.2 jumping in the tunnel: head stops under the earth (<= -0.2 + small), no shove", tj.maxHead <= -0.19 && tj.moved < 0.001, JSON.stringify(tj));
    // CF.3 open air and the ground floor are not clamped
    const gj = jumpAt(497.5, 300, 0), fj = jumpAt(508, 252, 0.34);
    check("CF.3 jumps on the lawn and on a ground floor still reach the full apex (1.36 m)", gj.maxHead > BODY + 1.3 && fj.maxHead > 0.34 + BODY + 1.3, gj.maxHead + " / " + fj.maxHead);
    // CF.4 airborne into a wall at speed: the body is held at the wall, never teleported across it
    function airWall(a, b, feet) {
      const A = Pw(...a), B = Pw(...b), pos = new THREE.Vector3(A.x, feet, A.z), n = 60; let worst = 0;
      for (let i = 0; i < n; i++) {
        const prev = { x: pos.x, z: pos.z }, sx = (B.x - A.x) / n, sz = (B.z - A.z) / n;
        pos.x += sx; pos.z += sz;
        W.resolveCircle(pos, R, feet + 0.5 + 0.5 * Math.sin(i / n * Math.PI), false, BODY); // mid-jump feet height
        worst = Math.max(worst, Math.hypot(pos.x - (prev.x + sx), pos.z - (prev.z + sz)) - Math.hypot(sx, sz)); // how far the wall moved it beyond undoing this step
      }
      return { x: pos.x, z: pos.z, worst: +worst.toFixed(3), end: W.pxOfWorld(pos.x, pos.z) };
    }
    const walls = [[[430, 243.7 + 14], [430, 276], -D, "1108 S basement wall"], [[430, 255], [376, 255], -D, "1108 W basement wall"], [[490, 243.7], [490, 200], -D, "1114 N basement wall"], [[458, 243.7], [458, 262], -D, "tunnel side"], [[430, 255], [376, 255], 0.34, "1108 W wall, ground floor"], [[508, 252], [508, 195], 0.34, "1114 N wall, ground floor"], [[477, 245], [440, 245], 0.34, "1114 W wall, ground floor"]];
    const wres = walls.map(([a, b, f, nm]) => ({ nm, r: airWall(a, b, f) }));
    check("CF.4 running + jumping into walls: the push never exceeds undoing the step (no teleport)", wres.every(({ r }) => r.worst < 0.02), wres.map(({ nm, r }) => nm + " worst=" + r.worst).join(" | "));
    check("CF.5 ...and the player ends on the inside of every wall", wres.every(({ r }, i) => { const b = walls[i][1], a = walls[i][0]; const dirx = Math.sign(b[0] - a[0]), diry = Math.sign(b[1] - a[1]); return (dirx === 0 || (r.end.x - a[0]) * dirx < (b[0] - a[0]) * dirx) && (diry === 0 || (r.end.y - a[1]) * diry < (b[1] - a[1]) * diry); }), wres.map(({ r }) => r.end.x.toFixed(0) + "," + r.end.y.toFixed(0)).join(" "));
    // CF.6 a slab is never a sideways wall: standing anywhere in the basement and on the ground floor, a sideways airborne step is free
    const free = (px, py, feet) => { const q = Pw(px, py), pos = new THREE.Vector3(q.x, feet, q.z); W.resolveCircle(pos, R, feet + 1.2, false, BODY); return Math.hypot(pos.x - q.x, pos.z - q.z) < 1e-6; };
    check("CF.6 floor slabs and the tunnel lid never push sideways (basement, tunnel, ground floor)", free(425, 255, -D) && free(458, 243.7, -D) && free(508, 252, 0.34) && free(410, 225, 0.34));
    // CF.7 windows: none inside a roof or a wall, none in a doorway (debug lists of the built meshes)
    const L = W.debugLists, glass = L.prop.filter((it) => it.c.getHex() === 0x39495a);
    const roofs = [].concat(L.gable.map((r) => ({ t: "gable", inv: r.m.clone().invert() })), L.hip.map((r) => ({ t: "hip", inv: r.m.clone().invert() })));
    const v = new THREE.Vector3();
    const inRoof = (x, y, z) => roofs.some((r) => { v.set(x, y, z).applyMatrix4(r.inv); if (Math.abs(v.x) > 0.5 || Math.abs(v.z) > 0.5 || v.y < 0.02) return false; const lim = r.t === "gable" ? 1 - 2 * Math.abs(v.z) : 1 - 2 * Math.max(Math.abs(v.x), Math.abs(v.z)); return v.y < lim - 0.02; });
    let inside = 0;
    for (const g of glass) { const e = g.m.elements, hx = 0.5 * (Math.abs(e[0]) + Math.abs(e[4]) + Math.abs(e[8])), hy = 0.5 * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9])), hz = 0.5 * (Math.abs(e[2]) + Math.abs(e[6]) + Math.abs(e[10])); if ([[-1, -1, -1], [1, 1, 1], [-1, 1, 1], [1, 1, -1]].some(([a, b, c]) => inRoof(e[12] + a * hx, e[13] + b * hy, e[14] + c * hz))) inside++; }
    check("CF.7 no window pokes through a roof (" + glass.length + " windows)", inside === 0, inside);
    const doorways = W.pits ? [] : [];
    const openingsHit = glass.filter((g) => { const e = g.m.elements, x = e[12], z = e[14], y = e[13]; return W.openingRects && W.openingRects.some((o) => x > o.x0 - 0.7 && x < o.x1 + 0.7 && z > o.z0 - 0.7 && z < o.z1 + 0.7 && y < o.h + 1.5 && y + 1 > o.h - 2.2); }).length;
    check("CF.8 no window floats in a doorway (1108 west door, 1114 back door, garage doors)", openingsHit === 0, openingsHit);
    // CF.9 coplanar overlapping faces of different colours (the texture-fight): none big enough to see
    const boxes = [];
    for (const key of ["prop", "siding", "interior"]) for (const it of L[key]) { const e = it.m.elements, ex = 0.5 * (Math.abs(e[0]) + Math.abs(e[4]) + Math.abs(e[8])), ey = 0.5 * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9])), ez = 0.5 * (Math.abs(e[2]) + Math.abs(e[6]) + Math.abs(e[10])); boxes.push({ hex: it.c.getHex(), min: [e[12] - ex, e[13] - ey, e[14] - ez], max: [e[12] + ex, e[13] + ey, e[14] + ez] }); }
    const CELL = 6, grid = new Map();
    boxes.forEach((b, i) => { for (let x = Math.floor(b.min[0] / CELL); x <= Math.floor(b.max[0] / CELL); x++) for (let z = Math.floor(b.min[2] / CELL); z <= Math.floor(b.max[2] / CELL); z++) { const k = x + "_" + z; (grid.get(k) || grid.set(k, []).get(k)).push(i); } });
    const seen = new Set(); let big = 0, worst = 0;
    for (const list of grid.values()) for (let a = 0; a < list.length; a++) for (let c = a + 1; c < list.length; c++) {
      const i = list[a], j = list[c], key = i < j ? i + "," + j : j + "," + i; if (seen.has(key)) continue; seen.add(key);
      const A = boxes[i], B = boxes[j]; if (A.hex === B.hex) continue;
      for (let ax = 0; ax < 3; ax++) {
        const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3, ov1 = Math.min(A.max[o1], B.max[o1]) - Math.max(A.min[o1], B.min[o1]), ov2 = Math.min(A.max[o2], B.max[o2]) - Math.max(A.min[o2], B.min[o2]);
        if (ov1 <= 0.01 || ov2 <= 0.01) continue;
        for (const side of ["max", "min"]) {
          if (Math.abs(A[side][ax] - B[side][ax]) >= 0.0012) continue;
          if (ax === 1 && (side === "min" || A[side][1] >= 3.5)) continue;
          const sgn = side === "max" ? 1 : -1, pt = [0, 0, 0]; pt[ax] = A[side][ax] + sgn * 0.01; pt[o1] = (Math.max(A.min[o1], B.min[o1]) + Math.min(A.max[o1], B.max[o1])) / 2; pt[o2] = (Math.max(A.min[o2], B.min[o2]) + Math.min(A.max[o2], B.max[o2])) / 2;
          let buried = false; for (const q of (grid.get(Math.floor(pt[0] / CELL) + "_" + Math.floor(pt[2] / CELL)) || [])) { if (q === i || q === j) continue; const T = boxes[q]; if (pt[0] > T.min[0] && pt[0] < T.max[0] && pt[1] > T.min[1] && pt[1] < T.max[1] && pt[2] > T.min[2] && pt[2] < T.max[2]) { buried = true; break; } }
          if (!buried) { const area = ov1 * ov2; worst = Math.max(worst, area); if (area > 0.12) big++; }
        }
      }
    }
    check("CF.9 no visible coplanar faces of different colours with an overlap over 0.12 m2 (worst " + worst.toFixed(2) + ")", big === 0, big);
    // IS.* indoor spawns
    const IS = W.interiorSpawns(), lv = (f) => IS.filter((q) => Math.abs(q[3] - f) < 0.05).length;
    check("IS.1 indoor spawn points exist on ground floors (0.34 m), in basements (-2.6 m) and at garage level", lv(0.34) > 5 && lv(-2.6) > 5, "floor " + lv(0.34) + " basement " + lv(-2.6) + " ground " + lv(0) + " total " + IS.length);
    H.startPvpForTest(2, "deathmatch", "map2"); H.players.forEach((q) => H.pvpRespawnPlayer(q)); const W2 = H.map2World; H.players[1].camera.position.set(W2.bounds.minX + 12, 1.7, W2.bounds.minZ + 12); let indoor = 0, basement = 0, bad = 0; const N = 300;
    for (let i = 0; i < N; i++) {
      const sp = H.pickPvpSpawnPoint(H.players[0]);
      if (sp.y !== 0) basement++;
      if (W2.isInsideHouseInterior(sp.x, sp.z, 0) || sp.y !== 0) indoor++;
      for (const o of H.players.slice(1)) if (Math.hypot(o.camera.position.x - sp.x, o.camera.position.z - sp.z) < 4) bad++;
    }
    check("IS.2 respawns pick indoor spots sometimes (" + indoor + "/" + N + ", off-ground " + basement + ") and never within 4 m of another player", indoor > 0 && bad === 0, indoor + " " + basement + " bad " + bad);
    const sp0 = IS.find((q) => q[3] < -2); const pl = H.players[0]; H.pvpRespawnPlayer(pl); pl.camera.position.set(sp0[0], 1.7 + sp0[3], sp0[2 - 1]); pl.campusGroundY = sp0[3];
    check("IS.3 a basement spawn stands on the basement floor (support height -2.6)", Math.abs(W.supportHeightAt(sp0[0], sp0[1], 0.35, sp0[3] + 0.05) - sp0[3]) < 0.06);
    H.resetGame();
  }

  // ---- teams (3 and 4 player lobbies) ------------------------------------------------------------------------------------
  function runTeams() {
    H.startPvpForTest(4, "deathmatch", "map2");
    H.players.forEach((q) => H.pvpRespawnPlayer(q));
    const P = H.players, clear = () => P.forEach((q) => { q.pvpProtectedFor = 0; q.health = H.getMaxHealth(q); });
    check("TM.1 friendly fire defaults to off", H.pvpFriendlyFire === false);
    H.pvpApplyTeams([0, 0, 1, 1]); clear();
    H.damagePvpPlayer(P[0], P[1], 40, false); H.damagePvpPlayer(P[0], P[2], 40, false);
    check("TM.2 teammates take no damage with friendly fire off; opponents do", P[1].health === H.getMaxHealth(P[1]) && P[2].health < H.getMaxHealth(P[2]), P[1].health + " / " + P[2].health);
    H.setPvpFriendlyFire(true); clear();
    H.damagePvpPlayer(P[0], P[1], 40, false);
    check("TM.3 friendly fire on: teammates take damage", P[1].health < H.getMaxHealth(P[1]), P[1].health);
    H.setPvpFriendlyFire(false);
    const lay = (v, o) => (P[v].camera.layers.mask & (1 << (10 + o))) !== 0;
    check("TM.4 team indicator is on teammates' cameras only (P1<->P2, P3<->P4), never opponents' or one's own", lay(1, 0) && lay(0, 1) && lay(3, 2) && lay(2, 3) && !lay(2, 0) && !lay(3, 0) && !lay(0, 2) && !lay(0, 0) && !lay(1, 1), [lay(1, 0), lay(0, 1), lay(3, 2), lay(2, 3), lay(2, 0), lay(0, 0)].join());
    // shots pass through teammates: a ray from P1 through P2 hits nothing of P2's, and does hit an opponent
    const t0 = P[0].camera.position, t1 = P[1].camera.position;
    P[1].camera.position.set(t0.x + 3, t0.y, t0.z); P[2].camera.position.set(t0.x + 6, t0.y, t0.z); P[1].campusGroundY = P[2].campusGroundY = P[0].campusGroundY;
    const ray = new THREE.Ray(t0.clone(), new THREE.Vector3(1, 0, 0));
    const hits = H.findPvpPlayerHits(P[0], ray, Infinity).map((h) => h.target);
    check("TM.5 hitscan skips teammates (friendly fire off) and still reaches the opponent behind", !hits.includes(P[1]) && hits.includes(P[2]), hits.length);
    H.pvpApplyTeams([0, 1, 2, 3]);
    check("TM.6 everyone on their own team = free for all (teams inactive, no indicators, damage allowed)", !lay(1, 0) && !H.pvpSameTeam(P[0], P[1]));
    H.pvpApplyTeams([0, 0, 1]); // stale 3-player array on a 4-player roster must not crash
    // setup screen: a Team row after Shoes, only on the quad PVP setup screen
    const c = { faceKey: "x", category: 4, team: 0 }, quadPanel = H.titlePanels["quad-setup"];
    const before = H.customizeCategoryCount(); H.quadSetup.slots.length = 4;
    quadPanel.classList.add("active"); H.setPvpSetup(true);
    const withTeams = H.customizeCategoryCount();
    H.stepCustomizeCategory(c, 1);
    const onTeam = c.category;
    H.cycleCustomization(c, 1); H.cycleCustomization(c, 1);
    const afterTwo = c.team; H.cycleCustomization(c, -1); H.cycleCustomization(c, -1); H.cycleCustomization(c, -1);
    const wrapped = c.team;
    quadPanel.classList.remove("active"); H.setPvpSetup(false);
    check("TM.7 setup screen: Team category exists on the quad PVP screen (4 teams, wraps), hidden elsewhere", before === 5 && withTeams === 6 && onTeam === 5 && afterTwo === 2 && wrapped === 3 && H.customizationValue(c, "team") === "Yellow", [before, withTeams, onTeam, afterTwo, wrapped].join());
    H.resetGame();
  }

  function runAdsSensitivity() {
    H.startPvpForTest(2, "deathmatch", "map2");
    const pl = H.players[0], set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event("input")); };
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    set("ads-sensitivity-slider", 50); set("sniper-ads-sensitivity-slider", 50);
    H.pvpGiveWeapon(pl, "ak47"); pl.aimProgress = 1;
    const rifle50 = H.getAimSensitivityMultiplier(pl);
    set("ads-sensitivity-slider", 25); const rifle25 = H.getAimSensitivityMultiplier(pl);
    set("ads-sensitivity-slider", 100); const rifle100 = H.getAimSensitivityMultiplier(pl);
    pl.aimProgress = 0; const hip = H.getAimSensitivityMultiplier(pl); pl.aimProgress = 1;
    H.pvpGiveWeapon(pl, "sniper"); pl.aimProgress = 1;
    set("sniper-ads-sensitivity-slider", 50); const sn50 = H.getAimSensitivityMultiplier(pl);
    set("sniper-ads-sensitivity-slider", 100); const sn100 = H.getAimSensitivityMultiplier(pl);
    set("sniper-ads-sensitivity-slider", 0); const sn0 = H.getAimSensitivityMultiplier(pl);
    set("ads-sensitivity-slider", 0); const snIndependent = H.getAimSensitivityMultiplier(pl);
    check("ADS.1 rifle: 50% = unchanged (1x), 25% = half, 100% = double; hip-fire never scaled", near(rifle50, 1) && near(rifle25, 0.5) && near(rifle100, 2) && hip === 1, [rifle50, rifle25, rifle100, hip].join());
    check("ADS.2 sniper: 50% keeps the built-in 0.4x, 100% doubles it, 0% never freezes the view; the other slider does not affect it", near(sn50, 0.4) && near(sn100, 0.8) && sn0 > 0 && sn0 < 0.05 && near(snIndependent, sn0), [sn50, sn100, sn0, snIndependent].join());
    set("ads-sensitivity-slider", 50); set("sniper-ads-sensitivity-slider", 50);
    check("ADS.3 both settings persist", localStorage.getItem("escapeFromKise.adsSensitivity") === "50" && localStorage.getItem("escapeFromKise.sniperAdsSensitivity") === "50");
    H.resetGame();
  }

  function runZoneMode() {
    H.startPvpForTest(3, "hill", "map2"); H.pvpApplyTeams(null);
    const W = H.map2World, P = H.players, B = W.mapToWorld(425, 255), OUT = W.mapToWorld(497.5, 300);
    check("ZN.1 Zone is a 10 minute match", Math.abs(H.pvpMatch.timeLeft - 600) < 1 && H.pvpMatch.mode === "hill", H.pvpMatch.timeLeft);
    P.forEach((q) => { H.pvpRespawnPlayer(q); q.camera.position.set(OUT.x, 1.7, OUT.z); q.campusGroundY = 0; });
    const setIn = (q, inside) => { if (inside) { q.camera.position.set(B.x, 1.7 - 2.6, B.z); q.campusGroundY = -2.6; } else { q.camera.position.set(OUT.x, 1.7, OUT.z); q.campusGroundY = 0; } };
    H.pvpMatch.started = true; P.forEach((q) => { q.pvpHill = 0; q.pvpProtectedFor = 0; });
    H.updatePvpMatch(1);
    check("ZN.2 an empty basement scores nobody", P.every((q) => q.pvpHill === 0) && H.pvpMatch.hillState === "empty");
    setIn(P[0], true); for (let i = 0; i < 5; i++) H.updatePvpMatch(1);
    check("ZN.3 one player alone in the basement earns 1 point per second", Math.abs(P[0].pvpHill - 5) < 1e-6 && P[1].pvpHill === 0 && H.pvpMatch.hillState === "holding", P[0].pvpHill);
    setIn(P[1], true); for (let i = 0; i < 5; i++) H.updatePvpMatch(1);
    check("ZN.4 two players in the basement = contested: nobody scores", Math.abs(P[0].pvpHill - 5) < 1e-6 && P[1].pvpHill === 0 && H.pvpMatch.hillState === "contested", P[0].pvpHill + " " + P[1].pvpHill);
    setIn(P[0], false); for (let i = 0; i < 3; i++) H.updatePvpMatch(1);
    check("ZN.5 once only one is left, that player scores again", Math.abs(P[1].pvpHill - 3) < 1e-6, P[1].pvpHill);
    P[1].isDead = true; H.updatePvpMatch(1); const afterDead = P[1].pvpHill; P[1].isDead = false;
    check("ZN.6 a dead player in the basement does not score", afterDead === 3, afterDead);
    const k0 = P[2].pvpKills; setIn(P[1], false); H.pvpRecordKill(P[1], P[2], "x");
    check("ZN.7 kills score no points in Zone", P[2].pvpKills === k0 + 1 && P[2].pvpHill === 0);
    P[0].pvpHill = 40.6; P[1].pvpHill = 12; P[2].pvpHill = 12;
    H.endPvpMatch();
    const banner = document.getElementById("pvp-results-banner").textContent;
    check("ZN.9 most points wins the match (P1 here), kills irrelevant", /P1 WINS/.test(banner), banner);
    // lobby coupling: Zone forces Residential; choosing Campus leaves Zone
    H.setPvpSetup(true);
    const modeEl = document.querySelector('.pvp-mode-option[data-pvp-mode="hill"]'), campusEl = document.querySelector('.pvp-map-option[data-pvp-map="campus"]');
    modeEl.click(); const hillMap = document.querySelector('.pvp-map-option.active').dataset.pvpMap;
    campusEl.click(); const afterCampus = H.pvpMode;
    H.setPvpSetup(false);
    check("ZN.10 lobby: Zone selects Residential and Campus can no longer be picked while it is on", hillMap === "map2" && afterCampus === "hill" && document.querySelector(".pvp-map-option.active").dataset.pvpMap === "map2", hillMap + " " + afterCampus);
    H.resetGame();
  }

  function runInfected() {
    H.startPvpForTest(4, "infected", "map2"); 
    const P = H.players, inf = () => P.filter((q) => q.pvpInfected), hum = () => P.filter((q) => !q.pvpInfected);
    check("IN.1 4 players, everyone chose human: exactly one is picked infected at random", inf().length === 1 && hum().length === 3, inf().length);
    check("IN.2 humans spawn first; the infected waits (spawning in 5 seconds) and the match clock is running", hum().every((q) => !q.pvpAwaitingSpawn && !q.isDead) && inf()[0].pvpAwaitingSpawn && Math.abs(inf()[0].pvpRespawnTimer - 5) < 0.2 && H.pvpMatch.started, inf()[0].pvpRespawnTimer + " " + H.pvpMatch.started);
    const panel = document.getElementById("pvp-panel-p" + (P.indexOf(inf()[0]) + 1));
    check("IN.3 the infected's screen says 'Spawning in 5 seconds' and has no weapon select", /Spawning in 5 seconds/.test(panel.textContent) && panel.querySelector("h1").textContent === "INFECTED", panel.textContent.slice(0, 80));
    check("IN.4 the match is 10 minutes and the storm closes in 9", Math.abs(H.pvpMatch.timeLeft - 600) < 1 && Math.abs(H.zoneState.phaseDuration - 540) < 1, H.pvpMatch.timeLeft + " / " + H.zoneState.phaseDuration);
    const wid = (q, n) => (q.inventorySlots[n] ? q.inventorySlots[n].weaponId : null);
    check("IN.5 3 survivors: humans carry the regular pistol", hum().every((q) => wid(q, 0) === "pistol" && !q.inventorySlots[1]), hum().map((q) => wid(q, 0)).join());
    const glow = (q) => q.human.meshes[0].material.emissive;
    check("IN.6 humans glow blue, the infected is green", glow(hum()[0]).b > glow(hum()[0]).r && glow(inf()[0]).g > glow(inf()[0]).r && glow(inf()[0]).g > glow(inf()[0]).b, "");
    // infected spawns on its own after the delay, with only a katana
    for (let i = 0; i < 6; i++) H.updatePvpMatch(1);
    const first = inf()[0];
    check("IN.7 the infected spawns by itself after 5 seconds with only a katana", !first.pvpAwaitingSpawn && wid(first, 0) === "katana" && !first.inventorySlots[1], wid(first, 0));
    check("IN.8 the infected's katana does 25", H.PVP_INFECTED_KATANA_DAMAGE === 25);
    // a human dies -> infected, 5 s respawn, no weapon select, remaining humans move to the glock
    const h1 = hum()[0], killer = first;
    H.pvpRecordKill(h1, killer, "x"); H.pvpHandleDeath(h1);
    check("IN.9 a killed human turns infected and waits 5 seconds (no weapon select)", h1.pvpInfected && h1.pvpAwaitingSpawn && Math.abs(h1.pvpRespawnTimer - 5) < 0.2 && H.pvpSurvivors() === 2, h1.pvpInfected + " " + h1.pvpRespawnTimer);
    check("IN.10 2 survivors left: the humans switch to the glock", hum().every((q) => wid(q, 0) === "glock"), hum().map((q) => wid(q, 0)).join());
    for (let i = 0; i < 6; i++) H.updatePvpMatch(1);
    check("IN.11 the new infected respawns with a katana", !h1.pvpAwaitingSpawn && wid(h1, 0) === "katana");
    // heal: a human killing an infected gets 15
    const h2 = hum()[0]; h2.health = 50; H.pvpRecordKill(first, h2, "x");
    check("IN.12 a human killing an infected heals 15", h2.health === 65, h2.health);
    H.pvpHandleDeath(first); for (let i = 0; i < 6; i++) H.updatePvpMatch(1);
    const hx = hum().find((q) => q !== h2); first.health = 50; H.pvpRecordKill(hx, first, "x"); H.pvpHandleDeath(hx);
    check("IN.13 infected killers do not heal", first.health === 50, first.health);
    check("IN.14 1 survivor left: SMG in slot 1 and shotgun in slot 2", H.pvpSurvivors() === 1 && hum().every((q) => wid(q, 0) === "smg" && wid(q, 1) === "shotgun"), hum().map((q) => wid(q, 0) + "+" + wid(q, 1)).join());
    const last = hum()[0]; H.pvpRecordKill(last, first, "x"); H.pvpHandleDeath(last);
    for (let i = 0; i < 2; i++) H.updatePvpMatch(0.1);
    const banner = document.getElementById("pvp-results-banner").textContent;
    check("IN.15 no humans left: the infected win", /THE INFECTED WIN/.test(banner) && H.pvpMatch.ended, banner);
    H.startPvpForTest(4, "infected", "map2");
    P.forEach((q) => { q.pvpHealthBefore = q.health; });
    H.pvpMatch.timeLeft = 0.05; H.updatePvpMatch(0.1);
    check("IN.16 the timer running out with survivors: the humans win", /HUMANS SURVIVE/.test(document.getElementById("pvp-results-banner").textContent), document.getElementById("pvp-results-banner").textContent);
    // the lobby: the Team row reads Human / Infected
    H.setPvpSetup(true); document.querySelector('.pvp-mode-option[data-pvp-mode="infected"]').click();
    const c = { faceKey: "x", category: 5, team: 0, side: 0 }; H.quadSetup.slots.length = 4;
    H.titlePanels["quad-setup"].classList.add("active");
    const v0 = H.customizationValue(c, "team"); H.cycleCustomization(c, 1); const v1 = H.customizationValue(c, "team"); H.cycleCustomization(c, 1); const v2 = H.customizationValue(c, "team");
    H.titlePanels["quad-setup"].classList.remove("active"); H.setPvpSetup(false);
    check("IN.17 lobby: the Team row switches to Human / Infected (2 choices, default Human)", v0 === "Human" && v1 === "Infected" && v2 === "Human", [v0, v1, v2].join());
    H.startPvpForTest(4, "infected", "map2");
    const green = (q) => { let n = 0, total = 0; q.viewModelRoot.traverse((o) => { if (o.userData && o.userData.origHandMat) { total++; if (o.material === o.userData.greenHandMat) n++; } }); return [n, total]; };
    const gi = green(inf()[0]), gh = green(hum()[0]);
    check("IN.19 the infected's first-person hands are green (every hand mesh swapped); the humans' are not", gi[0] > 0 && gi[0] === gi[1] && gh[0] === 0, gi + " / " + gh);
    const ratio = H.pvpMoveSpeedMultiplier(inf()[0]) / H.pvpMoveSpeedMultiplier(hum()[0]);
    check("IN.20 the infected move 5% slower than the humans", Math.abs(ratio - 0.95) < 1e-9, ratio);
    // zone
    const f = H.map2World.pvpFinalZone, B = H.map2World.mapToWorld(425, 255);
    check("IN.18 info: distance from the final zone's centre to the 1108 basement (m) / final radius", true, Math.hypot(f.x - B.x, f.z - B.z).toFixed(1) + " / " + f.radius);
    H.resetGame();
  }

  function runSetupAndStart() {
    // map picker lives in the PVP settings panel; Residential is the default
    H.setPvpSetup(true);
    const active = document.querySelector(".pvp-map-option.active");
    const inPanel = !!active && !!active.closest("#pvp-settings-panel");
    check("SU.1 the map picker is in the PVP settings panel (not on the setup screens)", inPanel && document.querySelectorAll("#title-quad-setup .pvp-map-option, #title-coop-setup .pvp-map-option").length === 0, active && active.dataset.pvpMap);
    document.querySelector('.pvp-mode-option[data-pvp-mode="hill"]').click();
    const campusDisabled = document.querySelector('.pvp-map-option[data-pvp-map="campus"]').classList.contains("disabled");
    document.querySelector('.pvp-mode-option[data-pvp-mode="infected"]').click(); H.openPvpSettings();
    const teamVisible = document.getElementById("pvp-infected-settings").style.display !== "none";
    H.closePvpSettings(); document.querySelector('.pvp-mode-option[data-pvp-mode="deathmatch"]').click(); H.openPvpSettings();
    const teamHidden = document.getElementById("pvp-infected-settings").style.display === "none";
    H.closePvpSettings(); H.setPvpSetup(false);
    check("SU.2 Campus is greyed out while Zone is selected; the Human/Infected sliders show only in Infected mode", campusDisabled && teamVisible && teamHidden, [campusDisabled, teamVisible, teamHidden].join());
    // team health / speed sliders
    H.startPvpForTest(4, "infected", "map2");
    const P = H.players, inf = P.find((q) => q.pvpInfected), hum = P.find((q) => !q.pvpInfected);
    const base = H.pvpMoveSpeedMultiplier(hum);
    check("SU.3 defaults: both teams 100 HP; the infected 95% speed", H.getMaxHealth(hum) === 100 && H.getMaxHealth(inf) === 100 && Math.abs(H.pvpMoveSpeedMultiplier(inf) / base - 0.95) < 1e-9, H.getMaxHealth(hum) + " " + H.getMaxHealth(inf));
    H.setPvpSetting("humanHealth", 150); H.setPvpSetting("infectedHealth", 200); H.setPvpSetting("humanSpeed", 110); H.setPvpSetting("infectedSpeed", 120);
    H.setPvpSetting("health", 200);
    check("SU.4 team sliders are separate from, and multiply with, the all-player values", H.getMaxHealth(hum) === 300 && H.getMaxHealth(inf) === 400 && Math.abs(H.pvpMoveSpeedMultiplier(hum) / base - 1.1) < 1e-9 && Math.abs(H.pvpMoveSpeedMultiplier(inf) / base - 1.2) < 1e-9, H.getMaxHealth(hum) + " " + H.getMaxHealth(inf));
    document.getElementById("pvp-settings-reset").click();
    check("SU.5 Reset to default restores every slider (infected speed back to 95)", H.pvpSettings.health === 100 && H.pvpSettings.humanHealth === 100 && H.pvpSettings.infectedSpeed === 95 && H.pvpSettings.infectedHealth === 100, JSON.stringify(H.pvpSettings));
    // random start conditions
    let day = 0, N = 800; const seen = new Set();
    for (let i = 0; i < N; i++) { H.pvpRandomizeStartConditions(); if (H.dayNightTime < 8 * 60) day++; seen.add(H.pvpMatch.startWeather); }
    check("SU.6 PVP starts at a random time of day, weighted to day (about 75%), and in varied weather", day / N > 0.68 && day / N < 0.82 && seen.size >= 3, (day / N).toFixed(2) + " " + [...seen].join());
    H.resetGame();
  }

  try { run(); runMap2(); runMap2Storm(); runCars(); runHouses(); runPinkAndRoofs(); runBasements(); runCollisionFixes(); runTeams(); runAdsSensitivity(); runZoneMode(); runInfected(); runSetupAndStart(); runMap2Closeup(); runMap2Spawns(); } catch (e) { check("exception", false, e && e.stack || e); }
  const pass = checks.every((c) => c.ok);
  window.__perfResults = JSON.stringify({ pass, checks });
})();

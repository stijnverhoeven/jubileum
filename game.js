(() => {
  'use strict';

  // ---------- Grid / path setup ----------
  const CELL = 40;
  const COLS = 20;
  const ROWS = 13;

  // Waypoints in grid coordinates (col, row); path zigzags across the map.
  const WAYPOINTS_GRID = [
    [0, 6], [4, 6], [4, 10], [9, 10], [9, 2], [14, 2], [14, 6], [19, 6],
  ];

  function gridToPx([c, r]) {
    return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
  }

  const WAYPOINTS = WAYPOINTS_GRID.map(gridToPx);

  // Build the set of grid cells the path occupies, so towers can't be placed there.
  const PATH_CELLS = new Set();
  for (let i = 0; i < WAYPOINTS_GRID.length - 1; i++) {
    let [c1, r1] = WAYPOINTS_GRID[i];
    const [c2, r2] = WAYPOINTS_GRID[i + 1];
    PATH_CELLS.add(`${c1},${r1}`);
    while (c1 !== c2 || r1 !== r2) {
      if (c1 !== c2) c1 += c1 < c2 ? 1 : -1;
      else r1 += r1 < r2 ? 1 : -1;
      PATH_CELLS.add(`${c1},${r1}`);
    }
  }
  // Widen path visually by one cell perpendicular is skipped for simplicity.

  // ---------- Config ----------
  const TOWER_TYPES = {
    basic: {
      key: 'basic', name: 'Boogschutter', cost: 50, color: '#4da3ff',
      damage: 10, range: 110, rate: 1.2, projectileSpeed: 420, splash: 0,
      desc: 'Snel, allround',
    },
    cannon: {
      key: 'cannon', name: 'Kanon', cost: 120, color: '#ff9f43',
      damage: 22, range: 95, rate: 0.75, projectileSpeed: 300, splash: 55,
      desc: 'Gebied-schade',
    },
    sniper: {
      key: 'sniper', name: 'Sluipschutter', cost: 110, color: '#a05bff',
      damage: 45, range: 220, rate: 0.55, projectileSpeed: 650, splash: 0,
      desc: 'Groot bereik, hoge schade',
    },
    frost: {
      key: 'frost', name: 'Vrieskanon', cost: 85, color: '#48e0e0',
      damage: 4, range: 100, rate: 1.1, projectileSpeed: 500, splash: 0,
      slowFactor: 0.5, slowDuration: 1.6,
      desc: 'Vertraagt vijanden',
    },
  };

  const ENEMY_TYPES = {
    normal: { key: 'normal', hp: 40, speed: 60, reward: 8, radius: 12, color: '#4caf50' },
    fast: { key: 'fast', hp: 24, speed: 115, reward: 10, radius: 10, color: '#ffd54f' },
    tank: { key: 'tank', hp: 170, speed: 34, reward: 22, radius: 15, color: '#e05353' },
    boss: { key: 'boss', hp: 900, speed: 38, reward: 120, radius: 20, color: '#7a1f1f' },
  };

  const MAX_WAVE = 20;
  const START_GOLD = 150;
  const START_LIVES = 20;

  // ---------- Wave generation ----------
  function generateWave(waveNum) {
    const enemies = [];
    const isBossWave = waveNum % 5 === 0;
    const hpMult = 1 + waveNum * 0.16;
    const speedMult = 1 + waveNum * 0.01;

    const scale = (type) => ({
      ...ENEMY_TYPES[type],
      hp: Math.round(ENEMY_TYPES[type].hp * hpMult),
      speed: ENEMY_TYPES[type].speed * speedMult,
    });

    const count = 6 + Math.floor(waveNum * 1.3);
    for (let i = 0; i < count; i++) {
      let type = 'normal';
      if (waveNum >= 3 && i % 4 === 1) type = 'fast';
      if (waveNum >= 5 && i % 5 === 3) type = 'tank';
      enemies.push({ type: scale(type), delay: i * 0.7 });
    }
    if (isBossWave) {
      enemies.push({ type: scale('boss'), delay: count * 0.7 + 1.5 });
    }
    return enemies;
  }

  // ---------- Entities ----------
  let nextId = 1;

  class Enemy {
    constructor(spec) {
      this.id = nextId++;
      this.key = spec.key;
      this.hp = spec.hp;
      this.maxHp = spec.hp;
      this.speed = spec.speed;
      this.baseSpeed = spec.speed;
      this.reward = spec.reward;
      this.radius = spec.radius;
      this.color = spec.color;
      this.wpIndex = 0;
      const start = WAYPOINTS[0];
      this.x = start.x;
      this.y = start.y;
      this.distanceTraveled = 0;
      this.slowTimer = 0;
      this.dead = false;
      this.reachedEnd = false;
    }

    update(dt) {
      if (this.slowTimer > 0) {
        this.slowTimer -= dt;
        this.speed = this.baseSpeed * (this.slowTimer > 0 ? this.slowFactorActive : 1);
        if (this.slowTimer <= 0) this.speed = this.baseSpeed;
      }
      const target = WAYPOINTS[this.wpIndex + 1];
      if (!target) { this.reachedEnd = true; return; }
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      const move = this.speed * dt;
      if (move >= dist) {
        this.x = target.x;
        this.y = target.y;
        this.distanceTraveled += dist;
        this.wpIndex++;
        if (this.wpIndex + 1 >= WAYPOINTS.length) {
          this.reachedEnd = true;
        }
      } else {
        this.x += (dx / dist) * move;
        this.y += (dy / dist) * move;
        this.distanceTraveled += move;
      }
    }

    applySlow(factor, duration) {
      this.slowFactorActive = factor;
      this.slowTimer = Math.max(this.slowTimer, duration);
    }

    takeDamage(dmg) {
      this.hp -= dmg;
      if (this.hp <= 0) this.dead = true;
    }
  }

  class Projectile {
    constructor(x, y, target, tower) {
      this.x = x;
      this.y = y;
      this.target = target;
      this.tower = tower;
      this.speed = tower.type.projectileSpeed;
      this.done = false;
    }

    update(dt) {
      if (this.target.dead || this.target.reachedEnd) { this.done = true; return; }
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const dist = Math.hypot(dx, dy);
      const move = this.speed * dt;
      if (move >= dist) {
        this.hit();
      } else {
        this.x += (dx / dist) * move;
        this.y += (dy / dist) * move;
      }
    }

    hit() {
      this.done = true;
      const type = this.tower.type;
      if (type.splash > 0) {
        for (const e of game.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - this.target.x, e.y - this.target.y) <= type.splash) {
            game.damageEnemy(e, this.tower.damage);
          }
        }
      } else {
        game.damageEnemy(this.target, this.tower.damage);
      }
      if (type.slowFactor && !this.target.dead) {
        this.target.applySlow(type.slowFactor, type.slowDuration);
      }
    }
  }

  class Tower {
    constructor(typeKey, col, row) {
      this.id = nextId++;
      this.typeKey = typeKey;
      this.type = TOWER_TYPES[typeKey];
      this.col = col;
      this.row = row;
      const p = gridToPx([col, row]);
      this.x = p.x;
      this.y = p.y;
      this.level = 1;
      this.cooldown = 0;
      this.angle = 0;
      this.totalInvested = this.type.cost;
      this.recalcStats();
    }

    recalcStats() {
      const lvlMult = 1 + (this.level - 1) * 0.5;
      const rangeMult = 1 + (this.level - 1) * 0.12;
      const rateMult = 1 + (this.level - 1) * 0.15;
      this.damage = this.type.damage * lvlMult;
      this.range = this.type.range * rangeMult;
      this.rate = this.type.rate * rateMult;
    }

    upgradeCost() {
      return Math.round(this.type.cost * 0.7 * this.level);
    }

    sellValue() {
      return Math.round(this.totalInvested * 0.6);
    }

    findTarget(enemies) {
      let best = null;
      let bestDist = -1;
      for (const e of enemies) {
        if (e.dead || e.reachedEnd) continue;
        const d = Math.hypot(e.x - this.x, e.y - this.y);
        if (d <= this.range && e.distanceTraveled > bestDist) {
          bestDist = e.distanceTraveled;
          best = e;
        }
      }
      return best;
    }

    update(dt, enemies, projectiles) {
      this.cooldown -= dt;
      const target = this.findTarget(enemies);
      if (target) {
        this.angle = Math.atan2(target.y - this.y, target.x - this.x);
      }
      if (target && this.cooldown <= 0) {
        this.cooldown = 1 / this.rate;
        projectiles.push(new Projectile(this.x, this.y, target, this));
      }
    }
  }

  // ---------- Game ----------
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const goldEl = document.getElementById('gold');
  const livesEl = document.getElementById('lives');
  const waveEl = document.getElementById('wave');
  const waveMaxEl = document.getElementById('wave-max');
  const statusEl = document.getElementById('stat-status');
  const startWaveBtn = document.getElementById('start-wave-btn');
  const speedBtn = document.getElementById('speed-btn');
  const shopEl = document.getElementById('tower-shop');
  const infoEl = document.getElementById('tower-info');
  const tiName = document.getElementById('ti-name');
  const tiStats = document.getElementById('ti-stats');
  const tiUpgrade = document.getElementById('ti-upgrade');
  const tiSell = document.getElementById('ti-sell');
  const tiClose = document.getElementById('ti-close');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayMsg = document.getElementById('overlay-msg');
  const overlayRestart = document.getElementById('overlay-restart');

  const game = {
    gold: START_GOLD,
    lives: START_LIVES,
    waveNum: 0,
    towers: [],
    enemies: [],
    projectiles: [],
    selectedTowerType: null,
    selectedTower: null,
    hoverCell: null,
    waveActive: false,
    spawnQueue: [],
    spawnTimer: 0,
    speedMult: 1,
    over: false,

    damageEnemy(enemy, dmg) {
      if (enemy.dead) return;
      enemy.takeDamage(dmg);
      if (enemy.dead) {
        this.gold += enemy.reward;
        updateHud();
      }
    },

    isPathCell(c, r) {
      return PATH_CELLS.has(`${c},${r}`);
    },

    towerAt(c, r) {
      return this.towers.find((t) => t.col === c && t.row === r);
    },

    canPlace(c, r) {
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
      if (this.isPathCell(c, r)) return false;
      if (this.towerAt(c, r)) return false;
      return true;
    },

    placeTower(typeKey, c, r) {
      const type = TOWER_TYPES[typeKey];
      if (!this.canPlace(c, r)) return false;
      if (this.gold < type.cost) return false;
      this.gold -= type.cost;
      this.towers.push(new Tower(typeKey, c, r));
      updateHud();
      return true;
    },

    startWave() {
      if (this.waveActive || this.over) return;
      this.waveNum++;
      if (this.waveNum > MAX_WAVE) return;
      this.spawnQueue = generateWave(this.waveNum);
      this.spawnTimer = 0;
      this.waveActive = true;
      updateHud();
    },

    update(dt) {
      if (this.over) return;
      dt *= this.speedMult;

      if (this.waveActive) {
        this.spawnTimer += dt;
        while (this.spawnQueue.length && this.spawnQueue[0].delay <= this.spawnTimer) {
          const spec = this.spawnQueue.shift();
          this.enemies.push(new Enemy(spec.type));
        }
        if (!this.spawnQueue.length && this.enemies.every((e) => e.dead || e.reachedEnd)) {
          this.waveActive = false;
          if (this.waveNum >= MAX_WAVE) {
            this.win();
          }
        }
      }

      for (const t of this.towers) t.update(dt, this.enemies, this.projectiles);
      for (const p of this.projectiles) p.update(dt);
      this.projectiles = this.projectiles.filter((p) => !p.done);

      for (const e of this.enemies) {
        if (e.dead || e.reachedEnd) continue;
        e.update(dt);
        if (e.reachedEnd) {
          this.lives -= e.key === 'boss' ? 5 : 1;
          if (this.lives <= 0) {
            this.lives = 0;
            this.lose();
          }
        }
      }
      this.enemies = this.enemies.filter((e) => !e.dead && !e.reachedEnd);
      updateHud();
    },

    win() {
      this.over = true;
      showOverlay('Overwinning!', `Je hebt alle ${MAX_WAVE} golven overleefd. Goed gespeeld!`);
    },

    lose() {
      this.over = true;
      showOverlay('Game Over', `Je hebt het gehaald tot golf ${this.waveNum}.`);
    },
  };

  function showOverlay(title, msg) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    overlay.classList.remove('hidden');
  }

  function resetGame() {
    game.gold = START_GOLD;
    game.lives = START_LIVES;
    game.waveNum = 0;
    game.towers = [];
    game.enemies = [];
    game.projectiles = [];
    game.selectedTowerType = null;
    game.selectedTower = null;
    game.waveActive = false;
    game.spawnQueue = [];
    game.over = false;
    overlay.classList.add('hidden');
    infoEl.classList.add('hidden');
    updateHud();
  }

  // ---------- Rendering ----------
  function drawGrid() {
    ctx.fillStyle = '#4c7a3d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // path
    ctx.fillStyle = '#c9b285';
    for (const key of PATH_CELLS) {
      const [c, r] = key.split(',').map(Number);
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }

    // subtle grid lines
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, ROWS * CELL);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(COLS * CELL, r * CELL);
      ctx.stroke();
    }

    // hover highlight
    if (game.hoverCell && game.selectedTowerType) {
      const [c, r] = game.hoverCell;
      const ok = game.canPlace(c, r) && game.gold >= TOWER_TYPES[game.selectedTowerType].cost;
      ctx.fillStyle = ok ? 'rgba(80,220,120,0.45)' : 'rgba(220,80,80,0.45)';
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      if (ok) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(c * CELL + CELL / 2, r * CELL + CELL / 2, TOWER_TYPES[game.selectedTowerType].range, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawTowers() {
    for (const t of game.towers) {
      if (game.selectedTower === t) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
        ctx.stroke();
      }
      // base
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.arc(t.x, t.y, 15, 0, Math.PI * 2);
      ctx.fill();
      // body
      ctx.fillStyle = t.type.color;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 12, 0, Math.PI * 2);
      ctx.fill();
      // barrel
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + Math.cos(t.angle) * 16, t.y + Math.sin(t.angle) * 16);
      ctx.stroke();
      // level dots
      for (let i = 0; i < t.level; i++) {
        ctx.fillStyle = '#ffcf5c';
        ctx.beginPath();
        ctx.arc(t.x - 10 + i * 6, t.y + 18, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawEnemies() {
    for (const e of game.enemies) {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      if (e.slowTimer > 0) {
        ctx.strokeStyle = '#48e0e0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      // hp bar
      const w = e.radius * 2;
      const pct = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(e.x - w / 2, e.y - e.radius - 9, w, 5);
      ctx.fillStyle = pct > 0.4 ? '#4caf50' : '#e05353';
      ctx.fillRect(e.x - w / 2, e.y - e.radius - 9, w * pct, 5);
    }
  }

  function drawProjectiles() {
    for (const p of game.projectiles) {
      ctx.fillStyle = p.tower.type.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render() {
    drawGrid();
    drawTowers();
    drawEnemies();
    drawProjectiles();
  }

  // ---------- HUD / UI ----------
  function updateHud() {
    goldEl.textContent = Math.floor(game.gold);
    livesEl.textContent = game.lives;
    waveEl.textContent = Math.min(game.waveNum, MAX_WAVE);
    waveMaxEl.textContent = MAX_WAVE;
    startWaveBtn.disabled = game.waveActive || game.over || game.waveNum >= MAX_WAVE;
    statusEl.textContent = game.waveActive ? 'Golf bezig...' : (game.over ? '' : 'Klaar voor volgende golf');
    updateShopState();
    if (game.selectedTower) renderTowerInfo(game.selectedTower);
  }

  // Built once; only classes are toggled afterwards so the DOM stays stable
  // for hover/click interaction instead of being torn down every frame.
  const shopOptionEls = {};
  function buildShop() {
    shopEl.innerHTML = '';
    for (const key of Object.keys(TOWER_TYPES)) {
      const type = TOWER_TYPES[key];
      const div = document.createElement('div');
      div.className = 'tower-option';
      div.innerHTML = `
        <div class="tower-swatch" style="background:${type.color}"></div>
        <div class="tower-option-text">
          <div class="tower-option-name">${type.name}</div>
          <div class="tower-option-cost">${type.cost} goud</div>
          <div class="tower-option-desc">${type.desc}</div>
        </div>`;
      div.addEventListener('click', () => {
        game.selectedTower = null;
        infoEl.classList.add('hidden');
        game.selectedTowerType = game.selectedTowerType === key ? null : key;
        updateShopState();
      });
      shopEl.appendChild(div);
      shopOptionEls[key] = div;
    }
  }

  function updateShopState() {
    for (const key of Object.keys(TOWER_TYPES)) {
      const div = shopOptionEls[key];
      if (!div) continue;
      div.classList.toggle('selected', game.selectedTowerType === key);
      div.classList.toggle('disabled', game.gold < TOWER_TYPES[key].cost);
    }
  }

  function renderTowerInfo(tower) {
    infoEl.classList.remove('hidden');
    tiName.textContent = `${tower.type.name} (Lv. ${tower.level})`;
    tiStats.innerHTML = `
      Schade: ${tower.damage.toFixed(1)}<br>
      Bereik: ${tower.range.toFixed(0)}<br>
      Snelheid: ${tower.rate.toFixed(2)}/s
    `;
    const upCost = tower.upgradeCost();
    tiUpgrade.textContent = `Upgrade (${upCost} goud)`;
    tiUpgrade.disabled = game.gold < upCost || tower.level >= 5;
    if (tower.level >= 5) tiUpgrade.textContent = 'Max niveau';
    tiSell.textContent = `Verkoop (+${tower.sellValue()} goud)`;
  }

  tiUpgrade.addEventListener('click', () => {
    const t = game.selectedTower;
    if (!t) return;
    const cost = t.upgradeCost();
    if (game.gold < cost || t.level >= 5) return;
    game.gold -= cost;
    t.totalInvested += cost;
    t.level++;
    t.recalcStats();
    updateHud();
  });

  tiSell.addEventListener('click', () => {
    const t = game.selectedTower;
    if (!t) return;
    game.gold += t.sellValue();
    game.towers = game.towers.filter((x) => x !== t);
    game.selectedTower = null;
    infoEl.classList.add('hidden');
    updateHud();
  });

  tiClose.addEventListener('click', () => {
    game.selectedTower = null;
    infoEl.classList.add('hidden');
  });

  startWaveBtn.addEventListener('click', () => game.startWave());

  speedBtn.addEventListener('click', () => {
    game.speedMult = game.speedMult === 1 ? 2 : 1;
    speedBtn.textContent = `${game.speedMult}x`;
  });

  overlayRestart.addEventListener('click', resetGame);

  // ---------- Canvas interaction ----------
  function cellFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (evt.clientX - rect.left) * scaleX;
    const y = (evt.clientY - rect.top) * scaleY;
    return { col: Math.floor(x / CELL), row: Math.floor(y / CELL), x, y };
  }

  canvas.addEventListener('mousemove', (evt) => {
    const { col, row } = cellFromEvent(evt);
    game.hoverCell = [col, row];
  });

  canvas.addEventListener('mouseleave', () => { game.hoverCell = null; });

  canvas.addEventListener('click', (evt) => {
    if (game.over) return;
    const { col, row, x, y } = cellFromEvent(evt);

    // clicking an existing tower always inspects it, even while a shop item is selected.
    let clicked = null;
    for (const t of game.towers) {
      if (Math.hypot(t.x - x, t.y - y) <= 15) { clicked = t; break; }
    }
    if (clicked) {
      game.selectedTowerType = null;
      updateShopState();
      game.selectedTower = clicked;
      renderTowerInfo(clicked);
      return;
    }

    if (game.selectedTowerType) {
      const placed = game.placeTower(game.selectedTowerType, col, row);
      if (placed) {
        game.selectedTowerType = null;
        updateShopState();
      }
      return;
    }

    game.selectedTower = null;
    infoEl.classList.add('hidden');
  });

  // ---------- Main loop ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    game.update(dt);
    render();
    requestAnimationFrame(loop);
  }

  buildShop();
  updateHud();
  requestAnimationFrame(loop);
})();

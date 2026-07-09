(() => {
  const joinScreen = document.getElementById('joinScreen');
  const gameScreen = document.getElementById('gameScreen');
  const startedScreen = document.getElementById('startedScreen');
  const nameInput = document.getElementById('nameInput');
  const joinBtn = document.getElementById('joinBtn');
  const joinError = document.getElementById('joinError');
  const countdownEl = document.getElementById('countdown');
  const rosterEl = document.getElementById('roster');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const joystickBase = document.getElementById('joystickBase');
  const joystickKnob = document.getElementById('joystickKnob');
  const interactBtn = document.getElementById('interactBtn');

  const socket = io();
  let myId = null;
  let seats = []; // [{x,y,type,wheel,pedal,index}]
  let dogCarrier = null;
  let latestState = { players: [], gameState: 'lobby', countdownValue: 0 };
  const SEAT_RADIUS = 60;
  const PLAYER_RADIUS = 18;
  const SEAT_LABELS = ['basket', 'front-left', 'front-center', 'front-right', 'back-left'];

  // Everything is drawn in world coordinates, then the whole scene is scaled
  // down onto a small backing canvas and blown back up with nearest-neighbor
  // scaling (CSS `image-rendering: pixelated`) for a chunky pixel-art look.
  const PIXEL_SCALE = 4;
  let worldW = 700, worldH = 680;

  function showScreen(el) {
    [joinScreen, gameScreen, startedScreen].forEach(s => s.classList.add('hidden'));
    el.classList.remove('hidden');
  }

  function join() {
    const name = nameInput.value.trim() || 'Player';
    joinError.textContent = '';
    socket.emit('join', { name });
  }

  joinBtn.addEventListener('click', join);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') join();
  });

  socket.on('joinRejected', ({ reason }) => {
    joinError.textContent = reason;
  });

  socket.on('joined', ({ id, seats: seatData, dogCarrier: carrier, canvas: dims }) => {
    myId = id;
    seats = seatData.map((s, i) => ({ ...s, index: i }));
    dogCarrier = carrier;
    if (dims) {
      worldW = dims.w;
      worldH = dims.h;
      canvas.width = Math.round(worldW / PIXEL_SCALE);
      canvas.height = Math.round(worldH / PIXEL_SCALE);
      canvas.style.aspectRatio = `${worldW} / ${worldH}`;
      ctx.imageSmoothingEnabled = false;
    }
    showScreen(gameScreen);
  });

  socket.on('state', state => {
    latestState = state;
    updateRoster();
    if (state.gameState === 'countdown') {
      countdownEl.classList.remove('hidden');
      countdownEl.textContent = `All seats full — leaving in ${state.countdownValue}s`;
    } else {
      countdownEl.classList.add('hidden');
    }
  });

  socket.on('gameStarted', () => {
    showScreen(startedScreen);
  });

  function updateRoster() {
    rosterEl.innerHTML = '';
    latestState.players
      .slice()
      .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99))
      .forEach(p => {
        const chip = document.createElement('div');
        chip.className = 'roster-chip';
        const dot = document.createElement('div');
        dot.className = 'roster-dot';
        dot.style.background = p.color;
        const label = document.createElement('span');
        label.textContent = p.name + (p.id === myId ? ' (you)' : '');
        const state = document.createElement('span');
        if (p.seat !== null) {
          state.className = 'roster-seat';
          state.textContent = ` ${SEAT_LABELS[p.seat] || 'seat ' + (p.seat + 1)}`;
        } else {
          state.className = 'roster-standing';
          state.textContent = ' standing';
        }
        chip.appendChild(dot);
        chip.appendChild(label);
        chip.appendChild(state);
        rosterEl.appendChild(chip);
      });
  }

  // --- Input handling (keyboard for desktop, virtual joystick for touch) ---
  const keys = { up: false, down: false, left: false, right: false };
  let lastSent = null;

  function keyToDir(code) {
    switch (code) {
      case 'KeyW': case 'ArrowUp': return 'up';
      case 'KeyS': case 'ArrowDown': return 'down';
      case 'KeyA': case 'ArrowLeft': return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
      default: return null;
    }
  }

  function sendInputIfChanged() {
    const snapshot = `${keys.up}${keys.down}${keys.left}${keys.right}`;
    if (snapshot !== lastSent) {
      lastSent = snapshot;
      socket.emit('input', keys);
    }
  }

  window.addEventListener('keydown', e => {
    if (document.activeElement === nameInput) return;
    const dir = keyToDir(e.code);
    if (dir) {
      keys[dir] = true;
      sendInputIfChanged();
      e.preventDefault();
    } else if (e.code === 'KeyE' || e.code === 'Space') {
      socket.emit('interact');
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', e => {
    const dir = keyToDir(e.code);
    if (dir) {
      keys[dir] = false;
      sendInputIfChanged();
      e.preventDefault();
    }
  });

  // Virtual joystick (pointer events cover touch, mouse and pen uniformly)
  let joystickPointerId = null;

  function updateJoystick(clientX, clientY) {
    const rect = joystickBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const maxDist = rect.width / 2;
    const dist = Math.min(Math.hypot(dx, dy), maxDist);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * dist;
    const ky = Math.sin(angle) * dist;
    joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;

    const deadzone = maxDist * 0.3;
    keys.up = dy < -deadzone;
    keys.down = dy > deadzone;
    keys.left = dx < -deadzone;
    keys.right = dx > deadzone;
    sendInputIfChanged();
  }

  function resetJoystick() {
    joystickPointerId = null;
    joystickKnob.style.transform = 'translate(0px, 0px)';
    keys.up = keys.down = keys.left = keys.right = false;
    sendInputIfChanged();
  }

  joystickBase.addEventListener('pointerdown', e => {
    joystickPointerId = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId);
    updateJoystick(e.clientX, e.clientY);
    e.preventDefault();
  });
  joystickBase.addEventListener('pointermove', e => {
    if (joystickPointerId !== e.pointerId) return;
    updateJoystick(e.clientX, e.clientY);
    e.preventDefault();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => {
    joystickBase.addEventListener(evt, e => {
      if (joystickPointerId !== e.pointerId) return;
      resetJoystick();
    });
  });

  interactBtn.addEventListener('pointerdown', e => {
    socket.emit('interact');
    e.preventDefault();
  });

  // --- Rendering (pixel-art style: flat colors, no gradients/anti-aliasing) ---
  function drawWheel(x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#161616';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#6b6b6b';
    ctx.fill();
    ctx.strokeStyle = '#8f8f8f';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSteeringWheel(x, y) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y + 16);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function highlightRing(seatIndex, seat) {
    const occ = latestState.players.find(p => p.seat === seatIndex);
    const me = latestState.players.find(p => p.id === myId);
    if (!me || me.seat !== null) return;
    const d = Math.hypot(me.x - seat.x, me.y - seat.y);
    if (d >= SEAT_RADIUS) return;
    ctx.beginPath();
    ctx.ellipse(seat.x, seat.y, 34, 24, 0, 0, Math.PI * 2);
    ctx.strokeStyle = occ ? '#ff5252' : '#7ee787';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  function drawSeat(seat) {
    if (seat.pedal) {
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(seat.x - 14, seat.y + 34, 28, 10);
    }

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(seat.x, seat.y, 30, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    highlightRing(seat.index, seat);
    ctx.restore();

    if (seat.wheel) drawSteeringWheel(seat.x, seat.y - 40);
  }

  function drawBasketSeat(seat) {
    ctx.save();
    ctx.strokeStyle = '#b0bec5';
    ctx.lineWidth = 4;
    const w = 76, h = 54;
    ctx.strokeRect(seat.x - w / 2, seat.y - h / 2, w, h);
    for (let i = 1; i < 4; i++) {
      const yy = seat.y - h / 2 + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(seat.x - w / 2, yy);
      ctx.lineTo(seat.x + w / 2, yy);
      ctx.stroke();
    }
    ctx.restore();
    drawSeat(seat);
  }

  // Hand-drawn low-poly Akita face — flat shapes read cleanly once
  // rasterized at the small backing resolution and blown back up.
  function drawAkitaFace(cx, cy) {
    const FUR = '#e0a86a';
    const FUR_DARK = '#c98a48';
    const CREAM = '#f5e2c4';
    ctx.save();
    // ears
    ctx.fillStyle = FUR_DARK;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy - 8);
    ctx.lineTo(cx - 26, cy - 30);
    ctx.lineTo(cx - 8, cy - 16);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 20, cy - 8);
    ctx.lineTo(cx + 26, cy - 30);
    ctx.lineTo(cx + 8, cy - 16);
    ctx.closePath();
    ctx.fill();

    // head
    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();

    // cream muzzle
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // eyes
    ctx.fillStyle = '#241a10';
    ctx.fillRect(cx - 11, cy - 4, 5, 5);
    ctx.fillRect(cx + 6, cy - 4, 5, 5);

    // nose
    ctx.fillRect(cx - 3, cy + 6, 6, 5);
    ctx.restore();
  }

  function drawDogCarrier(pos) {
    ctx.save();
    ctx.fillStyle = '#2b2b2b';
    roundRect(pos.x - 38, pos.y - 30, 76, 60, 8);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#3a3a3a';
    roundRect(pos.x - 26, pos.y - 20, 52, 34, 4);
    ctx.fill();
    ctx.restore();

    drawAkitaFace(pos.x, pos.y - 2);
  }

  function drawBike() {
    if (!seats.length || !dogCarrier) return;
    const basket = seats.find(s => s.type === 'basket');
    const bench = seats.filter(s => s.type === 'bench');
    const backSeat = seats.find(s => s.type === 'back');

    const benchBarY = bench[0].y + 30;
    const backBarY = backSeat.y + 30;
    const benchMinX = Math.min(...bench.map(s => s.x)) - 60;
    const benchMaxX = Math.max(...bench.map(s => s.x)) + 60;
    const backMinX = Math.min(backSeat.x, dogCarrier.x) - 60;
    const backMaxX = Math.max(backSeat.x, dogCarrier.x) + 60;
    const benchCenterX = bench[Math.floor(bench.length / 2)].x;
    const backCenterX = (backSeat.x + dogCarrier.x) / 2;

    ctx.save();
    ctx.strokeStyle = '#c62828';
    ctx.lineCap = 'square';

    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(benchMinX, benchBarY);
    ctx.lineTo(benchMaxX, benchBarY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(backMinX, backBarY);
    ctx.lineTo(backMaxX, backBarY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(benchCenterX, benchBarY);
    ctx.lineTo(backCenterX, backBarY);
    ctx.stroke();

    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(basket.x, basket.y + 20);
    ctx.lineTo(basket.x, benchBarY);
    ctx.stroke();
    bench.forEach(seat => {
      ctx.beginPath();
      ctx.moveTo(seat.x, benchBarY);
      ctx.lineTo(seat.x, seat.y);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(backSeat.x, backBarY);
    ctx.lineTo(backSeat.x, backSeat.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dogCarrier.x, backBarY);
    ctx.lineTo(dogCarrier.x, dogCarrier.y);
    ctx.stroke();
    ctx.restore();

    // wheels: one steerable front wheel above the basket, two rear wheels under the back row
    drawWheel(basket.x, basket.y - 60, 28);
    drawWheel(backSeat.x, backBarY + 50, 32);
    drawWheel(dogCarrier.x, backBarY + 50, 32);

    drawBasketSeat(basket);
    bench.forEach(drawSeat);
    drawSeat(backSeat);
    drawDogCarrier(dogCarrier);
  }

  // Simple top-down pixel character: square torso + head, blocky by design.
  function drawPlayer(p) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(p.x - 12, p.y + 10, 24, 8);

    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 14, p.y - 6, 28, 22);
    ctx.fillRect(p.x - 10, p.y - 20, 20, 16);

    if (p.id === myId) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 14, p.y - 6, 28, 22);
      ctx.strokeRect(p.x - 10, p.y - 20, 20, 16);
    }

    ctx.fillStyle = '#241a10';
    ctx.fillRect(p.x - 6, p.y - 14, 4, 4);
    ctx.fillRect(p.x + 2, p.y - 14, 4, 4);
    ctx.restore();
  }

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(1 / PIXEL_SCALE, 1 / PIXEL_SCALE);

    // ground stripes
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < worldW; x += 60) {
      ctx.fillRect(x, 0, 30, worldH);
    }

    drawBike();
    latestState.players.forEach(drawPlayer);

    ctx.restore();
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();

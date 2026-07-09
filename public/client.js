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

  const socket = io();
  let myId = null;
  let seats = []; // [{x,y,type,wheel,pedal,index}]
  let dogCarrier = null;
  let latestState = { players: [], gameState: 'lobby', countdownValue: 0 };
  const SEAT_RADIUS = 60;
  const PLAYER_RADIUS = 18;
  const SEAT_LABELS = ['basket', 'front-left', 'front-center', 'front-right', 'back-left'];

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
      canvas.width = dims.w;
      canvas.height = dims.h;
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

  // --- Input handling ---
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

  // --- Rendering ---
  function drawWheel(x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#555';
    ctx.fill();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
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
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y + 16);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 3;
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
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawSeat(seat) {
    if (seat.pedal) {
      ctx.fillStyle = '#333';
      ctx.fillRect(seat.x - 14, seat.y + 34, 28, 10);
    }

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
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
    ctx.lineWidth = 3;
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

  function drawDogCarrier(pos) {
    ctx.save();
    ctx.fillStyle = '#2b2b2b';
    roundRect(pos.x - 38, pos.y - 30, 76, 60, 10);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(pos.x - 26, pos.y - 20, 52, 30, 6);
    ctx.fill();

    ctx.font = '34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🐶', pos.x, pos.y - 3);
    ctx.restore();

    ctx.fillStyle = '#d7d7d7';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('dog carrier', pos.x, pos.y + 42);
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
    ctx.lineCap = 'round';

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

  function drawPlayer(p) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    if (p.id === myId) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - PLAYER_RADIUS - 6);
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ground stripes
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < canvas.width; x += 60) {
      ctx.fillRect(x, 0, 30, canvas.height);
    }

    drawBike();
    latestState.players.forEach(drawPlayer);

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();

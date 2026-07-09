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
  let seatPositions = [];
  let latestState = { players: [], gameState: 'lobby', countdownValue: 0 };
  const SEAT_RADIUS = 60;
  const PLAYER_RADIUS = 18;

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

  socket.on('joined', ({ id, seatPositions: seats }) => {
    myId = id;
    seatPositions = seats;
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
          state.textContent = ` seat ${p.seat + 1}`;
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

  function drawBike() {
    if (!seatPositions.length) return;
    const first = seatPositions[0];
    const last = seatPositions[seatPositions.length - 1];
    const frameY = first.y;

    // main frame bar
    ctx.save();
    ctx.strokeStyle = '#c62828';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(first.x - 60, frameY + 30);
    ctx.lineTo(last.x + 60, frameY + 30);
    ctx.stroke();

    // diagonal struts up to each seat
    ctx.lineWidth = 8;
    seatPositions.forEach(seat => {
      ctx.beginPath();
      ctx.moveTo(seat.x, frameY + 30);
      ctx.lineTo(seat.x, seat.y);
      ctx.stroke();
    });
    ctx.restore();

    // wheels at both ends
    drawWheel(first.x - 60, frameY + 30, 34);
    drawWheel(last.x + 60, frameY + 30, 34);

    // seats + pedals + steering wheels
    seatPositions.forEach((seat, i) => {
      // pedal
      ctx.fillStyle = '#333';
      ctx.fillRect(seat.x - 14, seat.y + 34, 28, 10);

      // seat cushion
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const occ = latestState.players.find(p => p.seat === i);
      ctx.beginPath();
      ctx.ellipse(seat.x, seat.y, 30, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!occ) {
        // glow ring if empty and someone standing is close enough to sit
        const me = latestState.players.find(p => p.id === myId);
        if (me && me.seat === null) {
          const d = Math.hypot(me.x - seat.x, me.y - seat.y);
          if (d < SEAT_RADIUS) {
            ctx.beginPath();
            ctx.ellipse(seat.x, seat.y, 34, 24, 0, 0, Math.PI * 2);
            ctx.strokeStyle = '#7ee787';
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }
      } else if (occ.id !== myId) {
        const me = latestState.players.find(p => p.id === myId);
        if (me && me.seat === null) {
          const d = Math.hypot(me.x - seat.x, me.y - seat.y);
          if (d < SEAT_RADIUS) {
            ctx.beginPath();
            ctx.ellipse(seat.x, seat.y, 34, 24, 0, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff5252';
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // steering wheel on the two front-most seats
      if (i < 2) drawSteeringWheel(seat.x, seat.y - 40);
    });
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

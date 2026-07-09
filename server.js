const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- World / bike geometry ---
// The surrey has 5 human seats: a basket seat out front, a bench of 3 across
// the middle, and one seat at the back-left. The back-right spot is taken up
// by a (non-playable) dog carrier with an Akita in it.
const CANVAS_W = 700;
const CANVAS_H = 680;
const SEATS = [
  { x: 350, y: 170, type: 'basket', wheel: false, pedal: false }, // 0: front basket
  { x: 220, y: 330, type: 'bench', wheel: true, pedal: true },    // 1: front row left
  { x: 350, y: 330, type: 'bench', wheel: false, pedal: true },   // 2: front row center
  { x: 480, y: 330, type: 'bench', wheel: true, pedal: true },    // 3: front row right
  { x: 250, y: 480, type: 'back', wheel: false, pedal: true },    // 4: back left
];
const SEAT_POSITIONS = SEATS.map(s => ({ x: s.x, y: s.y }));
const DOG_CARRIER = { x: 450, y: 480 };
const SEAT_RADIUS = 60; // how close you must be to sit/push
const PLAYER_SPEED = 220; // px/sec
const PLAYER_RADIUS = 18;
const COUNTDOWN_SECONDS = 5;
const MAX_PLAYERS = SEATS.length;

const COLORS = ['#ff5252', '#4fc3f7', '#ffca28', '#81c784', '#ba68c8'];

const players = {}; // id -> player
let countdownTimer = null;
let countdownValue = 0;
let gameState = 'lobby'; // 'lobby' | 'countdown' | 'started'

function spawnPosition(index) {
  // scatter standing spawn points away from the bike, in the side margins
  const spots = [
    { x: 80, y: 600 },
    { x: 80, y: 420 },
    { x: 620, y: 420 },
    { x: 620, y: 600 },
    { x: 80, y: 240 },
  ];
  return spots[index % spots.length];
}

function seatOf(playerId) {
  return Object.values(players).find(p => p.seat !== null && p.id === playerId);
}

function occupant(seatIndex) {
  return Object.values(players).find(p => p.seat === seatIndex);
}

function clampToCanvas(pos) {
  pos.x = Math.max(PLAYER_RADIUS, Math.min(CANVAS_W - PLAYER_RADIUS, pos.x));
  pos.y = Math.max(PLAYER_RADIUS, Math.min(CANVAS_H - PLAYER_RADIUS, pos.y));
}

function nearestFreeSpotNear(x, y) {
  // place an ejected player just off the seat, nudged away from the bike row
  const candidates = [
    { x: x, y: y + 90 },
    { x: x, y: y - 90 },
    { x: x - 60, y: y + 100 },
    { x: x + 60, y: y + 100 },
  ];
  for (const c of candidates) {
    clampToCanvas(c);
    return c; // first candidate is fine for this simple game
  }
}

function allSeatsFull() {
  return SEAT_POSITIONS.every((_, i) => !!occupant(i));
}

function startCountdownIfReady() {
  if (allSeatsFull() && gameState === 'lobby') {
    gameState = 'countdown';
    countdownValue = COUNTDOWN_SECONDS;
    countdownTimer = setInterval(() => {
      countdownValue -= 1;
      if (!allSeatsFull()) {
        cancelCountdown();
        return;
      }
      if (countdownValue <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        gameState = 'started';
        io.emit('gameStarted');
      }
    }, 1000);
  }
}

function cancelCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (gameState === 'countdown') gameState = 'lobby';
  countdownValue = 0;
}

function resetToLobby() {
  cancelCountdown();
  gameState = 'lobby';
}

io.on('connection', socket => {
  socket.on('join', ({ name }) => {
    if (players[socket.id]) return;
    const cleanName = (name || 'Player').toString().slice(0, 16).trim() || 'Player';
    const idx = Object.keys(players).length;
    if (idx >= MAX_PLAYERS) {
      socket.emit('joinRejected', { reason: 'Lobby is full (5 riders max).' });
      return;
    }
    const pos = spawnPosition(idx);
    players[socket.id] = {
      id: socket.id,
      name: cleanName,
      color: COLORS[idx % COLORS.length],
      x: pos.x,
      y: pos.y,
      seat: null,
      input: { up: false, down: false, left: false, right: false },
    };
    socket.emit('joined', {
      id: socket.id,
      seats: SEATS,
      dogCarrier: DOG_CARRIER,
      canvas: { w: CANVAS_W, h: CANVAS_H },
    });
  });

  socket.on('input', dir => {
    const p = players[socket.id];
    if (!p || p.seat !== null) return;
    p.input = {
      up: !!dir.up,
      down: !!dir.down,
      left: !!dir.left,
      right: !!dir.right,
    };
  });

  socket.on('interact', () => {
    const p = players[socket.id];
    if (!p) return;

    if (p.seat !== null) {
      // Get off the bike
      const seatPos = SEAT_POSITIONS[p.seat];
      const spot = nearestFreeSpotNear(seatPos.x, seatPos.y);
      p.seat = null;
      p.x = spot.x;
      p.y = spot.y;
      if (gameState === 'countdown' && !allSeatsFull()) cancelCountdown();
      return;
    }

    // Find nearest seat within range
    let best = -1;
    let bestDist = Infinity;
    SEAT_POSITIONS.forEach((seat, i) => {
      const d = Math.hypot(seat.x - p.x, seat.y - p.y);
      if (d < SEAT_RADIUS && d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best === -1) return;

    const occ = occupant(best);
    if (occ && occ.id !== p.id) {
      // Push them out, take the seat
      const seatPos = SEAT_POSITIONS[best];
      const spot = nearestFreeSpotNear(seatPos.x, seatPos.y);
      occ.seat = null;
      occ.x = spot.x;
      occ.y = spot.y;
    }
    p.seat = best;
    p.x = SEAT_POSITIONS[best].x;
    p.y = SEAT_POSITIONS[best].y;
    startCountdownIfReady();
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    if (gameState === 'countdown' && !allSeatsFull()) cancelCountdown();
    if (Object.keys(players).length === 0) resetToLobby();
  });
});

// Fixed-tick physics loop for standing players
const TICK_MS = 1000 / 30;
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  for (const p of Object.values(players)) {
    if (p.seat !== null) continue;
    let dx = 0, dy = 0;
    if (p.input.up) dy -= 1;
    if (p.input.down) dy += 1;
    if (p.input.left) dx -= 1;
    if (p.input.right) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      p.x += (dx / len) * PLAYER_SPEED * dt;
      p.y += (dy / len) * PLAYER_SPEED * dt;
      clampToCanvas(p);
    }
  }

  io.emit('state', {
    players: Object.values(players).map(p => ({
      id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, seat: p.seat,
    })),
    gameState,
    countdownValue,
  });
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Surrey lobby listening on http://localhost:${PORT}`);
});

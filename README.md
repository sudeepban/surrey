# Surrey Lobby

A real-time multiplayer lobby game built around a real 5-seat surrey (pedal quad) bike. Up to 5 players join, walk around, and claim a seat before the ride starts — and if every seat is taken, the only way in is to push someone else out.

## The bike

The game is modeled on an actual surrey bike, not a generic bicycle. It has 5 human seats plus a dog carrier:

| Seat | Position | Pedal | Steering wheel |
|---|---|---|---|
| Basket | Front, in a wire basket | No | No |
| Front-left | Bench row | Yes | Yes |
| Front-center | Bench row | **No** | No |
| Front-right | Bench row | Yes | Yes |
| Back-left | Rear | Yes | No |
| *(Back-right)* | Rear | — | — (dog carrier, not a seat) |

The back-right spot is permanently occupied by a soft dog carrier with an Akita in it. It's a fixed prop — no player can sit there, and it can't be pushed or vacated. It's drawn as a closed carrier bag with the dog's face peeking out.

## Gameplay

1. Up to **5 players** join the lobby by name.
2. Everyone spawns standing, off the bike, and can walk around freely (joystick on mobile, WASD/arrow keys on desktop).
3. Walk up to an **empty** seat and press/tap **interact** to sit down.
4. Walk up to an **occupied** seat and press/tap **interact** to shove that player out and take their seat yourself. This is the whole point of the lobby phase — nothing is locked in until the ride actually starts.
5. Once all 5 seats are filled, a **5-second countdown** begins. If anyone hops off during the countdown (voluntarily, or gets pushed), the countdown cancels and the lobby waits for the seats to fill back up.
6. When the countdown reaches zero, the ride starts and every connected client is notified.

A 6th join attempt is rejected once the lobby is full.

## Tech stack

- **Server**: Node.js + Express + Socket.IO. The server is authoritative — it owns player positions, seat assignments, and the countdown/game-state machine, and broadcasts the world state to every client ~30 times a second.
- **Client**: Plain HTML/CSS/JS, no build step. Rendering is done on a `<canvas>` element.
- **Rendering style**: Pixel art. The scene is drawn at a small internal resolution and then upscaled with nearest-neighbor scaling (`image-rendering: pixelated`), which gives the chunky, aliased retro look without needing hand-authored sprite sheets.
- **Input**: A virtual joystick + interact button (pointer events) for touch/mobile, and WASD/arrow keys + E/Space for desktop. Both feed the same input path on the server.

This is a mobile-first game: locked viewport (no pinch-zoom or scroll), safe-area padding for notches, and a layout sized to fit one phone screen without scrolling.

## Project structure

```
server.js            Authoritative game server (Express + Socket.IO)
public/
  index.html          Page shell: join screen, game screen, touch controls
  style.css           Mobile-first layout, pixelated canvas rendering, joystick/button styling
  client.js           Socket client, input handling, canvas rendering
package.json
```

## Running it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in up to 5 browser tabs/windows (or on multiple devices on the same network) to fill the lobby.

## What's not built yet

The countdown ending currently just shows a "the surrey rolls out" placeholder screen — there's no actual riding/racing gameplay after the lobby phase. That's the next thing to design if this goes further.

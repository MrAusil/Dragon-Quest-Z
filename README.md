# Dragon Quest Z — The Saiyan Saga

A Dragon Ball Z inspired browser platformer game built by **Arpit**.

## 🎮 How to Play

Open `index.html` in any modern browser. No server required — just double-click!

### Controls

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Move | Arrow Keys / WASD | D-Pad (left side) |
| Jump | Space / W / Up | JUMP button |
| Melee Combo | J | HIT button |
| Ki Blast | K | KI button |
| Kamehameha | Hold L (release to fire) | KAME button |
| Air Slam | I (while airborne) | AIR button |
| Super Saiyan | T | ⚡ SSJ button |
| Pause | P / Escape | — |

## 📁 File Structure

```
dragon-quest-z/
├── index.html      ← Main HTML page
├── style.css       ← All styles (HUD, menus, mobile layout, animations)
├── game.js         ← All game logic (engine, audio, AI, rendering)
└── README.md       ← This file
```

## 🌟 Features

- **5 Levels**: Raditz → Nappa → Vegeta → Frieza → Cell
- **Super Saiyan Transformation** — T key or SSJ button, requires full Ki
- **3-Hit Melee Combo Chain** with knockback finisher
- **Kamehameha** charge system with visual meter
- **Skill Tree** — unlock 8 upgrades using points earned per level
- **Boss Intro Cutscenes** — cinematic letterbox with tap-to-skip
- **Web Audio API** — procedural music and SFX, zero external files
- **Mobile-first** landscape layout with thumb-friendly controls
- **Full Menu System** — Settings, Credits, Skills tree
- **Persistent Progress** — saves via localStorage

## 🛠 Tech Stack

- Vanilla JavaScript (ES5 compatible)
- HTML5 Canvas 2D
- Web Audio API (procedural synthesis)
- CSS3 animations
- Zero external libraries or dependencies

## 🚀 Deployment

Just host the folder on any static file server:

```bash
# Python local server
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Or just open index.html directly in a browser!
```

---

*Created by Arpit · Multiple file architecture split into clean modules*

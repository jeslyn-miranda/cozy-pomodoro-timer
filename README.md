# Cozy Pomodoro Timer

A warm, lo-fi Pomodoro study timer built with **vanilla HTML, CSS, and JavaScript** — no frameworks, no build step. Drop it in a browser and go.

![tech: HTML5 · CSS3 · Vanilla JS](https://img.shields.io/badge/tech-HTML5%20%C2%B7%20CSS3%20%C2%B7%20Vanilla%20JS-b6784f)

## Features

- **Three modes** — Pomodoro (25m), Short Break (5m), Long Break (15m). Switching modes resets the timer.
- **Animated SVG progress ring** — hand-rolled, no libraries.
- **Session counter & statistics** — today's pomodoros, total focus time, longest streak. Persisted in `localStorage` with automatic daily rollover.
- **Motivational quotes** — 20+ quotes shuffle on each new session.
- **Background music player** — play/pause and volume slider for a local mp3 in `assets/music/`.
- **Settings modal** — customise durations and toggle auto-start for breaks and pomodoros.
- **Dark mode** — remembered across visits, honours `prefers-color-scheme` on first load.
- **Fully responsive** — desktop, tablet, mobile.
- **Accessible** — semantic HTML, ARIA labels, visible focus states, keyboard shortcuts, reduced-motion support, focus trap in the modal.
- **Zero dependencies** — pure ES2020+ JavaScript.

## Quick start

```bash
# From this folder — any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just double-click `index.html`.

### Adding music

Drop an mp3 into `assets/music/` named `lofi.mp3` (or update the `src` on the `<audio>` element in `index.html`). Nothing crashes if it's missing — the player will show a friendly toast instead.

## Keyboard shortcuts

| Key       | Action                |
| --------- | --------------------- |
| **Space** | Start / pause / resume |
| **R**     | Reset current session  |
| **Esc**   | Close the settings modal |

## Project structure

```
timer/
├── index.html         # Semantic markup
├── style.css          # Tokens, layout, animations, dark mode, responsive
├── script.js          # Modular IIFE — Timer, Stats, Settings, Ring, Theme, Music, Modal
├── assets/
│   ├── music/         # Drop lofi.mp3 here
│   ├── icons/
│   ├── backgrounds/
│   └── fonts/
└── README.md
```

## Code organisation

`script.js` is a single self-invoking module split into clearly labelled sections:

1. **Constants & configuration** — storage keys, mode definitions, defaults.
2. **Storage** — thin `localStorage` wrapper with graceful fallbacks.
3. **Quotes** — the 22-quote pool.
4. **Settings** / **Stats** — persistent state with a small API.
5. **Ring** — SVG stroke-dashoffset math.
6. **Toast** — transient status messages.
7. **Timer** — the core countdown state machine; drift-corrected via wall-clock timestamps.
8. **Theme** / **Music** / **Modal** / **Keyboard** — UI concerns, each isolated.

The timer computes remaining time from `Date.now()` deltas rather than accumulating `setInterval` ticks, so long pauses or tab throttling don't cause drift.

## Design choices

- **Warm beige & soft brown palette** for the light theme; deep espresso with cream accents for dark.
- **Rounded cards, soft shadows** — no hard edges anywhere.
- **Gentle pulse** on the timer display while running (respects `prefers-reduced-motion`).
- **Cards fade in** on load in a staggered sequence.
- **Focus ring** uses the accent colour — visible without being loud.

## Browser support

Any modern evergreen browser (Chrome, Edge, Firefox, Safari). Uses `AudioContext` for the completion chime; falls back silently on older browsers.

## License

MIT.

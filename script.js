/* ============================================================
   Cozy Pomodoro Timer — script.js
   ------------------------------------------------------------
   Organized into IIFE-scoped modules to avoid polluting the
   global namespace. Each module owns one concern:

     1. Constants & configuration
     2. Storage       — localStorage read/write helpers
     3. Quotes        — motivational quote pool
     4. Settings      — user-configurable durations & flags
     5. Stats         — persistent daily statistics
     6. Ring          — circular SVG progress indicator
     7. Toast         — transient status messages
     8. Timer         — countdown state machine (core)
     9. Theme         — light / dark mode with persistence
    10. Music         — audio playback & volume
    11. Modal         — settings dialog interactions
    12. Keyboard      — global shortcuts
    13. Bootstrap     — wires everything together on load
   ============================================================ */

(() => {
  "use strict";

  /* ==========================================================
     1. Constants & configuration
     ========================================================== */
  const STORAGE_KEYS = Object.freeze({
    settings: "cozy-pomodoro:settings",
    stats:    "cozy-pomodoro:stats",
    theme:    "cozy-pomodoro:theme",
    volume:   "cozy-pomodoro:volume",
  });

  const MODES = Object.freeze({
    pomodoro: { key: "pomodoro", label: "Focus session",    settingKey: "pomodoro" },
    short:    { key: "short",    label: "Short break",       settingKey: "short"    },
    long:     { key: "long",     label: "Long break",        settingKey: "long"     },
  });

  const DEFAULT_SETTINGS = Object.freeze({
    pomodoro: 25,
    short: 5,
    long: 15,
    autoBreaks: false,
    autoPomodoros: false,
  });

  const DEFAULT_STATS = Object.freeze({
    date: "",            // ISO date "YYYY-MM-DD" — resets today's count on rollover
    today: 0,            // pomodoros completed today
    totalFocusMinutes: 0,
    currentStreak: 0,    // consecutive completed pomodoros without a reset
    longestStreak: 0,
  });

  /* SVG ring geometry — must match r=100 in index.html */
  const RING_RADIUS = 100;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));


  /* ==========================================================
     2. Storage
     ========================================================== */
  const Storage = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return { ...fallback, ...JSON.parse(raw) };
      } catch {
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch { /* quota exceeded / private mode — silently ignore */ }
    },
    readRaw(key, fallback) {
      try { return localStorage.getItem(key) ?? fallback; }
      catch { return fallback; }
    },
    writeRaw(key, value) {
      try { localStorage.setItem(key, value); } catch { /* noop */ }
    },
  };


  /* ==========================================================
     3. Quotes
     ========================================================== */
  const QUOTES = [
    "Small progress is still progress.",
    "You don't have to be perfect to be productive.",
    "Focus on the step in front of you, not the whole staircase.",
    "One page at a time. One breath at a time.",
    "Discipline is choosing between what you want now and what you want most.",
    "The secret of getting ahead is getting started.",
    "Deep work beats busy work — every single time.",
    "Slow is smooth. Smooth is fast.",
    "You can do hard things.",
    "Tiny steps every day beat giant leaps once a month.",
    "Done is better than perfect.",
    "Consistency compounds.",
    "Your future self is watching. Make them proud.",
    "Trust the process. The pages turn themselves.",
    "Rest is part of the work.",
    "Show up. That's already the hardest part.",
    "One cozy hour of focus > four distracted ones.",
    "Learning is layered. Keep stacking.",
    "You're allowed to take it slow.",
    "Progress, not perfection.",
    "Start where you are. Use what you have. Do what you can.",
    "The pomodoro doesn't judge — it just keeps time.",
  ];

  const pickQuote = () => QUOTES[Math.floor(Math.random() * QUOTES.length)];


  /* ==========================================================
     4. Settings
     ========================================================== */
  const Settings = {
    _current: null,

    load() {
      this._current = Storage.read(STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS });
      return this.get();
    },
    get()  { return { ...this._current }; },
    save(patch) {
      this._current = { ...this._current, ...patch };
      Storage.write(STORAGE_KEYS.settings, this._current);
    },
    /** Convenience: minutes for a given mode key */
    minutesFor(modeKey) { return this._current[modeKey]; },
  };


  /* ==========================================================
     5. Stats
     ========================================================== */
  const Stats = {
    _current: null,

    _todayISO() { return new Date().toISOString().slice(0, 10); },

    load() {
      const stored = Storage.read(STORAGE_KEYS.stats, { ...DEFAULT_STATS });
      // Roll over daily counters when the calendar date changes.
      if (stored.date !== this._todayISO()) {
        stored.date = this._todayISO();
        stored.today = 0;
      }
      this._current = stored;
      Storage.write(STORAGE_KEYS.stats, this._current);
      return this.get();
    },

    get() { return { ...this._current }; },

    /** Called when a pomodoro finishes. Break sessions do not affect stats. */
    recordPomodoro(minutes) {
      this._current.today += 1;
      this._current.totalFocusMinutes += minutes;
      this._current.currentStreak += 1;
      if (this._current.currentStreak > this._current.longestStreak) {
        this._current.longestStreak = this._current.currentStreak;
      }
      Storage.write(STORAGE_KEYS.stats, this._current);
    },

    /** Called when the user resets an in-progress pomodoro — breaks the streak. */
    breakStreak() {
      if (this._current.currentStreak === 0) return;
      this._current.currentStreak = 0;
      Storage.write(STORAGE_KEYS.stats, this._current);
    },
  };


  /* ==========================================================
     6. Ring — circular SVG progress
     ========================================================== */
  const Ring = {
    _el: null,

    init() {
      this._el = $("#progress-ring-fill");
      this._el.style.strokeDasharray = String(RING_CIRCUMFERENCE);
      this.set(1);
    },

    /**
     * @param {number} progress 0..1 — fraction of time remaining (1 = full, 0 = empty)
     */
    set(progress) {
      const clamped = Math.max(0, Math.min(1, progress));
      const offset = RING_CIRCUMFERENCE * (1 - clamped);
      this._el.style.strokeDashoffset = String(offset);
    },
  };


  /* ==========================================================
     7. Toast
     ========================================================== */
  const Toast = {
    _el:  null,
    _msg: null,
    _timeoutId: 0,

    init() {
      this._el = $("#toast");
      this._msg = $("#toast-message");
    },

    show(message, duration = 3000) {
      this._msg.textContent = message;
      this._el.hidden = false;
      // Force reflow so the transition runs on first show
      void this._el.offsetWidth;
      this._el.classList.add("is-visible");

      clearTimeout(this._timeoutId);
      this._timeoutId = window.setTimeout(() => {
        this._el.classList.remove("is-visible");
        // Hide from AT after the fade-out finishes
        window.setTimeout(() => { this._el.hidden = true; }, 300);
      }, duration);
    },
  };


  /* ==========================================================
     8. Timer — core countdown state machine
     ========================================================== */
  const Timer = {
    /* -------- DOM refs -------- */
    _card:      null,
    _timeEl:    null,
    _labelEl:   null,
    _startBtn:  null,
    _resetBtn:  null,
    _quoteEl:   null,
    _tabs:      [],

    /* -------- State -------- */
    _mode:      MODES.pomodoro.key,
    _totalMs:   0,   // duration of the current session in ms
    _remainMs:  0,   // time left in ms
    _endsAt:    0,   // wall-clock timestamp when the session ends (if running)
    _running:   false,
    _tickId:    0,

    /* -------- Init -------- */
    init() {
      this._card     = $(".timer-card");
      this._timeEl   = $("#time-remaining");
      this._labelEl  = $("#mode-label");
      this._startBtn = $("#start-btn");
      this._resetBtn = $("#reset-btn");
      this._quoteEl  = $("#quote");
      this._tabs     = $$(".mode-tab");

      this._startBtn.addEventListener("click", () => this.toggle());
      this._resetBtn.addEventListener("click", () => this.reset({ manual: true }));

      this._tabs.forEach((tab) => {
        tab.addEventListener("click", () => this.setMode(tab.dataset.mode));
      });

      // Update UI when tab regains focus (drift correction if throttled)
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && this._running) this._tick();
      });

      this.setMode(this._mode, { silent: true });
    },

    /* -------- Public API -------- */
    setMode(modeKey, { silent = false } = {}) {
      if (!MODES[modeKey]) return;
      // Switching modes always cancels the running countdown.
      this._stopInterval();
      this._running = false;

      this._mode = modeKey;
      const minutes = Settings.minutesFor(MODES[modeKey].settingKey);
      this._totalMs  = minutes * 60 * 1000;
      this._remainMs = this._totalMs;

      this._syncModeUI();
      this._render();
      this._card.classList.remove("is-running");
      this._setStartLabel("Start");
      if (!silent) Ring.set(1);
      else Ring.set(1);
    },

    toggle() {
      if (this._running) this.pause();
      else this.start();
    },

    start() {
      if (this._running) return;

      // Fresh session (not just resuming a pause) — pick a new quote.
      if (this._remainMs === this._totalMs) {
        this._quoteEl.textContent = `"${pickQuote()}"`;
      }

      this._endsAt = Date.now() + this._remainMs;
      this._running = true;
      this._card.classList.add("is-running");
      this._setStartLabel("Pause");
      this._startInterval();
      this._tick();
    },

    pause() {
      if (!this._running) return;
      this._remainMs = Math.max(0, this._endsAt - Date.now());
      this._running = false;
      this._stopInterval();
      this._card.classList.remove("is-running");
      this._setStartLabel("Resume");
    },

    reset({ manual = false } = {}) {
      const wasRunningPomodoro = this._mode === MODES.pomodoro.key && this._remainMs < this._totalMs;
      this._stopInterval();
      this._running = false;
      this._remainMs = this._totalMs;
      this._endsAt = 0;
      this._card.classList.remove("is-running");
      this._setStartLabel("Start");
      this._render();
      Ring.set(1);

      if (manual && wasRunningPomodoro) {
        // Break the streak — the user gave up on an in-progress pomodoro.
        Stats.breakStreak();
        StatsView.render();
      }
    },

    /* -------- Internals -------- */
    _startInterval() {
      // 250ms feels smooth for the ring without burning CPU.
      this._stopInterval();
      this._tickId = window.setInterval(() => this._tick(), 250);
    },
    _stopInterval() {
      if (this._tickId) {
        clearInterval(this._tickId);
        this._tickId = 0;
      }
    },

    _tick() {
      if (!this._running) return;
      const now = Date.now();
      this._remainMs = Math.max(0, this._endsAt - now);
      this._render();

      if (this._remainMs === 0) {
        this._finish();
      }
    },

    _render() {
      const totalSeconds = Math.ceil(this._remainMs / 1000);
      const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
      const ss = String(totalSeconds % 60).padStart(2, "0");
      this._timeEl.textContent = `${mm}:${ss}`;

      // Update the browser tab title so the user sees the countdown when tabbed out.
      document.title = this._running || this._remainMs !== this._totalMs
        ? `${mm}:${ss} — ${MODES[this._mode].label}`
        : "Cozy Pomodoro Timer";

      Ring.set(this._remainMs / this._totalMs);
    },

    _syncModeUI() {
      this._tabs.forEach((tab) => {
        const isActive = tab.dataset.mode === this._mode;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
      });
      this._labelEl.textContent = MODES[this._mode].label;
    },

    _setStartLabel(label) {
      $(".btn__label", this._startBtn).textContent = label;
    },

    _finish() {
      this._stopInterval();
      this._running = false;
      this._card.classList.remove("is-running");
      this._playChime();

      const finishedMode = this._mode;
      const minutes = Settings.minutesFor(MODES[finishedMode].settingKey);

      if (finishedMode === MODES.pomodoro.key) {
        Stats.recordPomodoro(minutes);
        StatsView.render();
        Toast.show("Nice work! Time for a break. ☕");
        this._advanceAfterPomodoro();
      } else {
        Toast.show("Break's over — let's get back to it. 🍅");
        this._advanceAfterBreak();
      }
    },

    /** After a pomodoro: switch to a break; auto-start it if the setting is on. */
    _advanceAfterPomodoro() {
      // Every 4 completed pomodoros → long break; otherwise short.
      const nextMode = Stats.get().today % 4 === 0 ? MODES.long.key : MODES.short.key;
      this.setMode(nextMode);
      if (Settings.get().autoBreaks) this.start();
    },

    /** After a break: switch back to pomodoro; auto-start if the setting is on. */
    _advanceAfterBreak() {
      this.setMode(MODES.pomodoro.key);
      if (Settings.get().autoPomodoros) this.start();
    },

    _playChime() {
      // A tiny synthesized bell via WebAudio — no asset dependency.
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
        gain.connect(ctx.destination);

        [523.25, 659.25, 783.99].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = freq;
          osc.connect(gain);
          osc.start(ctx.currentTime + i * 0.08);
          osc.stop(ctx.currentTime + 1.2);
        });

        // Auto-close the context after the chime plays out.
        window.setTimeout(() => ctx.close().catch(() => {}), 1500);
      } catch { /* audio blocked — silent */ }
    },
  };


  /* ==========================================================
     9. Theme
     ========================================================== */
  const Theme = {
    _toggleBtn: null,

    init() {
      this._toggleBtn = $("#theme-toggle");

      const saved = Storage.readRaw(STORAGE_KEYS.theme, null);
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const initial = saved ?? (prefersDark ? "dark" : "light");
      this._apply(initial);

      this._toggleBtn.addEventListener("click", () => this.toggle());
    },

    toggle() {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      this._apply(next);
      Storage.writeRaw(STORAGE_KEYS.theme, next);
    },

    _apply(theme) {
      document.documentElement.dataset.theme = theme;
      this._toggleBtn.setAttribute("aria-pressed", String(theme === "dark"));
      this._toggleBtn.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      );
    },
  };


  /* ==========================================================
     10. Music
     ========================================================== */
  const Music = {
    _audio: null,
    _toggle: null,
    _volume: null,

    init() {
      this._audio  = $("#music");
      this._toggle = $("#music-toggle");
      this._volume = $("#volume");

      // Restore volume preference
      const savedVolume = Number(Storage.readRaw(STORAGE_KEYS.volume, "50"));
      const startVolume = Number.isFinite(savedVolume) ? savedVolume : 50;
      this._volume.value = String(startVolume);
      this._audio.volume = startVolume / 100;

      this._toggle.addEventListener("click", () => this._togglePlay());
      this._volume.addEventListener("input", () => {
        const pct = Number(this._volume.value);
        this._audio.volume = pct / 100;
        Storage.writeRaw(STORAGE_KEYS.volume, String(pct));
      });

      // Reflect the true media state (e.g. if it ends or errors)
      this._audio.addEventListener("play",  () => this._setPressed(true));
      this._audio.addEventListener("pause", () => this._setPressed(false));
      this._audio.addEventListener("error", () => {
        // Missing mp3 is expected in the starter — surface a friendly hint.
        this._setPressed(false);
        Toast.show("Add an mp3 to assets/music/lofi.mp3 to enable music.", 3600);
      });
    },

    _togglePlay() {
      if (this._audio.paused) {
        const p = this._audio.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => Toast.show("Add an mp3 to assets/music/lofi.mp3 to enable music.", 3600));
        }
      } else {
        this._audio.pause();
      }
    },

    _setPressed(isPlaying) {
      this._toggle.setAttribute("aria-pressed", String(isPlaying));
      this._toggle.setAttribute("aria-label", isPlaying ? "Pause music" : "Play music");
    },
  };


  /* ==========================================================
     11. Stats view — renders numbers into the DOM
     ========================================================== */
  const StatsView = {
    _today: null,
    _focus: null,
    _streak: null,

    init() {
      this._today  = $("#stat-today");
      this._focus  = $("#stat-focus");
      this._streak = $("#stat-streak");
      this.render();
    },

    render() {
      const s = Stats.get();
      this._today.textContent  = String(s.today);
      this._focus.textContent  = this._formatMinutes(s.totalFocusMinutes);
      this._streak.textContent = String(s.longestStreak);
    },

    _formatMinutes(mins) {
      if (mins < 60) return `${mins}m`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m === 0 ? `${h}h` : `${h}h ${m}m`;
    },
  };


  /* ==========================================================
     12. Settings modal
     ========================================================== */
  const Modal = {
    _modal: null,
    _form:  null,
    _openBtn: null,
    _lastFocused: null,

    init() {
      this._modal   = $("#settings-modal");
      this._form    = $("#settings-form");
      this._openBtn = $("#settings-btn");

      this._openBtn.addEventListener("click", () => this.open());
      $$("[data-close-modal]", this._modal).forEach((el) => {
        el.addEventListener("click", () => this.close());
      });
      this._form.addEventListener("submit", (e) => this._handleSubmit(e));

      // Escape key closes the modal
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !this._modal.hidden) this.close();
      });

      // Basic focus trap
      this._modal.addEventListener("keydown", (e) => this._trapFocus(e));
    },

    open() {
      this._lastFocused = document.activeElement;
      this._populate();
      this._modal.hidden = false;
      // Focus the first field once painted
      window.requestAnimationFrame(() => {
        $("#dur-pomodoro", this._modal)?.focus();
      });
    },

    close() {
      this._modal.hidden = true;
      if (this._lastFocused && typeof this._lastFocused.focus === "function") {
        this._lastFocused.focus();
      }
    },

    _populate() {
      const s = Settings.get();
      $("#dur-pomodoro").value  = s.pomodoro;
      $("#dur-short").value     = s.short;
      $("#dur-long").value      = s.long;
      $("#auto-breaks").checked    = !!s.autoBreaks;
      $("#auto-pomodoros").checked = !!s.autoPomodoros;
    },

    _handleSubmit(e) {
      e.preventDefault();
      const data = new FormData(this._form);
      const patch = {
        pomodoro: this._clamp(Number(data.get("pomodoro")), 1, 180),
        short:    this._clamp(Number(data.get("short")),    1, 60),
        long:     this._clamp(Number(data.get("long")),     1, 120),
        autoBreaks:    data.get("autoBreaks") === "on",
        autoPomodoros: data.get("autoPomodoros") === "on",
      };
      Settings.save(patch);
      // Re-apply the current mode so the visible duration updates immediately.
      Timer.setMode(Timer._mode, { silent: true });
      this.close();
      Toast.show("Settings saved ✨");
    },

    _clamp(n, min, max) {
      if (!Number.isFinite(n)) return min;
      return Math.min(max, Math.max(min, Math.round(n)));
    },

    _trapFocus(e) {
      if (e.key !== "Tab") return;
      const focusables = $$(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        this._modal
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    },
  };


  /* ==========================================================
     13. Keyboard shortcuts
     ========================================================== */
  const Keyboard = {
    init() {
      document.addEventListener("keydown", (e) => {
        // Ignore when the user is typing in a field or the modal is open.
        const t = e.target;
        const isTyping =
          t instanceof HTMLInputElement ||
          t instanceof HTMLTextAreaElement ||
          (t && t.isContentEditable);
        if (isTyping) return;
        if (!$("#settings-modal").hidden) return;

        if (e.code === "Space") {
          e.preventDefault();
          Timer.toggle();
        } else if (e.key === "r" || e.key === "R") {
          Timer.reset({ manual: true });
        }
      });
    },
  };


  /* ==========================================================
     14. Bootstrap
     ========================================================== */
  const init = () => {
    Settings.load();
    Stats.load();

    Ring.init();
    Toast.init();
    StatsView.init();
    Timer.init();
    Theme.init();
    Music.init();
    Modal.init();
    Keyboard.init();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

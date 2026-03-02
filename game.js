/* ==========================================================================
   Dragon Quest Z — The Saiyan Saga
   Created by Arpit
   
   File: game.js
   All game logic: engine, physics, audio, AI, rendering, state machine
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function () {
'use strict';

'use strict';

/* ==========================================================================
   DRAGON QUEST Z  v3.0  — Desktop-First Premium Build
   + 1920x1080 base resolution, 720p→4K scaling, letterbox
   + High-FPS loop (deltaTime, 60–144Hz), FPS debug (F3)
   + Input Manager + full Gamepad API (Xbox/PS)
   + Cinematic camera (look-ahead, smooth lerp)
   + Object pooling (projectiles, particles)
   + Damage numbers, fullscreen (F), desktop polish
   ========================================================================== */

// ── PHASE 1: DESKTOP RESOLUTION & SCALING (1920x1080 base, letterbox, no stretch) ─
var canvas = document.getElementById('c');
if (!canvas) { console.error('FATAL: canvas missing'); return; }
var ctx = canvas.getContext('2d', { willReadFrequently: false });
if (!ctx) { console.error('FATAL: no 2d context'); return; }

var VW = 0, VH = 0, DPR = 1;
var LOGICAL_W = 1920, LOGICAL_H = 1080;  // desktop base; supports 720p→4K, ultrawide
var WORLD_HEIGHT = 560;  // level data ground ~450; used for letterbox
var gameViewEl = null;
var _canvasScale = 1;
var _canvasOffsetX = 0, _canvasOffsetY = 0;

function resizeCanvas() {
  gameViewEl = document.getElementById('gameView');
  var containerW, containerH;
  if (gameViewEl) {
    var r = gameViewEl.getBoundingClientRect();
    containerW = r.width;
    containerH = r.height;
    if (containerW <= 0 || containerH <= 0) {
      containerW = window.innerWidth;
      containerH = window.innerHeight;
    }
  } else {
    containerW = window.innerWidth;
    containerH = window.innerHeight;
  }
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  var scaleFit = Math.min(containerW / LOGICAL_W, containerH / LOGICAL_H);
  _canvasScale = scaleFit;
  var drawW = Math.round(LOGICAL_W * scaleFit);
  var drawH = Math.round(LOGICAL_H * scaleFit);
  _canvasOffsetX = (containerW - drawW) / 2;
  _canvasOffsetY = (containerH - drawH) / 2;
  VW = LOGICAL_W;
  VH = LOGICAL_H;
  var bufW = Math.round(LOGICAL_W * scaleFit * DPR);
  var bufH = Math.round(LOGICAL_H * scaleFit * DPR);
  canvas.width = bufW;
  canvas.height = bufH;
  canvas.style.width = drawW + 'px';
  canvas.style.height = drawH + 'px';
  ctx.setTransform(scaleFit * DPR, 0, 0, scaleFit * DPR, 0, 0);
  WORLD_TOP_OFFSET = Math.max(0, (LOGICAL_H - WORLD_HEIGHT) / 2);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', function () { setTimeout(resizeCanvas, 150); });
console.log('Canvas initialized (desktop ' + LOGICAL_W + 'x' + LOGICAL_H + ')');

// ── Utilities ─────────────────────────────────────────────────────────
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function lerp(a,b,t){ return a+(b-a)*t; }
function rand(lo,hi){ return Math.random()*(hi-lo)+lo; }
function dist(ax,ay,bx,by){ return Math.hypot(bx-ax,by-ay); }
function overlap(a,b){
  if(!a||!b)return false;
  return !(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
}
function rrect(x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

/* ==========================================================================
   PHASE 2: HIGH-FPS GAME LOOP — deltaTime-based, 60–144Hz, FPS debug
   ========================================================================== */
var TARGET_FPS = 60;
// Cap max delta to avoid large physics steps after tab switch (0.1s)
var MAX_DT = 0.1;   // cap to prevent physics spikes
var MIN_DT = 1 / 144;  // smooth on high refresh
var _lastFrameTime = 0;
var _accumulator = 0;
var _fpsDebug = false;
var _fpsCount = 0;
var _fpsElapsed = 0;
var _fpsDisplay = 0;

function getDeltaTime(ts) {
  if (_lastFrameTime === 0) _lastFrameTime = ts;
  var raw = (ts - _lastFrameTime) / 1000;
  _lastFrameTime = ts;
  // Cap large jumps (e.g., after switching tabs) to MAX_DT
  var capped = Math.min(raw, MAX_DT);
  return Math.max(MIN_DT, capped);
}

/* ==========================================================================
   PHASE 4 — AUDIO ENGINE
   Completely isolated module. If AudioContext fails, Audio becomes a stub.
   All sounds generated procedurally via Web Audio API — no external files.
   User interaction is required before audio starts (browser policy).
   ========================================================================== */
var Audio = (function() {
  var ac = null;          // AudioContext — null until first user interaction
  var muted = false;
  var bgGain = null;      // master gain for background music
  var bgNodes = [];       // track active bg oscillators for cleanup
  var sfxGain = null;     // master gain for SFX
  var ready = false;

  // ── Safe AudioContext init — called on first user interaction ──────
  function init() {
    if (ready) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // not supported — stay silent
      ac = new AC();
      bgGain  = ac.createGain(); bgGain.gain.value  = muted ? 0 : 0.14;
      sfxGain = ac.createGain(); sfxGain.gain.value = muted ? 0 : 0.55;
      bgGain.connect(ac.destination);
      sfxGain.connect(ac.destination);
      ready = true;
      console.log('Audio initialized, state:', ac.state);
      // Start background music after short delay
      setTimeout(startBGM, 400);
    } catch(e) {
      console.warn('Audio init failed (game continues):', e.message);
    }
  }

  // Resume suspended context (Chrome policy requires this)
  function resume() {
    if (ac && ac.state === 'suspended') {
      ac.resume().catch(function(){});
    }
  }

  // ── Mute toggle ───────────────────────────────────────────────────
  function toggleMute() {
    muted = !muted;
    if (bgGain)  bgGain.gain.value  = muted ? 0 : 0.14;
    if (sfxGain) sfxGain.gain.value = muted ? 0 : 0.55;
    var btn = document.getElementById('muteBtn');
    if (btn) {
      btn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'; // 🔇 / 🔊
      btn.classList.toggle('muted', muted);
    }
    return muted;
  }

  // ── SFX builder — creates an oscillator node and plays it ─────────
  // freq: Hz, type: waveform, dur: seconds, env: {a, d, s, r} ADSR
  // Returns early (no throw) if audio not ready
  function playTone(freq, type, dur, gain, env, dest) {
    if (!ready || !ac || muted) return;
    try {
      dest = dest || sfxGain;
      var osc = ac.createOscillator();
      var g   = ac.createGain();
      osc.type      = type || 'sine';
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      // Simple ADSR envelope
      var now = ac.currentTime;
      var a = (env && env.a) || 0.01;
      var d = (env && env.d) || 0.05;
      var s = (env && env.s !== undefined) ? env.s : gain * 0.7;
      var r = (env && env.r) || 0.1;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gain, now + a);
      g.gain.linearRampToValueAtTime(s, now + a + d);
      g.gain.setValueAtTime(s, now + dur - r);
      g.gain.linearRampToValueAtTime(0, now + dur);
      osc.connect(g); g.connect(dest);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    } catch(e) { /* silent fail — never crash game */ }
  }

  // ── Compound SFX (multi-oscillator) ──────────────────────────────

  // Jump: ascending chirp
  function jump() {
    if (!ready || !ac) return;
    try {
      var osc = ac.createOscillator();
      var g = ac.createGain();
      var now = ac.currentTime;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);
      g.gain.setValueAtTime(0.35, now);
      g.gain.linearRampToValueAtTime(0, now + 0.16);
      osc.connect(g); g.connect(sfxGain);
      osc.start(now); osc.stop(now + 0.18);
    } catch(e) {}
  }

  // Melee hit: punchy thud with harmonic
  function meleeHit(hitCount) {
    if (!ready || !ac) return;
    hitCount = hitCount || 1;
    // Pitch rises with combo hit number
    var base = 80 + hitCount * 40;
    try {
      var now = ac.currentTime;
      // Low thud
      var o1 = ac.createOscillator(); var g1 = ac.createGain();
      o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(base, now);
      o1.frequency.exponentialRampToValueAtTime(base * 0.3, now + 0.08);
      g1.gain.setValueAtTime(0.6, now);
      g1.gain.linearRampToValueAtTime(0, now + 0.1);
      o1.connect(g1); g1.connect(sfxGain);
      o1.start(now); o1.stop(now + 0.12);
      // Crack on final hit (3rd)
      if (hitCount >= 3) {
        var o2 = ac.createOscillator(); var g2 = ac.createGain();
        o2.type = 'square';
        o2.frequency.setValueAtTime(440, now + 0.02);
        o2.frequency.exponentialRampToValueAtTime(110, now + 0.14);
        g2.gain.setValueAtTime(0.4, now + 0.02);
        g2.gain.linearRampToValueAtTime(0, now + 0.16);
        o2.connect(g2); g2.connect(sfxGain);
        o2.start(now + 0.02); o2.stop(now + 0.18);
      }
    } catch(e) {}
  }

  // Ki blast: high-pitched zip
  function kiBlast() {
    if (!ready || !ac) return;
    try {
      var now = ac.currentTime;
      var o = ac.createOscillator(); var g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(880, now);
      o.frequency.exponentialRampToValueAtTime(1760, now + 0.05);
      o.frequency.exponentialRampToValueAtTime(440, now + 0.14);
      g.gain.setValueAtTime(0.3, now);
      g.gain.linearRampToValueAtTime(0.0, now + 0.16);
      o.connect(g); g.connect(sfxGain);
      o.start(now); o.stop(now + 0.18);
    } catch(e) {}
  }

  // Charge loop: rising hum (plays as long as charging)
  var _chargeOsc = null; var _chargeGain = null;
  function chargeStart() {
    if (!ready || !ac || _chargeOsc) return;
    try {
      _chargeOsc  = ac.createOscillator();
      _chargeGain = ac.createGain();
      _chargeOsc.type = 'sawtooth';
      _chargeOsc.frequency.setValueAtTime(120, ac.currentTime);
      _chargeOsc.frequency.exponentialRampToValueAtTime(480, ac.currentTime + 2.0);
      _chargeGain.gain.setValueAtTime(0, ac.currentTime);
      _chargeGain.gain.linearRampToValueAtTime(0.22, ac.currentTime + 0.15);
      _chargeOsc.connect(_chargeGain);
      _chargeGain.connect(sfxGain);
      _chargeOsc.start();
    } catch(e) { _chargeOsc = null; }
  }

  function chargeStop() {
    if (!_chargeOsc) return;
    try {
      _chargeGain.gain.linearRampToValueAtTime(0, ac.currentTime + 0.06);
      _chargeOsc.stop(ac.currentTime + 0.08);
    } catch(e) {}
    _chargeOsc = null; _chargeGain = null;
  }

  // Kamehameha explosion: big boom
  function kamehameha() {
    if (!ready || !ac) return;
    chargeStop();
    try {
      var now = ac.currentTime;
      // Deep boom
      var o1=ac.createOscillator(),g1=ac.createGain();
      o1.type='sine';
      o1.frequency.setValueAtTime(55, now);
      o1.frequency.exponentialRampToValueAtTime(22, now+0.35);
      g1.gain.setValueAtTime(0.8, now); g1.gain.linearRampToValueAtTime(0,now+0.4);
      o1.connect(g1);g1.connect(sfxGain);o1.start(now);o1.stop(now+0.45);
      // Mid crack
      var o2=ac.createOscillator(),g2=ac.createGain();
      o2.type='sawtooth';
      o2.frequency.setValueAtTime(220,now);o2.frequency.exponentialRampToValueAtTime(55,now+0.22);
      g2.gain.setValueAtTime(0.5,now);g2.gain.linearRampToValueAtTime(0,now+0.25);
      o2.connect(g2);g2.connect(sfxGain);o2.start(now);o2.stop(now+0.28);
      // High sizzle
      var o3=ac.createOscillator(),g3=ac.createGain();
      o3.type='square';
      o3.frequency.setValueAtTime(1200,now);o3.frequency.exponentialRampToValueAtTime(200,now+0.18);
      g3.gain.setValueAtTime(0.25,now);g3.gain.linearRampToValueAtTime(0,now+0.2);
      o3.connect(g3);g3.connect(sfxGain);o3.start(now);o3.stop(now+0.22);
    } catch(e) {}
  }

  // Air attack: downward slam
  function airSlam() {
    if (!ready || !ac) return;
    try {
      var now = ac.currentTime;
      var o=ac.createOscillator(),g=ac.createGain();
      o.type='sawtooth';
      o.frequency.setValueAtTime(440,now);o.frequency.exponentialRampToValueAtTime(60,now+0.12);
      g.gain.setValueAtTime(0.55,now);g.gain.linearRampToValueAtTime(0,now+0.15);
      o.connect(g);g.connect(sfxGain);o.start(now);o.stop(now+0.18);
    } catch(e) {}
  }

  // Villain hit: impact thud
  function explosion() {
    if (!ready || !ac) return;
    try {
      var now = ac.currentTime;
      var o=ac.createOscillator(),g=ac.createGain();
      o.type='square';
      o.frequency.setValueAtTime(180,now);o.frequency.exponentialRampToValueAtTime(45,now+0.22);
      g.gain.setValueAtTime(0.45,now);g.gain.linearRampToValueAtTime(0,now+0.28);
      o.connect(g);g.connect(sfxGain);o.start(now);o.stop(now+0.32);
    } catch(e) {}
  }

  // Power-up collected: ascending fanfare
  function powerUp() {
    if (!ready || !ac) return;
    var notes = [330,440,550,660,880];
    notes.forEach(function(f,i) {
      setTimeout(function(){playTone(f,'triangle',0.14,0.4);}, i*55);
    });
  }

  // Villain death: descending groan
  function villainDie() {
    if (!ready || !ac) return;
    try {
      var now = ac.currentTime;
      var o=ac.createOscillator(),g=ac.createGain();
      o.type='sawtooth';
      o.frequency.setValueAtTime(280,now);o.frequency.exponentialRampToValueAtTime(28,now+0.9);
      g.gain.setValueAtTime(0.6,now);g.gain.linearRampToValueAtTime(0,now+1.0);
      o.connect(g);g.connect(sfxGain);o.start(now);o.stop(now+1.05);
    } catch(e) {}
  }

  // Player hit: painful sting
  function playerHit() {
    if (!ready || !ac) return;
    try {
      var now = ac.currentTime;
      var o=ac.createOscillator(),g=ac.createGain();
      o.type='square';
      o.frequency.setValueAtTime(320,now);o.frequency.exponentialRampToValueAtTime(80,now+0.1);
      g.gain.setValueAtTime(0.35,now);g.gain.linearRampToValueAtTime(0,now+0.13);
      o.connect(g);g.connect(sfxGain);o.start(now);o.stop(now+0.15);
    } catch(e) {}
  }

  // ── Background Music — procedural looping ──────────────────────────
  // Generates a moody DBZ-inspired bass line + pad
  var _bgTimer = null;
  var _bgPhase = 0;  // which level BGM theme is playing (0-4)

  var BGM_THEMES = [
    // Level 1 — heroic tension (C minor arpeggio)
    [130.81, 155.56, 174.61, 195.99, 220.00, 195.99, 174.61, 155.56],
    // Level 2 — heavier, darker (C# minor)
    [138.59, 164.81, 184.99, 207.65, 233.08, 207.65, 184.99, 138.59],
    // Level 3 — space/ominous (B minor)
    [123.47, 146.83, 164.81, 185.00, 207.65, 185.00, 146.83, 123.47],
    // Level 4 — Frieza cold (F# minor)
    [184.99, 220.00, 246.94, 277.18, 246.94, 220.00, 184.99, 164.81],
    // Level 5 — Cell intense (G minor)
    [195.99, 220.00, 261.63, 293.66, 261.63, 220.00, 195.99, 174.61],
  ];

  function startBGM() {
    stopBGM();
    if (!ready || !ac) return;
    _bgLoopStep(0);
  }

  function _bgLoopStep(stepIdx) {
    if (!ready || !ac || muted) {
      // Reschedule check after 500ms so music resumes on unmute
      _bgTimer = setTimeout(function(){_bgLoopStep(stepIdx);}, 500);
      return;
    }
    var theme = BGM_THEMES[clamp(_bgPhase, 0, BGM_THEMES.length-1)];
    var freq  = theme[stepIdx % theme.length];
    var stepDur = 0.38; // seconds per note
    try {
      // Bass note
      var o1=ac.createOscillator(),g1=ac.createGain();
      o1.type='triangle';
      o1.frequency.setValueAtTime(freq * 0.5, ac.currentTime);
      g1.gain.setValueAtTime(0, ac.currentTime);
      g1.gain.linearRampToValueAtTime(0.8, ac.currentTime + 0.04);
      g1.gain.setValueAtTime(0.65, ac.currentTime + stepDur * 0.7);
      g1.gain.linearRampToValueAtTime(0, ac.currentTime + stepDur + 0.04);
      o1.connect(g1); g1.connect(bgGain);
      o1.start(ac.currentTime); o1.stop(ac.currentTime + stepDur + 0.08);

      // Pad (5th above bass)
      var o2=ac.createOscillator(),g2=ac.createGain();
      o2.type='sine';
      o2.frequency.setValueAtTime(freq * 0.75, ac.currentTime);
      g2.gain.setValueAtTime(0, ac.currentTime);
      g2.gain.linearRampToValueAtTime(0.5, ac.currentTime + 0.08);
      g2.gain.linearRampToValueAtTime(0, ac.currentTime + stepDur + 0.06);
      o2.connect(g2); g2.connect(bgGain);
      o2.start(ac.currentTime); o2.stop(ac.currentTime + stepDur + 0.1);
    } catch(e) {}

    // Schedule next step
    _bgTimer = setTimeout(function(){
      _bgLoopStep(stepIdx + 1);
    }, Math.round(stepDur * 1000));
  }

  function stopBGM() {
    if (_bgTimer) { clearTimeout(_bgTimer); _bgTimer = null; }
  }

  function setBGMTheme(levelIdx) {
    _bgPhase = clamp(levelIdx, 0, BGM_THEMES.length - 1);
    // Restart BGM with new theme
    startBGM();
  }

  return {
    init: init,
    resume: resume,
    toggleMute: toggleMute,
    isMuted: function(){ return muted; },
    // SFX
    jump: jump,
    meleeHit: meleeHit,
    kiBlast: kiBlast,
    chargeStart: chargeStart,
    chargeStop: chargeStop,
    kamehameha: kamehameha,
    airSlam: airSlam,
    explosion: explosion,
    powerUp: powerUp,
    villainDie: villainDie,
    playerHit: playerHit,
    setBGMTheme: setBGMTheme,
    stopBGM: stopBGM,
  };
})();

/* ==========================================================================
   PHASE 1 — MOBILE LANDSCAPE DETECTION & ORIENTATION LOCK
   ========================================================================== */
var _isMobile = ('ontouchstart' in window)||(navigator.maxTouchPoints>0);

function checkOrientation() {
  if (!_isMobile) return;
  var rp = document.getElementById('rotatePrompt');
  if (!rp) return;
  var isPortrait = window.innerHeight > window.innerWidth;
  rp.classList.toggle('show', isPortrait);
  if (!isPortrait) {
    var wrap = document.getElementById('wrap');
    if (wrap) {
      wrap.classList.add('orientation-fade');
      setTimeout(function () { wrap.classList.remove('orientation-fade'); }, 400);
    }
  }
}
window.addEventListener('orientationchange', function(){
  setTimeout(function () { checkOrientation(); resizeCanvas(); }, 300);
});
window.addEventListener('resize', function(){
  checkOrientation();
  resizeCanvas();
});
checkOrientation();

/* ==========================================================================
   PHASE 2 — AUDIO VOLUME CONTROLS (settings sliders integration)
   Extended Audio module with volume control
   ========================================================================== */
// Expose volume setters to be called from settings UI
Audio.setMusicVol = function(v) {
  // bgGain is internal — we use the init pattern to set value
  // Expose via a patch: store desired vol and apply on next init
  Audio._musicVol = clamp(v, 0, 1);
  try {
    var bg = Audio._bgGain || null;
    // Access via closure trick — store reference during init
    if (Audio._setBgGain) Audio._setBgGain(Audio._musicVol);
  } catch(e) {}
};
Audio.setSFXVol = function(v) {
  Audio._sfxVol = clamp(v, 0, 1);
  try {
    if (Audio._setSfxGain) Audio._setSfxGain(Audio._sfxVol);
  } catch(e) {}
};

/* ==========================================================================
   PHASE 3 — BOSS INTRO CUTSCENE SYSTEM
   Cinematic letterbox + villain name animation + skip support
   ========================================================================== */
var Cutscene = (function(){
  var _active = false;
  var _skipCb = null;
  var _timers = [];

  function _clearTimers() {
    _timers.forEach(function(t){ clearTimeout(t); });
    _timers = [];
  }

  function play(name, color, introText, onDone) {
    if (_active) skip(); // interrupt previous

    _active = true;
    _skipCb = function() { finish(onDone); };

    var cs = document.getElementById('cutscene');
    var vn = document.getElementById('csVillainName');
    var it = document.getElementById('csIntroText');
    var ar = document.getElementById('csAuraRing');
    if (!cs || !vn || !it) { if(onDone) onDone(); _active=false; return; }

    // Setup
    vn.textContent = name;
    vn.style.color = color;
    it.textContent = introText || '';
    ar.style.color = color;
    ar.style.borderColor = color;

    // Reset animation states
    vn.classList.remove('show');
    it.classList.remove('show');
    void vn.offsetHeight;

    // Activate cutscene overlay
    cs.classList.add('active');

    // Staggered reveal
    _timers.push(setTimeout(function(){ vn.classList.add('show'); }, 180));
    _timers.push(setTimeout(function(){ it.classList.add('show'); }, 620));
    // Auto-finish after 2.8s
    _timers.push(setTimeout(function(){ finish(onDone); }, 2800));
  }

  function finish(cb) {
    if (!_active) return;
    _active = false;
    _clearTimers();
    var cs = document.getElementById('cutscene');
    var vn = document.getElementById('csVillainName');
    var it = document.getElementById('csIntroText');
    if (cs) cs.classList.remove('active');
    if (vn) vn.classList.remove('show');
    if (it) it.classList.remove('show');
    if (cb) cb();
  }

  function skip() {
    if (!_active) return;
    if (_skipCb) _skipCb();
    _skipCb = null;
  }

  function isActive() { return _active; }

  // Setup skip tap/click on cutscene
  var csEl = document.getElementById('cutscene');
  if (csEl) {
    csEl.addEventListener('click', function(){ skip(); });
    csEl.addEventListener('touchend', function(e){ e.preventDefault(); skip(); }, {passive:false});
  }

  return { play: play, skip: skip, isActive: isActive };
})();

/* ==========================================================================
   PHASE 4 — SUPER SAIYAN TRANSFORMATION SYSTEM
   Standalone system — integrates with Player.powered flag
   Keys: T (desktop) | abSSJ (mobile)
   ========================================================================== */
var SSJ = (function(){
  var DURATION = 14;    // seconds as Super Saiyan
  var COOLDOWN  = 22;   // seconds cooldown after expiry
  var KI_COST   = 80;   // minimum Ki to transform

  var _state    = 'idle';   // 'idle' | 'active' | 'cooldown'
  var _timer    = 0;        // remaining active or cooldown time
  var _wasKey   = false;

  function canTransform(player) {
    return _state === 'idle' && player && player.ki >= KI_COST && !player.dead;
  }

  function transform(player) {
    if (!canTransform(player)) return false;
    _state = 'active';
    _timer = DURATION;

    player.powered = true;
    player.powT = DURATION;
    player.auraOn = true;
    player.ki = Math.max(0, player.ki - KI_COST);

    // Visual flash
    var kf = document.getElementById('kiFlash');
    if (kf) {
      kf.style.background = 'radial-gradient(ellipse,rgba(255,220,0,0.55) 0%,transparent 68%)';
      kf.style.transition = 'none'; kf.style.opacity = '1';
      void kf.offsetHeight;
      kf.style.transition = 'opacity 1.8s'; kf.style.opacity = '0';
      setTimeout(function(){
        kf.style.background = 'radial-gradient(ellipse,rgba(0,180,255,0.22) 0%,transparent 68%)';
      }, 2000);
    }

    // SSJ overlay glow
    var ov = document.getElementById('ssjOverlay');
    if (ov) ov.classList.add('on');

    // Special audio: power-up fanfare
    Audio.powerUp();
    shakeScreen(14, 0.7);

    // Particle burst
    for (var i = 0; i < 4; i++) {
      (function(ii){ setTimeout(function(){
        pSpawn(VW*0.5, VH*0.55, {n:18, grav:-40, minLife:0.7, maxLife:1.2,
          color:['#ffdd00','#ff8800','#ffffff','#ffee44'][ii],
          size:12, glow:true, minSpd:60, maxSpd:300, angle:-Math.PI/2, spread:Math.PI});
      }, ii*120); })(i);
    }

    _updateSSJBtn();
    return true;
  }

  function update(dt, player) {
    if (_state === 'active') {
      _timer -= dt;
      if (_timer <= 0) {
        _timer = 0;
        _state = 'cooldown';
        _timer = COOLDOWN;
        if (player) { player.powered = false; player.powT = 0; player.auraOn = false; }
        var ov = document.getElementById('ssjOverlay');
        if (ov) ov.classList.remove('on');
        shakeScreen(4, 0.3);
      }
      // Sync player powT
      if (player && player.powered) player.powT = Math.max(player.powT, _timer);
    } else if (_state === 'cooldown') {
      _timer -= dt;
      if (_timer <= 0) { _timer = 0; _state = 'idle'; }
    }
    _updateSSJBtn();
    _updateSSJHUD();
  }

  function reset() {
    _state = 'idle'; _timer = 0;
    var ov = document.getElementById('ssjOverlay');
    if (ov) ov.classList.remove('on');
    _updateSSJBtn();
    var st = document.getElementById('ssjTimer');
    if (st) st.classList.remove('show');
  }

  function _updateSSJBtn() {
    var btn = document.getElementById('abSSJ');
    if (!btn) return;
    btn.classList.remove('ready','active','cooldown');
    if (_state === 'active') btn.classList.add('active');
    else if (_state === 'cooldown') btn.classList.add('cooldown');
    else btn.classList.add('ready');
  }

  function _updateSSJHUD() {
    var st = document.getElementById('ssjTimer');
    var sf = document.getElementById('ssjTimerFill');
    if (!st || !sf) return;
    if (_state === 'active') {
      st.classList.add('show');
      sf.style.width = (_timer / DURATION * 100) + '%';
    } else {
      st.classList.remove('show');
    }
  }

  function handleInput(player) {
    var tKey = Keys['t'] || Keys['T'] || Keys['transform'] || JD['transform'] || GamepadInput.buttonJustDown('transform') || GamepadInput.button('transform');
    if (tKey && !_wasKey) {
      _wasKey = true;
      transform(player);
    }
    if (!tKey) _wasKey = false;
  }

  function getState() { return _state; }
  function getTimer() { return _timer; }
  function getCooldownMax() { return COOLDOWN; }
  function getDuration() { return DURATION; }

  return { canTransform, transform, update, reset, handleInput, getState, getTimer };
})();

/* ==========================================================================
   PHASE 5 — SKILL UNLOCK SYSTEM
   Skills persist via localStorage. Points awarded per level completion.
   ========================================================================== */
var Skills = (function(){
  // Skill definitions
  var DEFS = [
    { id:'ki_boost',     name:'KI BOOST',        icon:'💥', cost:1,
      desc:'Ki blast deals 25% more damage', req:null,
      apply:function(p){ p.kiDmgMult = 1.25; } },
    { id:'fast_charge',  name:'FAST CHARGE',      icon:'⚡', cost:1,
      desc:'Kamehameha charges 35% faster', req:null,
      apply:function(p){ p.chargeMult = 0.65; } },
    { id:'double_jump',  name:'DOUBLE JUMP+',     icon:'🦅', cost:2,
      desc:'Gain a third jump in the air', req:null,
      apply:function(p){ p.maxJumps = 3; } },
    { id:'ssj_extend',   name:'SSJ EXTEND',       icon:'⚡', cost:2,
      desc:'Super Saiyan lasts 6s longer', req:'ki_boost',
      apply:function(){ /* handled in SSJ */ } },
    { id:'combo_ext',    name:'COMBO EXTEND',     icon:'👊', cost:2,
      desc:'Melee combo extends to 4 hits', req:'ki_boost',
      apply:function(p){ p.chainMaxHit = 4; } },
    { id:'ki_regen',     name:'KI REGEN',         icon:'🌀', cost:2,
      desc:'Ki regenerates 50% faster', req:'fast_charge',
      apply:function(p){ p.kiRegenMult = 1.5; } },
    { id:'iron_defense', name:'IRON DEFENSE',     icon:'🛡', cost:3,
      desc:'Take 20% less damage', req:'double_jump',
      apply:function(p){ p.defMult = 0.8; } },
    { id:'final_flash',  name:'FINAL FLASH',      icon:'✨', cost:3,
      desc:'Kamehameha deals 50% more damage', req:'ssj_extend',
      apply:function(p){ p.kameDmgMult = 1.5; } },
  ];

  var _points = 0;
  var _unlocked = {};    // id → true
  var _fromMenu = false; // whether skills screen opened from menu or pause

  function _load() {
    try {
      _points = parseInt(localStorage.getItem('dbz_sp') || '0', 10);
      var u = JSON.parse(localStorage.getItem('dbz_skills') || '{}');
      _unlocked = u;
    } catch(e) { _points = 0; _unlocked = {}; }
  }

  function _save() {
    try {
      localStorage.setItem('dbz_sp', _points);
      localStorage.setItem('dbz_skills', JSON.stringify(_unlocked));
    } catch(e) {}
  }

  function reset() {
    _points = 0; _unlocked = {};
    _save();
  }

  function awardPoints(n) {
    _points += n; _save();
  }

  function unlock(id, player) {
    var def = getDef(id);
    if (!def) return false;
    if (_unlocked[id]) return false;
    if (def.req && !_unlocked[def.req]) return false;
    if (_points < def.cost) return false;
    _points -= def.cost;
    _unlocked[id] = true;
    _save();
    if (player) def.apply(player);
    return true;
  }

  function isUnlocked(id) { return !!_unlocked[id]; }
  function getDef(id) {
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return DEFS[i];
    return null;
  }
  function getAll() { return DEFS; }
  function getPoints() { return _points; }

  // Apply all unlocked skills to a player instance
  function applyAll(player) {
    if (!player) return;
    DEFS.forEach(function(d){
      if (_unlocked[d.id]) d.apply(player);
    });
  }

  // Build and render the skill grid UI
  function renderGrid(player) {
    var grid = document.getElementById('skillGrid');
    var pts = document.getElementById('skillPoints');
    if (!grid) return;
    if (pts) pts.textContent = 'SKILL POINTS: ' + _points;
    grid.innerHTML = '';
    DEFS.forEach(function(d){
      var locked = d.req && !_unlocked[d.req];
      var unlocked = _unlocked[d.id];
      var canAfford = _points >= d.cost;
      var card = document.createElement('div');
      card.className = 'skillCard' + (unlocked?' unlocked':locked?' locked':'');
      card.innerHTML =
        '<div class="sk-icon">' + d.icon + '</div>' +
        '<div class="sk-name">' + d.name + '</div>' +
        '<div class="sk-desc">' + d.desc + '</div>' +
        '<div class="sk-cost">' + (unlocked ? 'UNLOCKED' : d.cost + ' PT' + (d.cost>1?'S':'')) + '</div>' +
        (locked ? '<div class="sk-lock">🔒</div>' : '');
      if (!unlocked && !locked) {
        card.style.cursor = canAfford ? 'pointer' : 'not-allowed';
        card.style.opacity = canAfford ? '1' : '0.55';
        card.addEventListener('click', function(){
          if (unlock(d.id, player || GS.player)) {
            renderGrid(player);
            showSkillToast('✓ ' + d.name + ' UNLOCKED!');
          }
        });
        card.addEventListener('touchend', function(e){
          e.preventDefault();
          if (unlock(d.id, player || GS.player)) {
            renderGrid(player);
            showSkillToast('✓ ' + d.name + ' UNLOCKED!');
          }
        }, {passive:false});
      }
      grid.appendChild(card);
    });
  }

  _load();

  return { awardPoints, unlock, isUnlocked, applyAll, getAll, getPoints, reset, renderGrid, getDef };
})();

var _skillToastTimer = null;
function showSkillToast(msg) {
  var el = document.getElementById('skillToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_skillToastTimer);
  _skillToastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2200);
}

/* ==========================================================================
   PHASE 4 & 5: KEYBOARD INPUT MANAGER + GAMEPAD API (desktop standard)
   ========================================================================== */
var Keys = {}, JD = {}, JU = {};
var Mob = { left: false, right: false, up: false, attack: false, blast: false, special: false, air: false };
var KMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', A: 'left', d: 'right', D: 'right', w: 'up', W: 'up', s: 'down', S: 'down',
  ' ': 'up',
  j: 'attack', J: 'attack', k: 'blast', K: 'blast', l: 'special', L: 'special',
  i: 'air', I: 'air',
  e: 'transform', E: 'transform', t: 'transform', T: 'transform',
  p: 'pause', P: 'pause', Escape: 'pause',
  f: 'fullscreen', F: 'fullscreen', F3: 'debug'
};
var _gameKeys = [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S', 'j', 'J', 'k', 'K', 'l', 'L', 'i', 'I', 'e', 'E', 't', 'T', 'p', 'P', 'Escape', 'f', 'F', 'F3'];

document.addEventListener('keydown', function (e) {
  var k = KMAP[e.key] || e.key;
  if (!Keys[k]) JD[k] = true;
  Keys[k] = true;
  Audio.init();
  Audio.resume();
  if (_gameKeys.indexOf(e.key) >= 0) e.preventDefault();
});
document.addEventListener('keyup', function (e) {
  var k = KMAP[e.key] || e.key;
  JU[k] = true;
  Keys[k] = false;
});

// ── PHASE 5: Gamepad API — Xbox/PS/generic, dead zone, connection toast ─
var GamepadInput = (function () {
  var _connected = false;
  var _lastConnected = false;
  var _axes = [0, 0];
  var _buttons = {};
  var DEAD = 0.22;
  var BUTTON_MAP = { 0: 'up', 1: 'blast', 2: 'attack', 3: 'transform', 4: 'special', 5: 'special', 6: 'pause', 7: 'pause', 8: 'pause', 9: 'pause' };

  function poll() {
    var gp = navigator.getGamepads && navigator.getGamepads()[0];
    _connected = !!(gp && gp.connected);
    if (!_connected) {
      _axes[0] = _axes[1] = 0;
      for (var b in _buttons) _buttons[b] = false;
      return;
    }
    _axes[0] = Math.abs(gp.axes[0]) > DEAD ? gp.axes[0] : 0;
    _axes[1] = Math.abs(gp.axes[1]) > DEAD ? gp.axes[1] : 0;
    for (var i = 0; i < Math.min(gp.buttons.length, 16); i++) {
      var v = gp.buttons[i];
      var pressed = typeof v === 'object' ? v.pressed : v === 1;
      var name = BUTTON_MAP[i] || ('btn' + i);
      if (!_buttons[name]) _buttons[name] = { pressed: false, justDown: false };
      _buttons[name].justDown = pressed && !_buttons[name].pressed;
      _buttons[name].pressed = pressed;
    }
    if (_connected && !_lastConnected) {
      _lastConnected = true;
      showControllerConnected();
    } else if (!_connected) _lastConnected = false;
  }

  function leftStickX() { return _axes[0]; }
  function leftStickY() { return _axes[1]; }
  function button(name) { return _buttons[name] ? _buttons[name].pressed : false; }
  function buttonJustDown(name) { var b = _buttons[name]; return b ? b.justDown : false; }
  function isConnected() { return _connected; }

  return { poll: poll, leftStickX: leftStickX, leftStickY: leftStickY, button: button, buttonJustDown: buttonJustDown, isConnected: isConnected };
})();

function showControllerConnected() {
  var el = document.getElementById('controllerToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'controllerToast';
    el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,180,80,0.9);color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;z-index:9999;pointer-events:none;animation:fadeInOut 2.5s ease forwards;';
    document.body.appendChild(el);
  }
  el.textContent = 'Controller connected';
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'fadeInOut 2.5s ease forwards';
}

function bindMob(id,prop){
  var el=document.getElementById(id); if(!el)return;
  function on(e){
    // Mouse support only (touch handled by TouchInputManager)
    Mob[prop]=true;
    // Init audio on first interaction
    Audio.init(); Audio.resume();
  }
  function off(e){e.preventDefault();Mob[prop]=false;}
  // Do not bind touch here to avoid conflicts with multi-touch manager
  el.addEventListener('mousedown',on);
  el.addEventListener('mouseup',off);
  el.addEventListener('mouseleave',off);
}
bindMob('dpL','left'); bindMob('dpR','right'); bindMob('dpU','up');
bindMob('abJump','up'); bindMob('abAttack','attack'); bindMob('abBlast','blast');
bindMob('abKame','special'); bindMob('abAir','air');

// Multi-touch manager: maps touches -> Mob state by tracking identifiers
var TouchInputManager = (function(){
  var touchMap = {}; // id -> prop
  var zones = [
    ['dpL','left'],['dpR','right'],['dpU','up'],['abJump','up'],['abAttack','attack'],['abBlast','blast'],['abKame','special'],['abAir','air'],['abSSJ','transform']
  ];

  function _elemForPoint(x,y){
    for(var i=0;i<zones.length;i++){
      var id = zones[i][0], prop = zones[i][1];
      var el = document.getElementById(id);
      if(!el) continue;
      var r = el.getBoundingClientRect();
      if(x>=r.left && x<=r.right && y>=r.top && y<=r.bottom) return {id:id,prop:prop};
    }
    return null;
  }

  function onTouchStart(e){
    if(e&&e.preventDefault) e.preventDefault();
    for(var i=0;i<e.changedTouches.length;i++){
      var t = e.changedTouches[i];
      var hit = _elemForPoint(t.clientX, t.clientY);
      if(hit){ touchMap[t.identifier] = hit.prop; Mob[hit.prop] = true; Audio.init(); Audio.resume(); if(_fpsDebug) console.log('TOUCH START', t.identifier, hit.id, hit.prop); }
    }
  }
  function onTouchMove(e){
    if(e&&e.preventDefault) e.preventDefault();
    for(var i=0;i<e.changedTouches.length;i++){
      var t=e.changedTouches[i];
      var prev = touchMap[t.identifier] || null;
      var hit = _elemForPoint(t.clientX,t.clientY);
      var nowProp = hit ? hit.prop : null;
      if(prev !== nowProp){
        if(prev) { Mob[prev] = false; if(_fpsDebug) console.log('TOUCH MOVE release', t.identifier, prev); }
        if(nowProp){ Mob[nowProp] = true; touchMap[t.identifier]=nowProp; if(_fpsDebug) console.log('TOUCH MOVE press', t.identifier, hit.id, nowProp); }
        else delete touchMap[t.identifier];
      }
    }
  }
  function onTouchEnd(e){
    if(e&&e.preventDefault) e.preventDefault();
    for(var i=0;i<e.changedTouches.length;i++){
      var t=e.changedTouches[i];
      var prop = touchMap[t.identifier];
      if(prop){ Mob[prop]=false; if(_fpsDebug) console.log('TOUCH END', t.identifier, prop); }
      delete touchMap[t.identifier];
    }
  }

  function init(){
    try{ document.body.style.touchAction = 'none'; }catch(e){}
    var mctl = document.getElementById('mobileCtrl'); if(mctl) try{ mctl.style.touchAction = 'none'; }catch(e){}
    document.addEventListener('touchstart', onTouchStart, {passive:false});
    document.addEventListener('touchmove', onTouchMove, {passive:false});
    document.addEventListener('touchend', onTouchEnd, {passive:false});
    document.addEventListener('touchcancel', onTouchEnd, {passive:false});

    // Mouse fallback for mobile buttons
    zones.forEach(function(z){
      var el = document.getElementById(z[0]); if(!el) return;
      el.addEventListener('mousedown', function(e){ e.preventDefault(); Mob[z[1]] = true; Audio.init(); Audio.resume(); if(_fpsDebug) console.log('MOUSE DOWN', z[0], z[1]); });
      el.addEventListener('mouseup', function(e){ e.preventDefault(); Mob[z[1]] = false; if(_fpsDebug) console.log('MOUSE UP', z[0], z[1]); });
      el.addEventListener('mouseleave', function(e){ Mob[z[1]] = false; });
    });
  }

  return { init: init };
})();

// Start touch manager early so it overrides naive handlers
TouchInputManager.init();

var In = {
  left:    function () { return !!(Keys.left || Mob.left || GamepadInput.leftStickX() < -0.5); },
  right:   function () { return !!(Keys.right || Mob.right || GamepadInput.leftStickX() > 0.5); },
  up:      function () { return !!(Keys.up || Mob.up || GamepadInput.button('up')); },
  attack:  function () { return !!(Keys.attack || Mob.attack || GamepadInput.button('attack')); },
  blast:   function () { return !!(Keys.blast || Mob.blast || GamepadInput.button('blast')); },
  special: function () { return !!(Keys.special || Mob.special || GamepadInput.button('special')); },
  air:     function () { return !!(Keys.air || Mob.air); },
  jd:      function (k) { return !!JD[k]; },
  wasUp:   function () { return !!(JD.up || GamepadInput.buttonJustDown('up')); },
  wasAir:  function () { return !!JD.air; }
};
function flushInput() { for (var k in JD) delete JD[k]; for (var k in JU) delete JU[k]; }

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    var wrap = document.getElementById('wrap');
    if (wrap && wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
  } else if (document.exitFullscreen) document.exitFullscreen();
}

/* ==========================================================================
   PHYSICS CONSTANTS
   ========================================================================== */
var GRAV=1380, MAX_FALL=880, FRIC_GND=0.80, FRIC_AIR=0.96;

/* ==========================================================================
   PHASE 7: PARTICLE SYSTEM + OBJECT POOL (minimize GC)
   ========================================================================== */
var _particles = [];
var _particlePool = [];
var PARTICLE_POOL_MAX = 400;

function _pAlloc() {
  if (_particlePool.length > 0) return _particlePool.pop();
  return { x: 0, y: 0, vx: 0, vy: 0, life: 1, ml: 1, size: 4, color: '#fff', grav: 180, glow: false };
}

function pSpawn(x, y, opts) {
  if (!isFinite(x) || !isFinite(y)) return;
  opts = opts || {};
  var n = Math.min(opts.n || 1, 50);
  for (var i = 0; i < n; i++) {
    var ang = opts.angle !== undefined ? opts.angle + rand(-(opts.spread || 0), (opts.spread || 0)) : Math.random() * Math.PI * 2;
    var spd = rand(opts.minSpd || 40, opts.maxSpd || 140);
    var p = _pAlloc();
    p.x = x; p.y = y;
    p.vx = Math.cos(ang) * spd + (opts.vx || 0);
    p.vy = Math.sin(ang) * spd + (opts.vy || 0);
    p.life = 1;
    p.ml = rand(opts.minLife || 0.25, opts.maxLife || 0.65);
    p.size = opts.size || rand(3, 8);
    p.color = opts.color || '#fff';
    p.grav = opts.grav !== undefined ? opts.grav : 180;
    p.glow = !!opts.glow;
    _particles.push(p);
  }
}
function pUpdate(dt) {
  for (var i = _particles.length - 1; i >= 0; i--) {
    var p = _particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += p.grav * dt; p.vx *= 0.97;
    p.life -= dt / p.ml;
    if (p.life <= 0) {
      _particles.splice(i, 1);
      if (_particlePool.length < PARTICLE_POOL_MAX) _particlePool.push(p);
    }
  }
}
function pDraw(){
  var cx=cam.x,cy=cam.y||0;
  for(var i=0;i<_particles.length;i++){
    var p=_particles[i];
    ctx.save();
    ctx.globalAlpha=clamp(p.life,0,1);
    if(p.glow){ctx.shadowColor=p.color;ctx.shadowBlur=11;}
    ctx.fillStyle=p.color;
    var s=p.size*Math.max(0.1,p.life);
    ctx.beginPath(); ctx.arc(p.x-cx,p.y-cy,s*0.5,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

/* ==========================================================================
   PROJECTILE CLASS + PHASE 7 POOL
   ========================================================================== */
function Proj(x, y, vx, vy, owner, opts) {
  opts = opts || {};
  this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.owner = owner;
  this.dmg = opts.dmg || 10; this.color = opts.color || '#ffff00';
  this.r = opts.r || 7; this.life = opts.life || 1.4; this.grav = opts.grav || 0;
  this.isKame = !!opts.isKame; this.dead = false; this.phase = 0;
  this.tx = []; this.ty = [];
}
Proj.prototype.reset = function (x, y, vx, vy, owner, opts) {
  opts = opts || {};
  this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.owner = owner;
  this.dmg = opts.dmg || 10; this.color = opts.color || '#ffff00';
  this.r = opts.r || 7; this.life = opts.life || 1.4; this.grav = opts.grav || 0;
  this.isKame = !!opts.isKame; this.dead = false; this.phase = 0;
  this.tx.length = 0; this.ty.length = 0;
};
var _projPool = [];
function ProjPoolGet(x, y, vx, vy, owner, opts) {
  var p;
  if (_projPool.length > 0) {
    p = _projPool.pop();
    p.reset(x, y, vx, vy, owner, opts);
  } else {
    p = new Proj(x, y, vx, vy, owner, opts);
  }
  return p;
}
function ProjPoolRelease(proj) {
  if (_projPool.length < 80) _projPool.push(proj);
}
Proj.prototype.gb=function(){return{x:this.x-this.r,y:this.y-this.r,w:this.r*2,h:this.r*2};};
Proj.prototype.update=function(dt){
  this.phase+=dt*9; this.vy+=this.grav*dt;
  this.x+=this.vx*dt; this.y+=this.vy*dt; this.life-=dt;
  this.tx.unshift(this.x); this.ty.unshift(this.y);
  if(this.tx.length>7){this.tx.pop();this.ty.pop();}
  if(this.life<=0)this.dead=true;
};
Proj.prototype.draw=function(camX){
  var cy=cam.y||0;
  var sx=this.x-camX,sy=this.y-cy;
  ctx.save();
  for(var i=0;i<this.tx.length;i++){
    var t=1-i/this.tx.length;
    ctx.globalAlpha=t*0.3; ctx.fillStyle=this.color;
    ctx.beginPath(); ctx.arc(this.tx[i]-camX,this.ty[i]-cy,this.r*t*0.6,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
  ctx.shadowColor=this.color; ctx.shadowBlur=this.isKame?26:13;
  var g=ctx.createRadialGradient(sx,sy,0,sx,sy,this.r);
  g.addColorStop(0,'#fff'); g.addColorStop(0.45,this.color); g.addColorStop(1,this.color+'00');
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.arc(sx,sy,this.r*(1+0.12*Math.sin(this.phase)),0,Math.PI*2); ctx.fill();
  ctx.restore();
};

/* ==========================================================================
   CAMERA — follows player, clamped to world and GAME_VIEW; hero always visible
   ========================================================================== */
var cam = { x: 0, y: 0, sx: 0, sy: 0, st: 0, sa: 0 };
var WORLD_TOP = 80;
var WORLD_TOP_OFFSET = 0; // set in resizeCanvas

function shakeScreen(amt, dur) { cam.sa = amt; cam.st = dur; }

/* ==========================================================================
   PHASE 8: Damage number pop-ups (desktop polish)
   ========================================================================== */
var _damageNumbers = [];
function spawnDamageNum(x, y, value, color) {
  _damageNumbers.push({ x: x, y: y, value: value, t: 0.9, color: color || '#ffe234' });
}
function updateDamageNumbers(dt) {
  for (var i = _damageNumbers.length - 1; i >= 0; i--) {
    _damageNumbers[i].t -= dt;
    _damageNumbers[i].y -= 45 * dt;
    if (_damageNumbers[i].t <= 0) _damageNumbers.splice(i, 1);
  }
}
function drawDamageNumbers(cx) {
  var cy0 = cam.y || 0;
  for (var i = 0; i < _damageNumbers.length; i++) {
    var d = _damageNumbers[i];
    var sx = d.x - cx;
    var sy = d.y - cy0 - 20;
    ctx.save();
    ctx.globalAlpha = Math.max(0, d.t / 0.3);
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = d.color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.strokeText('' + d.value, sx, sy);
    ctx.fillText('' + d.value, sx, sy);
    ctx.restore();
  }
}

function updateCam(dt, px, py, worldW, facing) {
  var lookAhead = (facing === 1 ? 1 : facing === -1 ? -1 : 0) * Math.min(120, VW * 0.08);
  var targetX = px - VW * 0.35 + lookAhead;
  cam.x = lerp(cam.x, targetX, dt * 7.5);
  cam.x = clamp(cam.x, 0, Math.max(0, worldW - VW));
  var viewH = VH - (WORLD_TOP_OFFSET || 0) * 2;
  if (viewH > 0 && WORLD_HEIGHT > viewH) {
    var targetY = py - viewH * 0.5 - 24;
    cam.y = lerp(cam.y, targetY, dt * 7.5);
    cam.y = clamp(cam.y, 0, Math.max(0, WORLD_HEIGHT - viewH));
  } else { cam.y = 0; }
  // Ensure player remains within visible vertical band (extra safety)
  try {
    var topGap = 28, bottomGap = 84;
    if (py < cam.y + topGap) cam.y = clamp(py - topGap, 0, Math.max(0, WORLD_HEIGHT - viewH));
    if (py > cam.y + viewH - bottomGap) cam.y = clamp(py - (viewH - bottomGap), 0, Math.max(0, WORLD_HEIGHT - viewH));
  } catch(e) { /* defensive */ }
  if (cam.st > 0) {
    cam.st -= dt;
    var d = cam.st > 0 ? cam.st / 0.7 : 0;
    cam.sx = rand(-cam.sa, cam.sa) * d;
    cam.sy = rand(-cam.sa, cam.sa) * 0.4 * d;
  } else { cam.sx = 0; cam.sy = 0; }
}

/* ==========================================================================
   LEVEL DATA — All 5 levels
   ========================================================================== */
var LEVELS=[
  /* ── Level 1: Raditz's Landing ───────────────────────────────────── */
  {id:1,name:"RADITZ'S LANDING",worldW:3200,ps:{x:120,y:300},
   bg:{s0:'#1a2a5e',s1:'#060e28'},
   plat:[
     {x:-200,y:450,w:4000,h:80,color:'#2d5a1b',dk:'#173210',ground:true},
     {x:300,y:320,w:140,h:20,color:'#3d6a20'},{x:510,y:260,w:120,h:20,color:'#3d6a20'},
     {x:700,y:305,w:150,h:20,color:'#3d6a20'},{x:900,y:238,w:110,h:20,color:'#3d6a20'},
     {x:1100,y:298,w:140,h:20,color:'#3d6a20'},{x:1340,y:255,w:120,h:20,color:'#3d6a20'},
     {x:1540,y:345,w:160,h:20,color:'#3d6a20'},{x:1790,y:278,w:140,h:20,color:'#3d6a20'},
     {x:1990,y:218,w:120,h:20,color:'#3d6a20'},{x:2190,y:315,w:180,h:20,color:'#3d6a20'},
     {x:2490,y:258,w:140,h:20,color:'#5a3a1a'},{x:2690,y:308,w:120,h:20,color:'#5a3a1a'}
   ],
   pu:{x:1510,y:188},
   vil:{name:'RADITZ',introText:'A SAIYAN WARRIOR DESCENDS!',
        color:'#663399',aura:'#aa44ff',x:2880,y:368,hp:155,speed:195,dmg:14,atkCD:1.42,ultCD:14,
        pats:['projectile','trishot','groundwave','ultimate']}},

  /* ── Level 2: Nappa's Destruction ───────────────────────────────── */
  {id:2,name:"NAPPA'S DESTRUCTION",worldW:3600,ps:{x:120,y:300},
   bg:{s0:'#3a1a00',s1:'#180800'},
   plat:[
     {x:-200,y:450,w:4600,h:80,color:'#4a2a0a',dk:'#2a1200',ground:true},
     {x:275,y:308,w:120,h:20,color:'#6a3a0a'},{x:475,y:248,w:100,h:20,color:'#6a3a0a'},
     {x:645,y:298,w:140,h:20,color:'#6a3a0a'},{x:855,y:218,w:120,h:20,color:'#6a3a0a'},
     {x:1045,y:288,w:130,h:20,color:'#6a3a0a'},{x:1295,y:248,w:110,h:20,color:'#6a3a0a'},
     {x:1495,y:338,w:150,h:20,color:'#6a3a0a'},{x:1745,y:268,w:130,h:20,color:'#6a3a0a'},
     {x:1945,y:208,w:110,h:20,color:'#6a3a0a'},{x:2145,y:308,w:170,h:20,color:'#6a3a0a'},
     {x:2395,y:248,w:130,h:20,color:'#5a1a18'},{x:2645,y:298,w:120,h:20,color:'#5a1a18'},
     {x:2895,y:238,w:140,h:20,color:'#5a1a18'},{x:3095,y:308,w:120,h:20,color:'#5a1a18'}
   ],
   pu:{x:1800,y:172},
   vil:{name:'NAPPA',introText:'THE GIANT SAIYAN APPEARS!',
        color:'#884422',aura:'#ff6600',x:3280,y:358,w:58,h:64,hp:265,speed:158,dmg:21,atkCD:1.78,ultCD:10,
        pats:['groundwave','trishot','airburst','projectile','ultimate']}},

  /* ── Level 3: Vegeta's Wrath ─────────────────────────────────────── */
  {id:3,name:"VEGETA'S WRATH",worldW:4000,ps:{x:120,y:300},
   bg:{s0:'#00000e',s1:'#000000'},
   plat:[
     {x:-200,y:450,w:5200,h:80,color:'#18182a',dk:'#0a0a18',ground:true},
     {x:248,y:298,w:110,h:20,color:'#28284a'},{x:438,y:238,w:100,h:20,color:'#28284a'},
     {x:618,y:288,w:130,h:20,color:'#28284a'},{x:828,y:208,w:110,h:20,color:'#28284a'},
     {x:1018,y:278,w:120,h:20,color:'#28284a'},{x:1248,y:228,w:100,h:20,color:'#28284a'},
     {x:1428,y:328,w:140,h:20,color:'#28284a'},{x:1678,y:258,w:120,h:20,color:'#28284a'},
     {x:1878,y:198,w:100,h:20,color:'#28284a'},{x:2078,y:288,w:160,h:20,color:'#28284a'},
     {x:2348,y:238,w:120,h:20,color:'#380a38'},{x:2598,y:288,w:110,h:20,color:'#380a38'},
     {x:2848,y:218,w:130,h:20,color:'#380a38'},{x:3098,y:278,w:120,h:20,color:'#380a38'},
     {x:3348,y:238,w:140,h:20,color:'#380a38'}
   ],
   pu:{x:2000,y:152},
   vil:{name:'VEGETA',introText:"IT'S OVER 9000!",
        color:'#330066',aura:'#cc00ff',x:3680,y:358,w:44,h:52,hp:425,speed:248,dmg:27,atkCD:0.98,ultCD:8,
        pats:['trishot','airburst','groundwave','projectile','trishot','ultimate']}},

  /* ── Level 4: Frieza's Throne ─────────────────────────────────────
     Frieza uses teleport-dash before firing precision death beams.
     New patterns: dashbeam, barrage, deathball                        */
  {id:4,name:"FRIEZA'S THRONE",worldW:4400,ps:{x:120,y:290},
   bg:{s0:'#001520',s1:'#000000'},
   plat:[
     {x:-200,y:450,w:5600,h:80,color:'#0a1a2a',dk:'#040e18',ground:true},
     {x:220,y:310,w:100,h:18,color:'#2a6a8a'},{x:390,y:255,w:85,h:18,color:'#2a6a8a'},
     {x:540,y:305,w:100,h:18,color:'#2a6a8a'},{x:700,y:235,w:90,h:18,color:'#2a6a8a'},
     {x:860,y:285,w:110,h:18,color:'#2a6a8a'},{x:1050,y:215,w:90,h:18,color:'#2a6a8a'},
     {x:1230,y:310,w:80,h:18,color:'#1a5a7a'},{x:1380,y:250,w:90,h:18,color:'#1a5a7a'},
     {x:1540,y:300,w:100,h:18,color:'#1a5a7a'},{x:1710,y:225,w:85,h:18,color:'#1a5a7a'},
     {x:1880,y:295,w:110,h:18,color:'#1a5a7a'},{x:2060,y:215,w:90,h:18,color:'#1a5a7a'},
     {x:2280,y:300,w:140,h:18,color:'#0a4060'},{x:2500,y:240,w:120,h:18,color:'#0a4060'},
     {x:2720,y:290,w:150,h:18,color:'#0a4060'},{x:2960,y:225,w:130,h:18,color:'#0a4060'},
     {x:3200,y:285,w:160,h:18,color:'#0a4060'},{x:3460,y:235,w:140,h:18,color:'#0a4060'},
     {x:3700,y:300,w:180,h:18,color:'#0a3050'}
   ],
   pu:{x:2100,y:178},
   vil:{name:'FRIEZA',introText:'THE EMPEROR OF THE UNIVERSE!',
        color:'#aa2244',aura:'#ff4488',x:4050,y:360,w:46,h:58,
        hp:580,speed:280,dmg:32,atkCD:0.88,ultCD:7,
        pats:['dashbeam','trishot','barrage','projectile','dashbeam','deathball','ultimate'],
        teleports:true}},

  /* ── Level 5: Cell's Perfect Form ────────────────────────────────
     Cell uses screen-blind solarflare and spiraling energy beams.
     New patterns: solarflare, spiralbeam                              */
  {id:5,name:"CELL'S PERFECT FORM",worldW:4800,ps:{x:120,y:280},
   bg:{s0:'#0a1a00',s1:'#000000'},
   plat:[
     {x:-200,y:450,w:6200,h:80,color:'#0a1a00',dk:'#040e00',ground:true},
     {x:200,y:308,w:120,h:20,color:'#1a3a0a'},{x:390,y:248,w:100,h:20,color:'#1a3a0a'},
     {x:560,y:300,w:130,h:20,color:'#1a3a0a'},{x:750,y:225,w:110,h:20,color:'#1a3a0a'},
     {x:940,y:290,w:120,h:20,color:'#1a3a0a'},{x:1130,y:218,w:100,h:20,color:'#1a3a0a'},
     {x:1310,y:308,w:140,h:20,color:'#2a4a0a'},{x:1530,y:248,w:120,h:20,color:'#2a4a0a'},
     {x:1730,y:298,w:130,h:20,color:'#2a4a0a'},{x:1940,y:215,w:110,h:20,color:'#2a4a0a'},
     {x:2140,y:285,w:150,h:20,color:'#2a4a0a'},{x:2380,y:228,w:130,h:20,color:'#2a4a0a'},
     {x:2640,y:295,w:160,h:20,color:'#1a3a00'},{x:2900,y:225,w:140,h:20,color:'#1a3a00'},
     {x:3160,y:285,w:160,h:20,color:'#1a3a00'},{x:3430,y:220,w:150,h:20,color:'#1a3a00'},
     {x:3720,y:280,w:180,h:20,color:'#1a3a00'},{x:4020,y:225,w:160,h:20,color:'#1a3a00'},
     {x:4320,y:290,w:200,h:20,color:'#0a2a00'}
   ],
   pu:{x:2400,y:185},
   vil:{name:'CELL',introText:'MY PERFECT FORM IS COMPLETE!',
        color:'#226600',aura:'#44ff44',x:4500,y:350,w:52,h:60,
        hp:800,speed:220,dmg:35,atkCD:1.1,ultCD:9,
        pats:['solarflare','spiralbeam','trishot','groundwave','barrage','projectile','solarflare','deathball','ultimate']}}
];

/* ==========================================================================
   PHASE 1 — PLAYER CLASS (upgraded with new attacks)
   New: 3-hit melee combo chain, air downward strike, audio integration
   ========================================================================== */
function Player(x,y){
  this.x=x;this.y=y;this.w=36;this.h=48;this.vx=0;this.vy=0;
  this.grounded=false;this.facing=1;this.jumps=2;
  this.maxHP=100;this.hp=100;this.maxKI=100;this.ki=100;
  this.spd=330;this.jpow=-630;

  // Cooldown timers
  this.atkCD=0;        // general melee cooldown
  this.blastCD=0;      // ki blast cooldown
  this.hitT=0;         // stagger time (input blocked)
  this.iT=0;           // invincibility frames

  // Kamehameha
  this.chargeT=0;
  this.charging=false;
  this._chargeAudioOn=false;  // tracks if charge audio loop is playing

  // Combo system
  this.combo=0;           // score combo counter
  this.comboT=0;          // decay timer
  // ── NEW: 3-hit melee chain ──
  this.hitChain=0;        // 1, 2, or 3 — which hit in the chain
  this.chainT=0;          // window to continue chain (resets between hits)
  this.chainMax=0.55;     // seconds window to land next hit

  // Power-up state
  this.powered=false;this.powT=0;
  this.auraP=0;this.auraOn=false;

  // State machine
  this.state='idle';this.stT=0;

  // Pending projectile slots — read by game loop then cleared
  this._melee=false;        // did we melee this frame?
  this._meleeHitNum=1;      // which hit in the chain (for knockback + audio)
  this._airAtk=false;       // downward air strike this frame
  this._blast=null;
  this._kame=null;

  this.dead=false;

  // ── Skill multipliers (set by Skills.applyAll) ────────────────────
  this.kiDmgMult    = 1.0;   // skill: ki_boost
  this.chargeMult   = 1.0;   // skill: fast_charge (multiplier on charge speed — <1 = faster)
  this.maxJumps     = 2;     // skill: double_jump+
  this.chainMaxHit  = 3;     // skill: combo_ext
  this.kiRegenMult  = 1.0;   // skill: ki_regen
  this.defMult      = 1.0;   // skill: iron_defense
  this.kameDmgMult  = 1.0;   // skill: final_flash
}

Player.prototype.gb=function(){return{x:this.x+4,y:this.y+2,w:this.w-8,h:this.h-2};};

// Melee hitbox — shifts forward based on facing; wider on chain hit 3
Player.prototype.meleeBounds=function(){
  var w = this.hitChain >= 3 ? 44 : 34;
  return{x:this.x+(this.facing>0?this.w:-w),y:this.y+8,w:w,h:30};
};

// Air attack hitbox — directly below player
Player.prototype.airBounds=function(){
  return{x:this.x+4,y:this.y+this.h-4,w:this.w-8,h:28};
};

Player.prototype.update=function(dt,plat){
  if(this.dead){this.stT+=dt;return;}
  this.stT+=dt;
  this.atkCD=Math.max(0,this.atkCD-dt);
  this.blastCD=Math.max(0,this.blastCD-dt);
  this.hitT=Math.max(0,this.hitT-dt);
  this.iT=Math.max(0,this.iT-dt);
  this.auraP+=dt*4.5;
  this.comboT=Math.max(0,this.comboT-dt);
  if(this.comboT<=0&&this.combo>0)this.combo=0;
  // Chain decay — if player doesn't follow up, chain resets
  if(this.chainT>0){
    this.chainT-=dt;
    if(this.chainT<=0){this.hitChain=0;this.chainT=0;}
  }
  if(!this.charging&&this.hitT<=0)this.ki=Math.min(this.maxKI,this.ki+7*(this.kiRegenMult||1)*dt);
  if(this.powered){this.powT-=dt;this.auraOn=true;if(this.powT<=0){this.powered=false;this.auraOn=false;}}
  if(this.hitT<=0)this._input(dt);
  this._physics(dt);
  this._collide(plat);
  this._state();
  if (this.grounded && this.state === 'run' && !this.dead) {
    this.runDustT = (this.runDustT || 0) - dt;
    if (this.runDustT <= 0) {
      this.runDustT = 0.08;
      pSpawn(this.x + this.w / 2, this.y + this.h, { n: 2, grav: 80, minLife: 0.15, maxLife: 0.3, color: '#886622', size: 4, minSpd: 5, maxSpd: 25, angle: -Math.PI / 2, spread: 0.4 });
    }
  }
};

/* ─────────────────────────────────────────────────────────────────────
   ATTACK HANDLER — Modular, all attacks processed here
   ───────────────────────────────────────────────────────────────────── */
Player.prototype._input=function(dt){
  // Clear pending attacks each frame
  this._blast=null; this._kame=null;
  this._melee=false; this._airAtk=false;

  /* ── Attack 2: Kamehameha (Hold L / KAME button) ─────────────────
     Charge while held, fire on release. Audio loop plays during charge. */
  if(In.special()){
    if(!this.charging){
      this.charging=true; this.chargeT=0; this.auraOn=true;
      // Start charge audio loop
      if(!this._chargeAudioOn){ Audio.chargeStart(); this._chargeAudioOn=true; }
    }
    this.chargeT+=dt;
    this.ki=Math.max(0,this.ki-14*dt);
    // Charge particle effect
    if(Math.random()<0.45)pSpawn(this.x+this.w/2,this.y+this.h/2,
      {n:2,grav:-90,minLife:0.3,maxLife:0.5,minSpd:18,maxSpd:55,
       color:this.powered?'#ff8800':'#00cfff',size:rand(4,11),glow:true});
  } else {
    // Released — fire if was charging long enough
    if(this.charging&&this.chargeT>0.22){
      this._doKame();
    } else if(this._chargeAudioOn) {
      // Held too briefly — just stop audio
      Audio.chargeStop(); this._chargeAudioOn=false;
    }
    this.charging=false; this.chargeT=0; this.auraOn=this.powered;
    this._chargeAudioOn=false;
  }

  /* ── Movement (blocked during charge) ───────────────────────────── */
  if(!this.charging){
    if(In.left()){this.vx=-this.spd*(this.powered?1.38:1);this.facing=-1;}
    if(In.right()){this.vx=this.spd*(this.powered?1.38:1);this.facing=1;}
  }

  /* ── Jump ────────────────────────────────────────────────────────── */
  if(In.wasUp()&&this.jumps>0&&!this.charging){
    this.vy=this.jpow; this.jumps--; this.grounded=false;
    Audio.jump();
    if(this.jumps===0)pSpawn(this.x+this.w/2,this.y+this.h/2,
      {n:9,grav:80,color:'#ffee44',size:6,glow:true,minSpd:55,maxSpd:120});
  }

  /* ── Super Saiyan trigger (T / SSJ button) ──────────────────────── */
  SSJ.handleInput(this);

  /* ── Attack 1: Melee Combo Chain (J / HIT button) ────────────────
     3-hit chain: hits 1+2 are quick jabs, hit 3 is a knockback punch.
     Player must press J again within chainMax seconds to continue.     */
  if(In.attack()&&this.atkCD<=0&&this.state!=='charge'){
    // Advance the chain (wraps back to 1 after chainMaxHit)
    this.hitChain = (this.hitChain >= this.chainMaxHit) ? 1 : this.hitChain + 1;
    this.chainT = this.chainMax;  // reset chain window

    var isFinisher = (this.hitChain >= this.chainMaxHit);
    // Cooldown — finisher takes longer to recover
    this.atkCD   = this.powered ? (isFinisher ? 0.32 : 0.16) : (isFinisher ? 0.52 : 0.26);
    this.hitT    = isFinisher ? 0.14 : 0.09;
    this.state   = 'attack'; this.stT = 0;
    this._melee  = true;
    this._meleeHitNum = this.hitChain;

    // Audio — pitch rises with hit number
    Audio.meleeHit(this.hitChain);

    // Particle burst at fist position
    var fistX = this.x + (this.facing>0 ? this.w+4 : -14);
    pSpawn(fistX, this.y+20, {
      n: isFinisher ? 10 : 5,
      grav:0, minLife:0.2, maxLife:isFinisher?0.4:0.28,
      angle:this.facing>0?0:Math.PI, spread:isFinisher?0.65:0.45,
      minSpd:isFinisher?100:75, maxSpd:isFinisher?200:155,
      color:this.powered?'#ff8800':'#ffee44', size:isFinisher?10:7, glow:true
    });
  }

  /* ── Attack 3: Ki Blast (K / KI button) ──────────────────────────
     Fast, low damage, spammable with a short cooldown.               */
  if(In.blast()&&this.blastCD<=0&&this.ki>=10&&!this.charging){
    this.blastCD=this.powered?0.19:0.34; this.ki-=10;
    Audio.kiBlast();
    this._blast={
      x:this.x+this.w/2+this.facing*20,
      y:this.y+this.h/2,
      vx:this.facing*490, vy:0,
      opts:{dmg:Math.round((this.powered?17:10)*(this.kiDmgMult||1)),
            color:this.powered?'#ff6600':'#00cfff',
            r:this.powered?10:7, life:0.92}
    };
  }

  /* ── Attack 4: Air Downward Strike (I / AIR button) ──────────────
     Only active while airborne. Slams downward, creates shockwave
     on landing. Cannot be used while grounded.                       */
  if(In.wasAir()&&!this.grounded&&this.atkCD<=0){
    this.atkCD  = this.powered ? 0.38 : 0.55;
    this.hitT   = 0.12;
    this._airAtk = true;
    // Drive player downward fast
    this.vy = Math.max(this.vy, 520);
    Audio.airSlam();
    this.state = 'attack'; this.stT = 0;
    pSpawn(this.x+this.w/2, this.y+this.h,
      {n:8,grav:-120,minLife:0.3,maxLife:0.5,
       angle:Math.PI/2,spread:0.55,
       minSpd:60,maxSpd:160,
       color:this.powered?'#ff44ff':'#aa44ff',size:8,glow:true});
  }
};

// Kamehameha fire — same logic as v1, plus audio
Player.prototype._doKame=function(){
  if(this.ki<5)return;
  var pow=clamp(this.chargeT/1.8,0.1,1),cost=28*pow;
  if(this.ki<cost)return; this.ki-=cost;
  Audio.kamehameha();
  this._chargeAudioOn=false;
  this._kame={x:this.x+(this.facing>0?this.w+8:-58),y:this.y+this.h/2,
    vx:this.facing*720,vy:0,
    opts:{dmg:Math.round((22+38*pow)*(this.kameDmgMult||1)),color:this.powered?'#ff4400':'#0088ee',
          r:8+pow*17,life:0.65+pow*0.38,isKame:true}};
  for(var i=0;i<16;i++)pSpawn(this.x+(this.facing>0?this.w:0),this.y+this.h/2,
    {n:1,grav:0,minLife:0.5,maxLife:0.7,angle:this.facing>0?0:Math.PI,spread:0.38+pow*0.35,
     minSpd:90,maxSpd:280,color:this.powered?'#ff8800':'#00cfff',size:rand(6,18),glow:true});
  shakeScreen(7*pow,0.38);
};

// Physics & collision (unchanged from v1)
Player.prototype._physics=function(dt){
  if(!this.grounded)this.vy=Math.min(this.vy+GRAV*dt,MAX_FALL);
  var f=this.grounded?FRIC_GND:FRIC_AIR;
  this.vx*=Math.pow(f,dt*60);
  if(Math.abs(this.vx)<0.8)this.vx=0;
  this.x+=this.vx*dt; this.y+=this.vy*dt;
};

Player.prototype._collide=function(plat){
  var was=this.grounded; this.grounded=false;
  if(!plat)return;
  for(var i=0;i<plat.length;i++){
    var pl=plat[i];
    if(!pl||typeof pl.x!=='number')continue;
    var pb=this.gb();
    if(!overlap(pb,pl))continue;
    var oL=(pb.x+pb.w)-pl.x,oR=(pl.x+pl.w)-pb.x,oT=(pb.y+pb.h)-pl.y,oB=(pl.y+pl.h)-pb.y;
    var mH=Math.min(oL,oR),mV=Math.min(oT,oB);
    if(mV<mH){
      if(oT<oB){this.y-=oT;if(this.vy>0)this.vy=0;this.grounded=true;}
      else if(!pl.thru){this.y+=oB;if(this.vy<0)this.vy=0;}
    } else if(!pl.thru){
      if(oL<oR)this.x-=oL;else this.x+=oR;this.vx=0;
    }
  }
  if(!was&&this.grounded){
    this.jumps=this.maxJumps||2;
    if(Math.abs(this.vy)>190)pSpawn(this.x+this.w/2,this.y+this.h,
      {n:7,grav:0,minLife:0.28,maxLife:0.42,angle:-Math.PI/2,spread:0.48,
       minSpd:28,maxSpd:68,color:'#fff',size:4});
    // Air slam landing shockwave
    if(this._airAtk){
      pSpawn(this.x+this.w/2,this.y+this.h,
        {n:14,grav:-60,minLife:0.4,maxLife:0.65,
         angle:0,spread:Math.PI,
         minSpd:80,maxSpd:220,
         color:this.powered?'#ff44ff':'#aa44ff',size:9,glow:true});
      shakeScreen(8,0.3);
      this._airAtk=false;
    }
  }
};

Player.prototype.takeDmg=function(amt,kx){
  if(this.iT>0||this.dead)return;
  amt = amt * (this.defMult || 1.0);
  spawnDamageNum(this.x+this.w/2, this.y, Math.round(amt), '#ff4466');
  this.hp=Math.max(0,this.hp-amt);
  this.iT=1.15; this.hitT=0.22;
  this.vx=kx||(Math.random()<0.5?-240:240); this.vy=-280;
  this.state='hit'; this.stT=0; this.combo=0;
  // Reset melee chain on getting hit
  this.hitChain=0; this.chainT=0;
  Audio.playerHit();
  shakeScreen(6,0.28);
  if(this.hp<=0){this.dead=true;this.state='dead';}
};

Player.prototype.powerUp=function(dur){
  this.powered=true;this.powT=dur||9;this.auraOn=true;
  Audio.powerUp();
  shakeScreen(9,0.55);
  var kf=document.getElementById('kiFlash');
  kf.style.transition='none';kf.style.opacity='1';
  void kf.offsetHeight;
  kf.style.transition='opacity 1.4s';kf.style.opacity='0';
};

Player.prototype._state=function(){
  if(this.dead)return;
  if(this.state==='attack'&&this.stT>0.17)this.state='idle';
  if(this.state==='hit'&&this.hitT<=0)this.state='idle';
  if(this.state==='attack'||this.state==='hit')return;
  if(this.charging)this.state='charge';
  else if(!this.grounded)this.state=this.vy<0?'jump':'fall';
  else if(Math.abs(this.vx)>18)this.state='run';
  else this.state=this.powered?'powered':'idle';
};

// Draw — uses cam.y so hero stays in visible band
Player.prototype.draw=function(camX,t){
  var sy=(this.y-(cam.y||0));
  var sx=this.x-camX;
  if(this.iT>0&&Math.floor(this.iT*11)%2===0){ctx.globalAlpha=0.28;}
  if(this.auraOn){
    var aR=this.w*0.88+Math.sin(this.auraP)*5;
    ctx.save();
    ctx.globalAlpha*=(0.13+0.09*Math.sin(this.auraP*2));
    var ac=this.powered?'rgba(255,140,0,':'rgba(0,175,255,';
    var ag=ctx.createRadialGradient(sx+this.w/2,sy+this.h/2,0,sx+this.w/2,sy+this.h/2,aR*1.6);
    ag.addColorStop(0,ac+'0.9)');ag.addColorStop(1,ac+'0)');
    ctx.fillStyle=ag;ctx.beginPath();
    ctx.ellipse(sx+this.w/2,sy+this.h/2,aR*1.6,aR*2.1,0,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(sx+this.w/2,sy+this.h/2);
  if(this.facing<0)ctx.scale(-1,1);
  this._body(t);
  ctx.restore();
  ctx.globalAlpha=1;
  if(this.charging){
    var prog=clamp(this.chargeT/1.8,0,1);
    ctx.save();ctx.globalAlpha=0.5*prog;
    ctx.strokeStyle=this.powered?'#ff6600':'#00ccff';
    ctx.lineWidth=2.5;ctx.shadowColor=this.powered?'#ff6600':'#00ccff';ctx.shadowBlur=18;
    ctx.beginPath();ctx.arc(sx+this.w/2,sy+this.h/2,this.w+18*prog,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }
  // Air attack trail indicator
  if(this._airAtk){
    ctx.save();ctx.globalAlpha=0.5;
    ctx.strokeStyle='#ff44ff';ctx.lineWidth=3;ctx.shadowColor='#ff44ff';ctx.shadowBlur=12;
    ctx.beginPath();ctx.moveTo(sx+this.w/2,sy);ctx.lineTo(sx+this.w/2,sy+this.h+20);ctx.stroke();
    ctx.restore();
  }
};

Player.prototype._body=function(t){
  var hw=this.w/2,hh=this.h/2;
  var bounce=this.state==='run'?Math.sin(t*13)*2.5:0;
  var squat=this.state==='jump'?0.86:this.state==='fall'?1.09:1;
  var lean=this.state==='attack'?0.18:0;
  var hairC=this.powered?'#ffdd00':'#111';
  var skinC='#f0c085';
  var suitC=this.powered?'#ff6600':'#ff8800';
  var innrC=this.powered?'#ffaa00':'#0077ee';
  var darkC=this.powered?'#cc4400':'#cc5500';
  ctx.save();
  ctx.translate(0,bounce);ctx.scale(1,squat);ctx.rotate(lean);
  if(this.powered){ctx.shadowColor='#ffaa00';ctx.shadowBlur=14;}
  var ls=this.state==='run'?Math.sin(t*13)*9:0;
  ctx.fillStyle=suitC;
  ctx.fillRect(-hw*0.48+ls*0.28,hh*0.38,hw*0.4,hh*0.62);
  ctx.fillRect(hw*0.08-ls*0.28,hh*0.38,hw*0.4,hh*0.62);
  ctx.fillStyle='#222';
  ctx.fillRect(-hw*0.52+ls*0.28-1,hh-3,hw*0.5,11);
  ctx.fillRect(hw*0.08-ls*0.28-1,hh-3,hw*0.5,11);
  ctx.fillStyle=suitC; rrect(-hw*0.72,-hh*0.28,hw*1.44,hh*0.72,4); ctx.fill();
  ctx.fillStyle=innrC; rrect(-hw*0.42,-hh*0.23,hw*0.84,hh*0.44,3); ctx.fill();
  ctx.fillStyle=darkC; ctx.fillRect(-hw*0.72,hh*0.36,hw*1.44,7);
  var as=this.state==='run'?Math.sin(t*13+Math.PI)*14:0;
  var aa=this.state==='attack'?24:0;
  ctx.save();ctx.translate(hw*0.64,-hh*0.19);ctx.rotate((as+aa)*Math.PI/180);
  ctx.fillStyle=suitC;ctx.fillRect(-5,0,11,hh*0.58);
  ctx.fillStyle=skinC;ctx.beginPath();ctx.arc(0,hh*0.58,8,0,Math.PI*2);ctx.fill();
  if(this.state==='attack'){ctx.shadowColor='#ffee44';ctx.shadowBlur=11;ctx.fillStyle='#ffee44';ctx.beginPath();ctx.arc(5,hh*0.63,5,0,Math.PI*2);ctx.fill();}
  ctx.restore();
  ctx.save();ctx.translate(-hw*0.64,-hh*0.19);ctx.rotate(-as*Math.PI/180);
  ctx.fillStyle=suitC;ctx.fillRect(-5,0,11,hh*0.58);
  ctx.fillStyle=skinC;ctx.beginPath();ctx.arc(0,hh*0.58,8,0,Math.PI*2);ctx.fill();
  ctx.restore();
  ctx.shadowBlur=0;
  ctx.fillStyle=skinC;ctx.beginPath();ctx.ellipse(0,-hh*0.64,hw*0.54,hh*0.54,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=this.powered?'#fff':'#222';
  ctx.beginPath();ctx.ellipse(hw*0.18,-hh*0.72,3.8,3.8,0,0,Math.PI*2);ctx.fill();
  if(this.powered){ctx.fillStyle='#ff4400';ctx.beginPath();ctx.ellipse(hw*0.18,-hh*0.72,1.8,1.8,0,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='#222';ctx.lineWidth=1.8;
  ctx.beginPath();ctx.moveTo(hw*0.04,-hh*0.84);ctx.lineTo(hw*0.31,-hh*0.81);ctx.stroke();
  ctx.strokeStyle='#b07040';ctx.lineWidth=1.4;ctx.beginPath();
  if(this.state==='hit'||this.state==='dead')ctx.arc(hw*0.04,-hh*0.58,5,0,Math.PI);
  else ctx.arc(hw*0.04,-hh*0.59,4.5,Math.PI,0);
  ctx.stroke();
  if(this.powered){ctx.shadowColor='#ffee00';ctx.shadowBlur=18;}
  ctx.fillStyle=hairC;
  var spk=this.powered?[[-hw*.52,-hh*1.09],[-hw*.21,-hh*1.38],[hw*.13,-hh*1.49],[hw*.44,-hh*1.29],[hw*.6,-hh*.88]]
    :[[-hw*.42,-hh*1.08],[-hw*.12,-hh*1.33],[hw*.19,-hh*1.44],[hw*.48,-hh*1.19],[hw*.61,-hh*.84]];
  ctx.beginPath();ctx.moveTo(-hw*0.62,-hh*0.38);
  for(var i=0;i<spk.length;i++)ctx.lineTo(spk[i][0],spk[i][1]);
  ctx.lineTo(hw*0.64,-hh*0.38);ctx.closePath();ctx.fill();
  ctx.fillRect(-hw*0.56,-hh*0.88,hw*1.12,hh*0.5);
  ctx.restore();
};

/* ==========================================================================
   PHASE 2 — VILLAIN CLASS (upgraded with new attack patterns)
   New patterns: dashbeam, barrage, deathball, solarflare, spiralbeam
   ========================================================================== */
function Villain(cfg){
  this.x=cfg.x;this.y=cfg.y;this.w=cfg.w||50;this.h=cfg.h||56;
  this.vx=0;this.vy=0;this.grounded=false;this.facing=-1;
  this.maxHP=cfg.hp||160;this.hp=this.maxHP;
  this.spd=cfg.speed||185;this.jpow=-570;this.dmg=cfg.dmg||13;
  this.color=cfg.color||'#8822cc';this.aura=cfg.aura||'#cc44ff';this.name=cfg.name||'VILLAIN';
  // Store full config for special flags (teleports, absorbsBlast)
  this.cfg=cfg;
  this.state='idle';this.stT=0;
  this.atkCD=0;this.atkMax=cfg.atkCD||1.5;
  this.ultCD=0;this.ultMax=cfg.ultCD||12;
  this.hitT=0;this.iT=0;
  this.pats=cfg.pats||['projectile'];this.patIdx=0;this._nextPat=null;
  this.auraP=0;this.hitFlash=0;this.dead=false;this.deadT=0;
  this._projs=[];
  // Frieza teleport dash state
  this._dashT=0;
  this._dashing=false;
  // Solarflare blind timer (stored in GS.solarflareT)
}
Villain.prototype.gb=function(){return{x:this.x+4,y:this.y+2,w:this.w-8,h:this.h-4};};

Villain.prototype.update=function(dt,plat,player){
  if(this.dead){this.deadT+=dt;return;}
  this.stT+=dt;
  this.atkCD=Math.max(0,this.atkCD-dt);this.ultCD=Math.max(0,this.ultCD-dt);
  this.hitT=Math.max(0,this.hitT-dt);this.iT=Math.max(0,this.iT-dt);
  this.auraP+=dt*3.8;this.hitFlash=Math.max(0,this.hitFlash-dt*4.5);
  this._projs=[];
  // Frieza teleport dash
  if(this._dashing){
    this._dashT-=dt;
    this.x+=this.facing*680*dt;
    if(this._dashT<=0)this._dashing=false;
  }
  if(this.hitT<=0&&player&&!player.dead)this._ai(dt,player);
  if(!this.grounded)this.vy=Math.min(this.vy+GRAV*dt,MAX_FALL);
  this.vx*=Math.pow(FRIC_GND,dt*60);
  if(Math.abs(this.vx)<0.8)this.vx=0;
  this.x+=this.vx*dt;this.y+=this.vy*dt;
  this.grounded=false;
  if(plat){
    for(var i=0;i<plat.length;i++){
      var pl=plat[i];if(!pl||typeof pl.x!=='number')continue;
      var vb=this.gb();if(!overlap(vb,pl))continue;
      var oL=(vb.x+vb.w)-pl.x,oR=(pl.x+pl.w)-vb.x,oT=(vb.y+vb.h)-pl.y,oB=(pl.y+pl.h)-vb.y;
      var mH=Math.min(oL,oR),mV=Math.min(oT,oB);
      if(mV<mH){
        if(oT<oB){this.y-=oT;if(this.vy>0)this.vy=0;this.grounded=true;}
        else if(!pl.thru){this.y+=oB;if(this.vy<0)this.vy=0;}
      }else if(!pl.thru){if(oL<oR)this.x-=oL;else this.x+=oR;this.vx=0;}
    }
  }
  if(player)this.facing=(player.x+player.w/2>this.x+this.w/2)?1:-1;
};

Villain.prototype._ai=function(dt,player){
  var d=dist(this.x+this.w/2,this.y+this.h/2,player.x+player.w/2,player.y+player.h/2);
  var hr=this.hp/this.maxHP;
  if(this.state==='idle'&&this.stT>0.6)this._cs('approach');
  else if(this.state==='approach'){
    if(d>105){this.vx=this.facing*this.spd;if(this.grounded&&Math.random()<0.007)this.vy=this.jpow;}
    if(d<145&&this.atkCD<=0)this._cs('telegraph');
    if(hr<0.38&&this.ultCD<=0){this._cs('telegraph');this._nextPat='ultimate';}
    // Frieza teleports when player is far away and HP is low
    if(this.cfg.teleports&&hr<0.5&&d>300&&this.atkCD<=0){
      this._dashing=true; this._dashT=0.18;
    }
  } else if(this.state==='telegraph'){
    this.vx*=0.5;
    if(this.stT>0.58){this._launch(player);this._cs('retreat');}
  } else if(this.state==='retreat'){
    this.vx=-this.facing*this.spd*0.55;
    if(this.stT>0.75)this._cs('approach');
  } else if(this.state==='hit'&&this.hitT<=0)this._cs('approach');
};

Villain.prototype._cs=function(s){this.state=s;this.stT=0;};

/* ─────────────────────────────────────────────────────────────────────
   ATTACK FACTORY — produces Proj instances pushed into this._projs
   New: dashbeam, barrage, deathball, solarflare, spiralbeam
   ───────────────────────────────────────────────────────────────────── */
Villain.prototype._launch=function(player){
  var pat=this._nextPat||this.pats[this.patIdx%this.pats.length];
  this._nextPat=null;this.patIdx++;
  var px=this.x+this.w/2,py=this.y+this.h/2;
  var dx=(player.x+player.w/2)-px,dy=(player.y+player.h/2)-py;
  var d=Math.hypot(dx,dy)||1;

  switch(pat){
    /* ── Classic patterns (v1) ─────────────────────────────────── */
    case 'projectile':
      this._projs.push(ProjPoolGet(px,py,(dx/d)*370,(dy/d)*370,'villain',
        {dmg:this.dmg,color:this.aura,r:9,life:1.2}));
      this.atkCD=this.atkMax;break;

    case 'trishot':
      for(var a=-0.26;a<=0.26;a+=0.26){
        var ang=Math.atan2(dy,dx)+a;
        this._projs.push(ProjPoolGet(px,py,Math.cos(ang)*345,Math.sin(ang)*345,'villain',
          {dmg:this.dmg*0.72,color:this.aura,r:7,life:1.05}));
      }
      this.atkCD=this.atkMax*1.32;break;

    case 'groundwave':
      this._projs.push(ProjPoolGet(px+this.facing*10,this.y+this.h-9,
        this.facing*415,0,'villain',{dmg:this.dmg*1.18,color:this.aura,r:12,life:1.45}));
      shakeScreen(5,0.28);
      pSpawn(px,this.y+this.h,{n:11,grav:-75,minLife:0.5,maxLife:0.7,color:this.aura,
        size:8,glow:true,angle:this.facing>0?0:Math.PI,spread:0.28,minSpd:48,maxSpd:175});
      this.atkCD=this.atkMax;break;

    case 'airburst':
      if(this.grounded)this.vy=this.jpow*0.88;
      for(var aa=0;aa<Math.PI*2;aa+=Math.PI/4)
        this._projs.push(ProjPoolGet(px,py-18,Math.cos(aa)*295,Math.sin(aa)*295,'villain',
          {dmg:this.dmg*0.62,color:this.aura,r:7,life:0.88}));
      shakeScreen(7,0.33);this.atkCD=this.atkMax*1.78;break;

    case 'ultimate':
      for(var au=-0.48;au<=0.48;au+=0.24){
        var anu=Math.atan2(dy,dx)+au;
        this._projs.push(ProjPoolGet(px,py,Math.cos(anu)*490,Math.sin(anu)*490,'villain',
          {dmg:this.dmg*1.48,color:'#fff',r:13,life:1.38,isKame:true}));
      }
      shakeScreen(11,0.65);
      pSpawn(px,py,{n:22,grav:0,minLife:0.65,maxLife:0.9,color:this.aura,size:12,glow:true,minSpd:95,maxSpd:380});
      this.ultCD=this.ultMax;this.atkCD=this.atkMax*2;break;

    /* ── NEW: dashbeam (Frieza) ─────────────────────────────────
       Villain dashes toward player then fires 2 precision beams.   */
    case 'dashbeam':
      this._dashing=true; this._dashT=0.14;
      // Fire 2 thin beams after a tiny delay (telegraph then release)
      for(var db=0;db<2;db++){
        var dbAng=Math.atan2(dy,dx)+(db===0?0.1:-0.1);
        this._projs.push(ProjPoolGet(px,py,Math.cos(dbAng)*560,Math.sin(dbAng)*560,'villain',
          {dmg:this.dmg*0.85,color:'#ff88cc',r:5,life:0.88}));
      }
      this.atkCD=this.atkMax*0.82;break;

    /* ── NEW: barrage (Frieza) ──────────────────────────────────
       5 rapid small blasts fired in quick succession.             */
    case 'barrage':
      for(var br=0;br<5;br++){
        var brAng=Math.atan2(dy,dx)+rand(-0.18,0.18);
        // Stagger the projs slightly by reducing life on early ones
        this._projs.push(ProjPoolGet(px,py,Math.cos(brAng)*400,Math.sin(brAng)*400,'villain',
          {dmg:this.dmg*0.45,color:'#ff4488',r:6,life:0.75+br*0.08}));
      }
      pSpawn(px,py,{n:8,grav:0,minLife:0.3,maxLife:0.45,color:'#ff88cc',size:5,glow:true,minSpd:40,maxSpd:120});
      this.atkCD=this.atkMax*1.15;break;

    /* ── NEW: deathball (Frieza) ────────────────────────────────
       Large slow homing orb that bounces off the ground.         */
    case 'deathball':
      this._projs.push(ProjPoolGet(px,py-20,(dx/d)*180,(dy/d)*180,'villain',
        {dmg:this.dmg*2.2,color:'#ff2266',r:22,life:2.8,grav:180,isKame:true}));
      shakeScreen(8,0.5);
      pSpawn(px,py,{n:18,grav:0,minLife:0.7,maxLife:1.0,color:'#ff2266',size:14,glow:true,minSpd:40,maxSpd:150});
      this.atkCD=this.atkMax*2.2;break;

    /* ── NEW: solarflare (Cell) ─────────────────────────────────
       Flashes entire screen white — player input locked 1.5s.
       Uses GS.solarflareT to communicate with update loop.       */
    case 'solarflare':
      // Trigger the flash through GS — no crash if GS not ready
      if(typeof GS !== 'undefined'){
        GS.solarflareT = 1.6; // seconds player is blinded / slowed
      }
      var sf=document.getElementById('airFlash');
      if(sf){sf.style.background='rgba(255,255,200,0.95)';sf.style.opacity='1';
        setTimeout(function(){sf.style.transition='opacity 0.6s';sf.style.opacity='0';
          setTimeout(function(){sf.style.background='';sf.style.transition='';},700);},200);}
      shakeScreen(4,0.25);
      this.atkCD=this.atkMax*1.8;break;

    /* ── NEW: spiralbeam (Cell) ─────────────────────────────────
       6 beams fired in a rotating spiral pattern.               */
    case 'spiralbeam':
      for(var sp=0;sp<6;sp++){
        var spAng=Math.atan2(dy,dx)+(sp*(Math.PI*2/6));
        this._projs.push(ProjPoolGet(px,py,Math.cos(spAng)*320,Math.sin(spAng)*320,'villain',
          {dmg:this.dmg*0.7,color:'#66ff44',r:8,life:1.1}));
      }
      shakeScreen(6,0.35);
      pSpawn(px,py,{n:14,grav:0,minLife:0.5,maxLife:0.75,color:'#66ff44',size:9,glow:true,minSpd:50,maxSpd:180});
      this.atkCD=this.atkMax*1.55;break;
  }
};

Villain.prototype.takeDmg=function(amt){
  if(this.iT>0||this.dead)return false;
  spawnDamageNum(this.x+this.w/2, this.y, Math.round(amt), this.aura);
  this.hp=Math.max(0,this.hp-amt);
  this.iT=0.14;this.hitFlash=1;this.hitT=0.18;
  this._cs('hit');
  Audio.explosion();
  if(this.hp<=0){
    this.dead=true;this.state='dead';
    Audio.villainDie();
  }
  return true;
};

// Draw — uses cam.y for visibility band
Villain.prototype.draw=function(camX,t){
  if(this.dead&&this.deadT>1.6)return;
  var sx=this.x-camX,sy=this.y-(cam.y||0);
  if(this.dead)ctx.globalAlpha=Math.max(0,1-this.deadT);
  if(this.hitFlash>0)ctx.globalAlpha*=(0.48+this.hitFlash*0.52);
  ctx.save();
  ctx.globalAlpha*=(0.11+0.07*Math.sin(this.auraP));
  var ag=ctx.createRadialGradient(sx+this.w/2,sy+this.h/2,0,sx+this.w/2,sy+this.h/2,this.w*1.1);
  ag.addColorStop(0,this.aura);ag.addColorStop(1,'transparent');
  ctx.fillStyle=ag;ctx.beginPath();
  ctx.ellipse(sx+this.w/2,sy+this.h/2,this.w*1.1,this.h*1.25,0,0,Math.PI*2);ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(sx+this.w/2,sy+this.h/2);
  if(this.facing<0)ctx.scale(-1,1);
  if(this.hitFlash>0){ctx.shadowColor='#fff';ctx.shadowBlur=18;}
  this._vbody(t);
  ctx.restore();
  ctx.globalAlpha=1;
  if(this.state==='telegraph'){
    var prog=this.stT/0.58;
    ctx.save();ctx.globalAlpha=0.38*prog;ctx.strokeStyle=this.aura;
    ctx.lineWidth=3+prog*4.5;ctx.shadowColor=this.aura;ctx.shadowBlur=28;
    ctx.beginPath();ctx.arc(sx+this.w/2,sy+this.h/2,this.w+prog*19,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }
  // Dash trail
  if(this._dashing){
    ctx.save();ctx.globalAlpha=0.38;ctx.fillStyle=this.aura;
    ctx.fillRect(sx-this.facing*24,sy,this.w,this.h);ctx.restore();
  }
};

Villain.prototype._vbody=function(t){
  var hw=this.w/2,hh=this.h/2;
  var bounce=this.state==='approach'?Math.sin(t*9.5)*2:0;
  ctx.save();ctx.translate(0,bounce);
  ctx.shadowColor=this.aura;ctx.shadowBlur=9;
  ctx.fillStyle='#111';
  ctx.fillRect(-hw*0.46,hh*0.34,hw*0.4,hh*0.66);
  ctx.fillRect(hw*0.06,hh*0.34,hw*0.4,hh*0.66);
  ctx.fillStyle='#2a2a2a';
  ctx.fillRect(-hw*0.50,hh*0.84,hw*0.54,13);
  ctx.fillRect(0,hh*0.84,hw*0.54,13);
  ctx.fillStyle=this.color;rrect(-hw*0.76,-hh*0.34,hw*1.52,hh*0.73,5);ctx.fill();
  ctx.fillStyle=this.aura+'44';rrect(-hw*0.50,-hh*0.28,hw*1.0,hh*0.48,4);ctx.fill();
  ctx.fillStyle=this.color;
  ctx.fillRect(-hw-3,-hh*0.28,15,hh*0.58);
  ctx.fillRect(hw-9,-hh*0.28,15,hh*0.58);
  ctx.beginPath();ctx.ellipse(0,-hh*0.68,hw*0.56,hh*0.56,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=this.aura;ctx.shadowColor=this.aura;ctx.shadowBlur=13;
  ctx.beginPath();ctx.ellipse(-hw*0.2,-hh*0.76,4.8,3.8,-0.18,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(hw*0.2,-hh*0.76,4.8,3.8,0.18,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#ddd';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.moveTo(-hw*0.24,-hh*0.54);ctx.lineTo(hw*0.24,-hh*0.54);ctx.stroke();
  ctx.restore();
};

/* ==========================================================================
   GAME STATE
   ========================================================================== */
var GS={
  state:'title',  // will be reassigned after STATE is defined below
  score:0,lvlIdx:0,
  player:null,villain:null,projs:[],cfg:null,
  puDone:false,dying:false,winning:false,
  solarflareT:0
};

/* ==========================================================================
   EXPLICIT STATE MACHINE CONSTANTS
   States: 'title' | 'playing' | 'paused' | 'victory' | 'level_transition'
           | 'gameover' | 'game_complete'
   ========================================================================== */
var STATE = {
  TITLE:       'title',
  PLAYING:     'playing',
  PAUSED:      'paused',
  VICTORY:     'victory',           // brief win flash before overlay
  LVL_TRANS:   'level_transition',  // waiting on "Next Level" button
  GAMEOVER:    'gameover',
  COMPLETE:    'game_complete'      // all levels beaten
};
// Re-init GS.state using the constant (GS was declared before STATE above)
GS.state = STATE.TITLE;

/* ==========================================================================
   SCREEN / UI HELPERS
   ========================================================================== */
// ALL overlay screens must be listed here so showScreen() always hides them all
var SCRS=['sTitle','sPause','sOver','sVictory','sLevelClear','sComplete','sSettings','sCredits','sSkills'];
function showScreen(id){
  SCRS.forEach(function(s){
    var el=document.getElementById(s);
    if(el)el.classList.toggle('off',s!==id);
  });
  if(!id)SCRS.forEach(function(s){var el=document.getElementById(s);if(el)el.classList.add('off');});
}

var _comboFT=0;
function showCombo(n){
  if(n<3)return;
  var el=document.getElementById('comboFloat');
  if(!el)return;
  el.textContent=n>=8?'ULTRA '+n+'x!':n+'x COMBO!';
  el.style.opacity='1';_comboFT=1.3;
}

// Villain intro — now shows the introText field too
function villainIntro(name,color,introText){
  var el=document.getElementById('introName');
  if(!el)return;
  el.textContent=name;el.style.color=color;
  el.classList.remove('visible');void el.offsetHeight;el.classList.add('visible');
  // Show subtext below name if provided
  var sub=document.getElementById('introSub');
  if(!sub){
    sub=document.createElement('div');sub.id='introSub';
    sub.style.cssText='font-size:clamp(10px,2vw,16px);letter-spacing:3px;color:rgba(255,255,255,0.7);margin-top:8px;opacity:0;transition:opacity 0.5s 0.3s;text-align:center;';
    el.parentNode.appendChild(sub);
  }
  sub.textContent=introText||'';
  void sub.offsetHeight;
  sub.style.opacity='1';
  setTimeout(function(){
    el.classList.remove('visible');
    sub.style.opacity='0';
  },2700);
}

// Hit chain HUD — shows Nx HIT CHAIN when player is on a melee streak
var _chainHudT=0;
function showChainHUD(n){
  var el=document.getElementById('comboHits');
  var num=document.getElementById('comboHitsNum');
  if(!el||!num)return;
  num.textContent=n+'x';
  el.classList.add('show');
  _chainHudT=1.4;
}

function updateHUD(){
  var p=GS.player,v=GS.villain;
  if(p){
    document.getElementById('fHP').style.width=(p.hp/p.maxHP*100)+'%';
    document.getElementById('fKI').style.width=(p.ki/p.maxKI*100)+'%';
    document.getElementById('scoreNum').textContent=GS.score.toString().padStart(6,'0');
    document.getElementById('comboTag').textContent=p.combo>=2?p.combo+'x':'';

    // ── NEW: Charge meter UI ───────────────────────────────────────
    var cm=document.getElementById('chargeMeter');
    var cf=document.getElementById('chargeFill');
    if(cm&&cf){
      if(p.charging){
        cm.classList.add('show');
        var pct=clamp(p.chargeT/1.8,0,1)*100;
        cf.style.width=pct+'%';
        // Color shifts from blue → gold as charge fills
        cf.style.background=pct>80?
          'linear-gradient(90deg,#ff8800,#ffee00)':
          'linear-gradient(90deg,#0055ff,#00cfff)';
      } else {
        cm.classList.remove('show');
      }
    }

    // ── NEW: Super Saiyan mode indicator ──────────────────────────
    var am=document.getElementById('atkMode');
    if(am)am.classList.toggle('show',p.powered);
  }

  var bp=document.getElementById('bossPnl');
  if(v&&!v.dead){
    bp.classList.add('show');
    document.getElementById('fBoss').style.width=(v.hp/v.maxHP*100)+'%';
  } else {
    bp.classList.remove('show');
  }

  // Chain HUD fade
  if(_chainHudT>0){
    _chainHudT-=0.016; // approx 60fps
    if(_chainHudT<=0){
      var ce=document.getElementById('comboHits');
      if(ce)ce.classList.remove('show');
    }
  }
}

/* ==========================================================================
   PHASE 3 — LEVEL LOADER (adds BGM theme switching + intro text)
   ========================================================================== */
function loadLevel(idx){
  var cfg=LEVELS[idx];if(!cfg)return false;
  GS.lvlIdx=idx;GS.cfg=cfg;GS.score=0;GS.projs=[];
  GS.puDone=false;GS.dying=false;GS.winning=false;
  GS.solarflareT=0;
  _particles.length=0;
  GS.player=new Player(cfg.ps.x,cfg.ps.y);
  // Apply all unlocked skills to the new player
  Skills.applyAll(GS.player);
  SSJ.reset();
  GS.villain=new Villain(cfg.vil);
  cam.x=clamp(cfg.ps.x-VW*0.35,0,cfg.worldW-VW);
  cam.y=0;
  document.getElementById('lvlTag').textContent='LEVEL '+(idx+1)+' / '+LEVELS.length;
  document.getElementById('bossLbl').textContent=cfg.vil.name;
  // Switch BGM theme
  Audio.setBGMTheme(idx);
  return true;
}

function startGame(idx){
  if(!loadLevel(idx))return;
  // ── RE-ENABLE PLAYER INPUT ─────────────────────────────────────────
  // This is the player-freeze fix: after doVictory() clears all pending
  // attacks and stops input, startGame() must explicitly restore control.
  // The Player constructor already initializes all input fields to false/null
  // (because loadLevel creates a NEW Player), so input is clean.
  // We also flush any stale keyboard/touch state from the previous level.
  for(var k in Keys)delete Keys[k];    // clear held keys
  for(var k in Mob)Mob[k]=false;       // clear mobile button state
  flushInput();                         // clear just-pressed buffers

  showScreen(null);                     // hide ALL overlays
  GS.state=STATE.PLAYING;              // ← explicit state — game loop resumes

  // Level flash transition
  var lf=document.getElementById('lvlFlash');
  if(lf){
    lf.style.transition='none';lf.style.opacity='1';
    void lf.offsetHeight;
    lf.style.transition='opacity 0.7s';lf.style.opacity='0';
  }
  setTimeout(function(){
    if(GS.state===STATE.PLAYING) {
      // Phase 3: Boss intro cutscene
      Cutscene.play(
        GS.cfg.vil.name,
        GS.cfg.vil.aura,
        GS.cfg.vil.introText,
        null  // onDone — cutscene just dismisses, gameplay continues
      );
    }
  },550);
  var isMob=('ontouchstart' in window)||(navigator.maxTouchPoints>0);
  document.getElementById('mobileCtrl').classList.toggle('on',isMob);
}

function doGameOver(){
  if(GS.state===STATE.GAMEOVER)return;
  GS.state=STATE.GAMEOVER;showScreen('sOver');
  document.getElementById('overScore').textContent='SCORE: '+GS.score;
  var hs=Math.max(GS.score,parseInt(localStorage.getItem('dbz_hs')||'0',10));
  localStorage.setItem('dbz_hs',hs);
  Audio.stopBGM();
}

/* ── LEVEL COMPLETION FLOW ──────────────────────────────────────────────────
   Step 1: villain.dead → GS.winning=true → immediate state change to VICTORY
           (no more setTimeout race — state changes in the same frame)
   Step 2: 900ms victory flash while canvas still renders the death particles
   Step 3: State moves to LVL_TRANS, showScreen('sLevelClear') appears
   Step 4: Player clicks "Next Level" → startGame(next) or game_complete
   ─────────────────────────────────────────────────────────────────────────── */
function doVictory(){
  // Guard: only fire once
  if(GS.state===STATE.VICTORY||GS.state===STATE.LVL_TRANS||
     GS.state===STATE.COMPLETE||GS.state===STATE.GAMEOVER)return;

  // ── STOP villain and player attacks immediately ────────────────────
  if(GS.villain){GS.villain.dead=true;}          // hard-stop villain
  if(GS.player){
    GS.player._melee=false;                       // cancel any pending melee
    GS.player._blast=null;
    GS.player._kame=null;
    GS.player._airAtk=false;
    GS.player.charging=false;
    Audio.chargeStop();
    GS.player._chargeAudioOn=false;
  }
  GS.projs=[];  // clear all projectiles — clean slate

  // ── Award villain kill bonus ───────────────────────────────────────
  GS.score+=500+GS.lvlIdx*200;
  var hs=Math.max(GS.score,parseInt(localStorage.getItem('dbz_hs')||'0',10));
  localStorage.setItem('dbz_hs',hs);

  // ── Award Skill Points (1 per level, +1 bonus for last 2 levels) ──
  var spAward = GS.lvlIdx >= 3 ? 2 : 1;
  Skills.awardPoints(spAward);

  var isLast=(GS.lvlIdx>=LEVELS.length-1);

  // ── Transition to VICTORY briefly, then show the level-clear overlay ─
  GS.state=STATE.VICTORY;

  setTimeout(function(){
    // If player somehow died in that 900ms window, respect game-over
    if(GS.state===STATE.GAMEOVER)return;

    if(isLast){
      // ── ALL LEVELS BEATEN → GAME_COMPLETE ─────────────────────────
      GS.state=STATE.COMPLETE;
      showScreen('sComplete');
      var el=document.getElementById('completeScore');
      if(el)el.textContent='FINAL SCORE: '+GS.score;
      var hsEl=document.getElementById('completeHs');
      if(hsEl)hsEl.textContent='HIGH SCORE: '+hs;
      var msgEl=document.getElementById('completeMsg');
      if(msgEl)msgEl.textContent='YOU HAVE SURPASSED ALL LIMITS!';
      Audio.stopBGM();
      // Victory particle burst
      for(var i=0;i<5;i++){
        (function(i){setTimeout(function(){
          if(GS.player)
            pSpawn(VW*0.5,VH*0.5,{n:20,grav:-60,minLife:0.8,maxLife:1.3,
              color:['#ffee00','#ff6600','#00cfff','#ff44ff','#00ff88'][i],
              size:11,glow:true,minSpd:60,maxSpd:280,angle:-Math.PI/2,spread:Math.PI});
        },i*180);})(i);
      }
    } else {
      // ── MORE LEVELS REMAIN → LEVEL_TRANSITION ─────────────────────
      GS.state=STATE.LVL_TRANS;
      showScreen('sLevelClear');

      // Populate the level-clear overlay
      var bossName=(GS.villain?GS.villain.name:'VILLAIN')+' DEFEATED!';
      var lcbn=document.getElementById('lcBossName');
      if(lcbn)lcbn.textContent=bossName;
      var lcsc=document.getElementById('lcScore');
      if(lcsc)lcsc.textContent='SCORE: '+GS.score;
      var lcb=document.getElementById('lcBonus');
      if(lcb)lcb.textContent='BONUS: +'+(500+GS.lvlIdx*200)+' PTS  ·  LEVEL '+(GS.lvlIdx+2)+' UNLOCKED';
      var lcsk=document.getElementById('lcSkillUnlock');
      if(lcsk)lcsk.textContent='+' + (GS.lvlIdx>=3?2:1) + ' SKILL POINT' + (GS.lvlIdx>=3?'S':'') + ' EARNED!';

      // Save progress
      localStorage.setItem('dbz_level', GS.lvlIdx+1);
    }
  }, 900);  // 900ms — enough to see villain death animation, no timeout race
}

/* ==========================================================================
   BUTTON WIRING — state-machine aware
   ========================================================================== */
document.getElementById('bStart').addEventListener('click',function(){startGame(0);});

// Continue button
var _sv=parseInt(localStorage.getItem('dbz_level')||'0',10);
if(_sv>0&&_sv<LEVELS.length){
  var bc=document.getElementById('bCont');if(bc){bc.style.display='flex';}
}
document.getElementById('bCont').addEventListener('click',function(){
  startGame(Math.min(_sv,LEVELS.length-1));
});

// Show high score on title
(function(){
  var hs=localStorage.getItem('dbz_hs');
  var el=document.getElementById('titleHs');
  if(el&&hs&&parseInt(hs,10)>0)el.textContent='HIGH SCORE: '+parseInt(hs,10);
})();

document.getElementById('bResume').addEventListener('click',function(){
  GS.state=STATE.PLAYING;showScreen(null);Audio.resume();
});
document.getElementById('bQuit').addEventListener('click',function(){
  GS.state=STATE.TITLE;showScreen('sTitle');Audio.stopBGM();
});
document.getElementById('bRetry').addEventListener('click',function(){startGame(GS.lvlIdx);});
document.getElementById('bOverMenu').addEventListener('click',function(){
  GS.state=STATE.TITLE;showScreen('sTitle');
});

// ── Phase 6: Settings button wiring ──────────────────────────────────
document.getElementById('bSettings').addEventListener('click',function(){
  showScreen('sSettings');
});
document.getElementById('bSettingsBack').addEventListener('click',function(){
  showScreen('sTitle');
});

// Settings: music volume slider
(function(){
  var sl=document.getElementById('slMusic');
  if(!sl)return;
  sl.value=40;
  sl.addEventListener('input',function(){
    var v=parseInt(this.value,10)/100;
    Audio.init(); Audio.resume();
    // Set music volume via direct gain access
    try {
      if(Audio._bgGainNode) Audio._bgGainNode.gain.value = (Audio.isMuted()?0:v*0.28);
    } catch(e) {}
    Audio._musicVolPct = parseInt(this.value,10);
  });
})();

// Settings: SFX volume slider
(function(){
  var sl=document.getElementById('slSFX');
  if(!sl)return;
  sl.value=70;
  sl.addEventListener('input',function(){
    var v=parseInt(this.value,10)/100;
    Audio.init(); Audio.resume();
    try {
      if(Audio._sfxGainNode) Audio._sfxGainNode.gain.value = (Audio.isMuted()?0:v*0.9);
    } catch(e) {}
    Audio._sfxVolPct = parseInt(this.value,10);
  });
})();

// Settings: mute toggle button
document.getElementById('bToggleMute').addEventListener('click',function(){
  Audio.init(); Audio.resume();
  var muted=Audio.toggleMute();
  this.textContent = muted ? 'ON' : 'OFF';
  this.style.color = muted ? '#ff4444' : '';
});

// Settings: reset progress
document.getElementById('bResetProgress').addEventListener('click',function(){
  if(confirm('Reset ALL progress? (saves, skills, high score)')){
    localStorage.removeItem('dbz_level');
    localStorage.removeItem('dbz_hs');
    localStorage.removeItem('dbz_sp');
    localStorage.removeItem('dbz_skills');
    Skills.reset();
    var bc=document.getElementById('bCont');if(bc)bc.style.display='none';
    var hs=document.getElementById('titleHs');if(hs)hs.textContent='';
    showScreen('sTitle');
  }
});

// ── Phase 6: Credits button wiring ──────────────────────────────────
document.getElementById('bCredits').addEventListener('click',function(){
  showScreen('sCredits');
});
document.getElementById('bCreditsBack').addEventListener('click',function(){
  showScreen('sTitle');
});

// ── Phase 5: Skills screen button wiring ─────────────────────────────
document.getElementById('bSkills').addEventListener('click',function(){
  Skills.renderGrid(GS.player);
  showScreen('sSkills');
});
document.getElementById('bSkillsBack').addEventListener('click',function(){
  var from=this.getAttribute('data-from');
  if(from==='pause'){
    this.removeAttribute('data-from');
    showScreen('sPause');
  } else {
    showScreen('sTitle');
  }
});
// Pause > Skills
document.getElementById('bPauseSkills').addEventListener('click',function(){
  Skills.renderGrid(GS.player);
  var sb=document.getElementById('bSkillsBack');
  if(sb)sb.setAttribute('data-from','pause');
  showScreen('sSkills');
});

// Legacy sVictory buttons
var _bNext=document.getElementById('bNext');
if(_bNext)_bNext.addEventListener('click',function(){
  var n=GS.lvlIdx+1;
  if(n>=LEVELS.length){GS.state=STATE.TITLE;showScreen('sTitle');}
  else startGame(n);
});
var _bVicMenu=document.getElementById('bVicMenu');
if(_bVicMenu)_bVicMenu.addEventListener('click',function(){
  GS.state=STATE.TITLE;showScreen('sTitle');Audio.stopBGM();
});

// ── Level-clear overlay buttons ─────────────────────────────────────
document.getElementById('bLevelNext').addEventListener('click',function(){
  var nextIdx=GS.lvlIdx+1;
  if(nextIdx>=LEVELS.length){GS.state=STATE.TITLE;showScreen('sTitle');}
  else startGame(nextIdx);
});
document.getElementById('bLevelNext').addEventListener('touchend',function(e){
  e.preventDefault();
  var nextIdx=GS.lvlIdx+1;
  if(nextIdx<LEVELS.length) startGame(nextIdx);
  else {GS.state=STATE.TITLE;showScreen('sTitle');}
},{passive:false});

document.getElementById('bLevelMenu').addEventListener('click',function(){
  GS.state=STATE.TITLE;showScreen('sTitle');Audio.stopBGM();
});

// ── Game-complete screen button ─────────────────────────────────────
document.getElementById('bCompleteMenu').addEventListener('click',function(){
  GS.state=STATE.TITLE;showScreen('sTitle');
});

// ── Phase 4: Mobile SSJ button ──────────────────────────────────────
var _abSSJ=document.getElementById('abSSJ');
if(_abSSJ){
  function _doSSJ(e){
    if(e&&e.preventDefault)e.preventDefault();
    Audio.init(); Audio.resume();
    if(GS.player) SSJ.transform(GS.player);
  }
  _abSSJ.addEventListener('click',_doSSJ);
  _abSSJ.addEventListener('touchstart',_doSSJ,{passive:false});
}

// Pause — also allows ESC from level-clear to go to menu
document.addEventListener('keydown',function(e){
  if(e.key==='p'||e.key==='P'||e.key==='Escape'){
    if(GS.state===STATE.PLAYING){GS.state=STATE.PAUSED;showScreen('sPause');}
    else if(GS.state===STATE.PAUSED){GS.state=STATE.PLAYING;showScreen(null);}
    else if(GS.state===STATE.LVL_TRANS||GS.state===STATE.COMPLETE){
      GS.state=STATE.TITLE;showScreen('sTitle');Audio.stopBGM();
    }
  }
  // Enter/Space on level-clear screen = advance
  if((e.key==='Enter'||e.key===' ')&&GS.state===STATE.LVL_TRANS){
    e.preventDefault();
    var ni=GS.lvlIdx+1;
    if(ni<LEVELS.length)startGame(ni);
  }
});

// Mute button
var _muteEl=document.getElementById('muteBtn');
if(_muteEl){
  _muteEl.addEventListener('click',function(){
    Audio.init(); Audio.resume();
    Audio.toggleMute();
  });
  _muteEl.addEventListener('touchstart',function(e){
    e.preventDefault();Audio.init();Audio.resume();Audio.toggleMute();
  },{passive:false});
}

// Block canvas scroll
canvas.addEventListener('touchstart',function(e){e.preventDefault();},{passive:false});
canvas.addEventListener('touchmove',function(e){e.preventDefault();},{passive:false});

/* ==========================================================================
   DRAW HELPERS (unchanged from v1 — no modifications preserve stability)
   ========================================================================== */
function drawBG(cfg,camX,t){
  var g=ctx.createLinearGradient(0,0,0,VH);
  g.addColorStop(0,cfg.bg.s0);g.addColorStop(1,cfg.bg.s1);
  ctx.fillStyle=g;ctx.fillRect(0,0,VW,VH);
  // Stars for dark levels
  if(cfg.id===3||cfg.id===4||cfg.id===5){
    ctx.fillStyle='#fff';
    var sc=cfg.id===4?'rgba(100,200,255,':'rgba(255,255,255,';
    for(var i=0;i<75;i++){
      var sx=((i*131.7+camX*0.04)%(VW+20)+VW+20)%(VW+20);
      var sy=(i*57.3)%(VH*0.72);
      ctx.globalAlpha=0.3+0.65*Math.sin(t*(0.4+i*0.06));
      ctx.fillStyle=i%5===0?sc+'0.9)':'#fff';
      ctx.fillRect(sx,sy,i%3===0?2:1,i%3===0?2:1);
    }ctx.globalAlpha=1;
  }
  // Clouds / atmospheric
  var ca=cfg.id===2?'rgba(255,90,0,':cfg.id===4?'rgba(0,120,200,':cfg.id===5?'rgba(0,180,0,':'rgba(255,255,255,';
  for(var ci=0;ci<5;ci++){
    var cx=((ci*550-camX*0.14)%(VW+240)+VW+240)%(VW+240)-120;
    ctx.fillStyle=ca+'0.07)';ctx.beginPath();
    ctx.ellipse(cx,62+ci*37,56+ci*18,16+ci*6,0,0,Math.PI*2);ctx.fill();
  }
  // Silhouettes
  ctx.fillStyle='rgba(0,0,0,0.16)';
  for(var mi=0;mi<9;mi++){
    var mx=((mi*294-camX*0.26)%(VW+340)+VW+340)%(VW+340)-170;
    var mh=76+(mi*19%117);
    ctx.beginPath();ctx.moveTo(mx,VH*0.62);ctx.lineTo(mx+77,VH*0.62-mh);ctx.lineTo(mx+154,VH*0.62);ctx.fill();
  }
}

function drawPlat(plat,camX){
  if(!plat)return;
  var cy=cam.y||0;
  for(var i=0;i<plat.length;i++){
    var p=plat[i];if(!p)continue;
    var sx=p.x-camX;
    var sy=p.y-cy;
    if(sx+p.w<-10||sx>VW+10)continue;
    ctx.shadowBlur=0;
    if(p.ground){
      ctx.fillStyle=p.color||'#2d5a1b';ctx.fillRect(sx,sy,p.w,p.h);
      ctx.fillStyle='rgba(255,255,255,0.06)';ctx.fillRect(sx,sy,p.w,5);
      ctx.fillStyle=p.dk||'#153010';ctx.fillRect(sx,sy+7,p.w,p.h-7);
    } else {
      ctx.shadowColor=p.color||'#4a7a2b';ctx.shadowBlur=5;
      ctx.fillStyle=p.color||'#4a7a2b';ctx.fillRect(sx,sy,p.w,p.h);
      ctx.shadowBlur=0;
      ctx.fillStyle='rgba(255,255,255,0.11)';ctx.fillRect(sx+2,sy+2,p.w-4,3);
      ctx.fillStyle='rgba(0,0,0,0.32)';ctx.fillRect(sx,sy+13,p.w,7);
    }
  }ctx.shadowBlur=0;
}

function drawPU(cfg,camX,t){
  if(GS.puDone||!cfg.pu)return;
  var pu=cfg.pu,sx=pu.x-camX,sy=(pu.y-(cam.y||0));
  if(sx<-30||sx>VW+30)return;
  var pulse=Math.sin(t*3.8)*4;
  ctx.save();ctx.translate(sx,sy+pulse);
  ctx.shadowColor='#ffee00';ctx.shadowBlur=18;
  ctx.strokeStyle='#ffee00';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(0,0,17,0,Math.PI*2);ctx.stroke();
  var g=ctx.createRadialGradient(0,0,0,0,0,13);
  g.addColorStop(0,'#fff');g.addColorStop(0.4,'#ffee00');g.addColorStop(1,'transparent');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ff6600';ctx.font='bold 13px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('\u2605',0,1);ctx.restore();
}

/* ==========================================================================
   MAIN UPDATE LOOP — state-machine gated
   ========================================================================== */
function update(dt){
  GamepadInput.poll();
  if (In.jd('debug')) _fpsDebug = !_fpsDebug;
  if (In.jd('fullscreen')) toggleFullscreen();
  if (GamepadInput.buttonJustDown('pause')) {
    if (GS.state === STATE.PLAYING) { GS.state = STATE.PAUSED; showScreen('sPause'); Audio.resume(); }
    else if (GS.state === STATE.PAUSED) { GS.state = STATE.PLAYING; showScreen(null); }
    else if (GS.state === STATE.LVL_TRANS || GS.state === STATE.COMPLETE) { GS.state = STATE.TITLE; showScreen('sTitle'); Audio.stopBGM(); }
  }
  if(GS.state!==STATE.PLAYING&&GS.state!==STATE.VICTORY)return;

  var p=GS.player,v=GS.villain,cfg=GS.cfg;
  if(!p||!cfg)return;
  var plat=cfg.plat;

  // ── Solarflare — slows player input and dims screen ───────────────
  GS.solarflareT=Math.max(0,(GS.solarflareT||0)-dt);

  // ── During VICTORY state: physics still runs so Goku lands cleanly
  //    but ALL attacks are blocked (they were cleared in doVictory)    ─
  if(GS.state===STATE.VICTORY){
    p.update(dt,plat);
    pUpdate(dt);
    updateDamageNumbers(dt);
    updateCam(dt,p.x,p.y,cfg.worldW,p.facing);
    updateHUD();
    flushInput();
    return;  // skip all attack / collision / defeat logic
  }

  p.update(dt,plat);

  // ── Super Saiyan system update ─────────────────────────────────────
  if(GS.state===STATE.PLAYING) SSJ.update(dt, p);

  // ── Dispatch pending attacks ──────────────────────────────────────
  if(p._blast){
    GS.projs.push(ProjPoolGet(p._blast.x,p._blast.y,p._blast.vx,p._blast.vy,'player',p._blast.opts));
    p._blast=null;
  }
  if(p._kame){
    GS.projs.push(ProjPoolGet(p._kame.x,p._kame.y,p._kame.vx,p._kame.vy,'player',p._kame.opts));
    p._kame=null;
  }

  // ── Melee combo chain hit check ───────────────────────────────────
  if(p._melee&&v&&!v.dead){
    if(overlap(p.meleeBounds(),v.gb())){
      var mDmg=p.powered?23:13;
      // Finisher (hit 3) deals bonus damage and knocks villain back
      var isFinisher=(p._meleeHitNum>=3);
      if(isFinisher){mDmg*=1.8;v.vx=v.facing*-340;v.vy=-200;}
      if(v.takeDmg(mDmg)){
        GS.score+=10+p.combo*2; p.combo++; p.comboT=1.8;
        showCombo(p.combo);
        showChainHUD(p.hitChain);
        pSpawn(v.x+v.w/2,v.y+v.h/2,
          {n:isFinisher?16:8,grav:100,minLife:0.35,maxLife:isFinisher?0.75:0.55,
           color:v.aura,size:isFinisher?12:7,glow:true,minSpd:55,maxSpd:isFinisher?280:190});
        if(isFinisher)shakeScreen(7,0.25);
      }
    }
  }

  // ── Air attack hit check (downward slam) ──────────────────────────
  if(p._airAtk&&v&&!v.dead){
    if(overlap(p.airBounds(),v.gb())){
      var aDmg=p.powered?28:18;
      if(v.takeDmg(aDmg)){
        GS.score+=22; p.combo++; p.comboT=1.8;
        showCombo(p.combo);
        pSpawn(v.x+v.w/2,v.y+v.h/2,
          {n:14,grav:80,minLife:0.5,maxLife:0.75,
           color:'#ff44ff',size:10,glow:true,minSpd:80,maxSpd:240});
        shakeScreen(9,0.35);
      }
    }
  }

  // ── Villain update ────────────────────────────────────────────────
  if(v&&!v.dead){
    v.update(dt,plat,p);
    for(var vi=0;vi<v._projs.length;vi++)GS.projs.push(v._projs[vi]);
    v._projs=[];
    // Close-range melee during telegraph
    if(v.state==='telegraph'&&v.stT<0.07){
      if(dist(v.x+v.w/2,v.y+v.h/2,p.x+p.w/2,p.y+p.h/2)<72)
        p.takeDmg(v.dmg*0.5,v.facing*290);
    }
  }

  // ── VILLAIN DEFEAT DETECTION — synchronous, no setTimeout race ────
  // Checked separately from the update block so it fires even if villain
  // was killed by a projectile (not just melee), and fires in the SAME frame.
  if(v&&v.dead&&!GS.winning){
    GS.winning=true;
    doVictory();   // ← synchronous call — no race condition possible
  }

  // ── Projectile collision loop ─────────────────────────────────────
  for(var pi=GS.projs.length-1;pi>=0;pi--){
    var pr=GS.projs[pi];
    pr.update(dt);
    if(pr.y>580||pr.x<cam.x-220||pr.x>cfg.worldW+220){pr.dead=true;}
    if(!pr.dead){
      for(var pj=0;pj<plat.length;pj++){
        if(overlap(pr.gb(),plat[pj])){
          pSpawn(pr.x,pr.y,{n:5,grav:70,minLife:0.28,maxLife:0.45,color:pr.color,size:5,glow:true,minSpd:35,maxSpd:110});
          pr.dead=true;break;
        }
      }
    }
    if(pr.dead){ ProjPoolRelease(pr); GS.projs.splice(pi,1); continue; }
    if(pr.owner==='player'&&v&&!v.dead&&overlap(pr.gb(),v.gb())){
      if(v.takeDmg(pr.dmg)){
        GS.score+=pr.isKame?28:13;p.combo++;p.comboT=1.8;showCombo(p.combo);
        pSpawn(pr.x,pr.y,{n:9,grav:45,minLife:0.4,maxLife:0.6,color:pr.color,size:8,glow:true,minSpd:55,maxSpd:195});
      }
      pr.dead=true; ProjPoolRelease(pr); GS.projs.splice(pi,1); continue;
    }
    if(pr.owner==='villain'&&!p.dead&&overlap(pr.gb(),p.gb())){
      // Solarflare makes player unable to dodge but still takes damage
      p.takeDmg(pr.dmg,pr.vx*0.28);
      pSpawn(pr.x,pr.y,{n:7,grav:70,minLife:0.32,maxLife:0.5,color:pr.color,size:7,glow:true,minSpd:45,maxSpd:150});
      pr.dead=true; ProjPoolRelease(pr); GS.projs.splice(pi,1); continue;
    }
  }

  // ── Power-up collection ───────────────────────────────────────────
  if(!GS.puDone&&cfg.pu){
    var pub={x:cfg.pu.x-16,y:cfg.pu.y-16,w:32,h:32};
    if(overlap(p.gb(),pub)){
      GS.puDone=true;p.powerUp(10);GS.score+=100;
      pSpawn(cfg.pu.x,cfg.pu.y,{n:22,grav:-45,minLife:0.9,maxLife:1.3,color:'#ffee00',size:10,glow:true,minSpd:38,maxSpd:175});
    }
  }

  // ── Fell off world ────────────────────────────────────────────────
  if(p.y>560&&!p.dead)p.takeDmg(p.hp);

  // ── Death trigger ─────────────────────────────────────────────────
  if(p.dead&&!GS.dying){
    GS.dying=true;
    setTimeout(function(){if(GS.state===STATE.PLAYING)doGameOver();},1600);
  }

  // ── Particles + camera + damage numbers ───────────────────────────
  pUpdate(dt);
  updateDamageNumbers(dt);
  updateCam(dt,p.x,p.y,cfg.worldW,p.facing);

  // ── Combo float fade ──────────────────────────────────────────────
  if(_comboFT>0){
    _comboFT-=dt;
    if(_comboFT<=0){
      var cfe=document.getElementById('comboFloat');
      if(cfe)cfe.style.opacity='0';
    }
  }

  updateHUD();
  flushInput();
}

/* ==========================================================================
   DRAW — renders during PLAYING, PAUSED, VICTORY, and LVL_TRANS states
   During LVL_TRANS the game world is frozen but still visually present
   beneath the overlay, giving it a "window into the level" feel.
   ========================================================================== */
var _firstRender=true;
function draw(t){
  if (_fpsDebug) console.log('DRAW', t.toFixed ? t.toFixed(3) : t);
  ctx.clearRect(0,0,VW,VH);
  // Render canvas for all these states (overlays handle UI on top)
  var drawStates=[STATE.PLAYING,STATE.PAUSED,STATE.VICTORY,STATE.LVL_TRANS];
  var shouldDraw=false;
  for(var di=0;di<drawStates.length;di++){if(GS.state===drawStates[di]){shouldDraw=true;break;}}
  if(!shouldDraw)return;

  var cfg=GS.cfg,p=GS.player,v=GS.villain;
  if(!cfg)return;
  ctx.save();
  ctx.translate(cam.sx,cam.sy);
  var cx=cam.x;
  drawBG(cfg,cx,t);
  ctx.translate(0, WORLD_TOP_OFFSET);
  drawPlat(cfg.plat,cx);
  drawPU(cfg,cx,t);
  pDraw();
  if(p){try{p.draw(cx,t);}catch(e){console.error('player draw',e);}}
  if(v){try{v.draw(cx,t);}catch(e){console.error('villain draw',e);}}
  for(var i=0;i<GS.projs.length;i++){try{GS.projs[i].draw(cx);}catch(e){}}
  drawDamageNumbers(cx);

  // ── Solarflare white-out vignette ─────────────────────────────────
  if(GS.solarflareT>0){
    var sfAlpha=Math.min(0.55,GS.solarflareT*0.35);
    ctx.globalAlpha=sfAlpha;
    ctx.fillStyle='#ffffcc';
    ctx.fillRect(-cam.sx,-cam.sy,VW,VH);
    ctx.globalAlpha=1;
  }

  // ── VICTORY flash — brief golden overlay before level-clear screen ─
  // GS.winning is true and state is VICTORY during the 900ms window
  if(GS.state===STATE.VICTORY){
    ctx.globalAlpha=0.12;
    ctx.fillStyle='#ffee00';
    ctx.fillRect(-cam.sx,-cam.sy,VW,VH);
    ctx.globalAlpha=1;
  }

  // ── LVL_TRANS — dim the world behind the overlay ──────────────────
  if(GS.state===STATE.LVL_TRANS){
    ctx.globalAlpha=0.55;
    ctx.fillStyle='#000010';
    ctx.fillRect(-cam.sx,-cam.sy,VW,VH);
    ctx.globalAlpha=1;
  }

  ctx.restore();
  if(_firstRender){_firstRender=false;console.log('Player rendered');}
}

/* ==========================================================================
   GAME LOOP — high-FPS, deltaTime-based, FPS overlay
   ========================================================================== */
var _lastTS = 0, _loopT = 0;
function loop(ts) {
  var dt = getDeltaTime(ts);
  if (_fpsDebug) console.log('LOOP dt', dt.toFixed ? dt.toFixed(3) : dt);
  _loopT += dt;
  _fpsElapsed += dt;
  _fpsCount++;
  if (_fpsElapsed >= 0.5) {
    _fpsDisplay = Math.round(_fpsCount / _fpsElapsed);
    _fpsCount = 0;
    _fpsElapsed = 0;
  }
  update(dt);
  draw(_loopT);
  if (_fpsDebug) {
    ctx.save();
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#00ff44';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeText('FPS: ' + _fpsDisplay, 14, 32);
    ctx.fillText('FPS: ' + _fpsDisplay, 14, 32);
    ctx.restore();
  }
  requestAnimationFrame(loop);
}

// Loop bootstrap with safety: ensure only one RAF instance
var _loopStarted = false;
function startLoop(){
  if(_loopStarted) return; _loopStarted = true;
  _lastFrameTime = 0; // reset to avoid a large dt on first frame
  requestAnimationFrame(loop);
  console.log('Game loop started');
}

document.addEventListener('visibilitychange', function(){
  if(document.hidden){
    // page hidden — audio may suspend; avoid dt spike when visible again
    // keep loop running but reset timing on resume
  } else {
    _lastFrameTime = 0; // reset time so next frame has clamped dt
  }
});

showScreen('sTitle');
startLoop();


}); // end DOMContentLoaded

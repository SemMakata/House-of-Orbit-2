// Global variables
const EPS = 1e-6;
const COL = {
  mag: "#e600a9",
  cyan: "#25a4ff", 
  green: "#1aa65b",
};

// Gamepad controller support
let gamepad = null;
let gamepadButtons = {};
let gamepadAxes = [0, 0, 0, 0];
let uiVisible = false; // default closed
let lastButtonStates = {};
let axisPressed = {
  leftX: false,
  leftY: false,
  rightX: false,
  rightY: false,
  lastUpdateTime: null,
  lastFineUpdateTime: null
};
// Track previous trigger values to compute deltas and avoid 'stuck' behavior
let lastTriggerValues = { l2: 0, r2: 0 };
// R3 press tracking for single vs double-tap behavior
let _r3PressCount = 0;
let _r3PressTimer = null;

// Color menu state
let colorMenuVisible = false;
let menuState = 'main'; // 'main', 'editing'
let menuIndex = 0; // Current selection index
let rgbComponentIndex = 0; // Current RGB component (0=R, 1=G, 2=B)
let currentColorType = ''; // 'background' or 'foreground'

// Menu options for main menu
const mainMenuOptions = ['background', 'foreground', 'reset'];

// Color system - RGB values
const colors = {
  background: {r: 255, g: 255, b: 255}, // White
  foreground: {r: 11, g: 15, b: 26}     // Dark blue
};

// Default colors for reset
const defaultColors = {
  background: {r: 255, g: 255, b: 255},
  foreground: {r: 11, g: 15, b: 26}
};

// Button names for PS5 controller (DualSense)
const PS5_BUTTONS = [
  'Cross',      // 0
  'Circle',     // 1
  'Square',     // 2
  'Triangle',   // 3
  'L1',         // 4
  'R1',         // 5
  'L2',         // 6
  'R2',         // 7
  'Share',      // 8
  'Options',    // 9
  'L3',         // 10
  'R3',         // 11
  'DPadUp',     // 12
  'DPadDown',   // 13
  'DPadLeft',   // 14
  'DPadRight',  // 15
  'PS',         // 16
  'Touchpad'    // 17
];

const S = {
  thetaDeg: 0,
  R: 270,
  rc: 60,
  lw: 13,
  showGrid: false,
  debug: false,
  zone: null,
  spinDeg: 0,
  thetaPrevDeg: 0,
  dir: 0,
  t1: 5,
  t2: 4,
  p1yPrev: null,
  p2yPrev: null,
  p1Prev: null,
  p2Prev: null,
  playing: false,
  speed: 60,
  lastT: null,
  maxStepDeg: 1,
  // Grid dimension parameters  
  gridScale: 100, // Percentage-based scaling
  gridWidth: 1.0,
  gridHeight: 1.0,
  masterScale: 100, // Master scale for everything
  // Text parameters
  showText: true,
  // Show or hide all foreground elements (house, text, tangents, planet)
  showForeground: true,
  textContent: "HOUSE\nOF\nORBIT",
  fontSize: 45,
  lineHeight: 0.9,
  textPadding: 20,
  // Orbit eccentricity (0 = perfect circle, closer to 1 = more flattened vertically)
  // Separate eccentricity for horizontal (eccX) and vertical (eccY).
  // Both 0.0 -> circle. Increase one to flatten that axis.
  scaleX: 1.0,
  scaleY: 1.0,
  // Whether to draw the orbital path (ellipse)
  showOrbitPath: false,
  // Path height scale (multiply ellipse height by this factor)
  pathHeightScale: 1.0,
};

// Conversion server config (can be overridden at runtime). Default points to
// the public converter domain used by the site. Local IPs (LAN/localhost)
// are only relevant on the machine hosting the converter and should not be
// presented to end users — use the public domain for client-facing URLs.
// Default converter URL — public endpoint. Override in the UI if needed.
let SERVER_CONVERT_URL = `https://houseoforbit.semmakata.com/convert`;
// Credentials for Basic auth (the server must be started with these env vars).
let SERVER_CONVERT_USER = 'hoadmin';
let SERVER_CONVERT_PASS = 'r8VqL2x9sZkP4nT1';
// If you prefer a base64 string directly, set SERVER_CONVERT_AUTH; otherwise the client will build it from USER/PASS.
let SERVER_CONVERT_AUTH = '';

// The client uses SERVER_CONVERT_URL for uploads. A locally-run converter
// may listen on a port for the server operator, but clients should continue
// to use the public domain (the site/proxy will forward /convert to the
// converter service). Port where a local converter listens (operator-only).
const SERVER_CONVERT_PORT = 3333;

// If you want to force a different converter host, set DEFAULT_CONVERT_HOST accordingly.
const DEFAULT_CONVERT_HOST = 'houseoforbit.semmakata.com';

// If the page is served from a LAN IP (for example when you're using Live Server on
// port 5500 and accessing via http://localhost:5500), the UI still defaults to the
// public converter domain. Users can override `SERVER_CONVERT_URL` in the UI if they host
// the converter themselves (for example: https://houseoforbit.semmakata.com/convert).

// --- Global UI / utility helpers used by recording/upload flow ---
function downloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { console.warn('downloadBlob failed', e); }
}

function showConvertOverlay(statusText = 'Uploading...') {
  try {
    const o = document.getElementById('convertOverlay');
    const s = document.getElementById('convertStatus');
    const p = document.querySelector('#convertProgress > i');
    if (o) o.style.display = 'flex';
    if (s) s.textContent = statusText;
    if (p) p.style.width = '0%';
    const manual = document.getElementById('convertManualDownload');
    if (manual) manual.style.display = 'none';
  } catch (e) {}
}

function hideConvertOverlay() {
  try { const o = document.getElementById('convertOverlay'); if (o) o.style.display = 'none'; } catch(e){}
}

function setConvertProgress(pct, statusText) {
  try { const p = document.querySelector('#convertProgress > i'); if (p) p.style.width = pct + '%'; } catch(e){}
  try { const s = document.getElementById('convertStatus'); if (s && statusText) s.textContent = statusText; } catch(e){}
}

// Sanitize conversion server URL: trim whitespace and strip accidental extra characters
function sanitizeConvertUrl(u) {
  try {
    if (!u) return u;
    let s = String(u).trim();
    // If user accidentally pasted code like "http://host:3333/convert',{"
    // strip anything after the canonical path '/convert'
    const marker = '/convert';
    const idx = s.indexOf(marker);
    if (idx >= 0) {
      s = s.slice(0, idx + marker.length);
    }
    // Remove surrounding quotes if present
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      s = s.slice(1, -1);
    }
    return s;
  } catch (e) { return u; }
}

// Apply sanitizer to configured SERVER_CONVERT_URL immediately
try { SERVER_CONVERT_URL = sanitizeConvertUrl(SERVER_CONVERT_URL); } catch (e) {}

// Lightweight on-page client logger (for easier copy/paste diagnostics)
function uiLog(msg) {
  try {
    const el = document.getElementById('clientLog');
    if (!el) return;
    el.style.display = 'block';
    const now = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.textContent = `[${now}] ${msg}`;
    el.appendChild(line);
    // keep scroll at bottom
    el.scrollTop = el.scrollHeight;
  } catch (e) { console.warn('uiLog failed', e); }
}


// No tunnel fallbacks — clients should use the configured public converter URL.

let canvasElement;
let nebulicaFont = null; // Initialize as null
let opentypeFont = null; // For opentype.js font
// Export-time high-resolution graphics buffer (when recording at >1 scale)
let _exportGraphics = null;
let _exportRAF = null;
// SVG recording state: toggle with 'E' to record vector parameters and export SMIL
let _svgRecording = false;
let _svgFrames = [];
let _svgRecordStart = 0;
let _svgRecordTimerId = null;
let _svgRecordFps = 60;
const _svgMaxFrames = 2400; // safety cap (~40s @60fps)

// Optional font loading - try both p5.js and opentype.js methods
function loadCustomFont() {
  // Try OTF first (best OpenType compatibility), then TTF as fallback
  const fontPaths = [
    'fonts/nebulica modern sans/OTF/Nebulica-Bold.otf',
    'fonts/nebulica modern sans/TTF/Nebulica-Bold.ttf'
  ];
  
  tryLoadFont(fontPaths, 0);
}

function tryLoadFont(fontPaths, index) {
  if (index >= fontPaths.length) {
    console.warn('Could not load Nebulica-Bold font in any format');
    return;
  }
  
  const fontPath = fontPaths[index];
  
  // Try to load font with opentype.js first
  if (window.opentype) {
    opentype.load(fontPath, function(err, font) {
      if (err) {
        console.warn(`Could not load font with opentype.js (${fontPath}):`, err);
        // Try next format or fall back to p5.js loadFont
        if (index < fontPaths.length - 1) {
          tryLoadFont(fontPaths, index + 1);
        } else {
          loadFontWithP5(fontPath);
        }
      } else {
        opentypeFont = font;
        console.log(`Nebulica-Bold font loaded successfully with opentype.js (${fontPath})`);
      }
    });
  } else {
    // opentype.js not available, use p5.js method
    loadFontWithP5(fontPath);
  }
}

function loadFontWithP5(fontPath) {
  // Try to load font after setup, so it doesn't block the application
  if (!nebulicaFont) {
    loadFont(fontPath, 
      // Success callback
      (font) => {
        nebulicaFont = font;
        console.log(`Nebulica-Bold font loaded successfully with p5.js (${fontPath})`);
      },
      // Error callback  
      (err) => {
        console.warn(`Could not load Nebulica-Bold.ttf font with p5.js (${fontPath}):`, err);
        nebulicaFont = null;
      }
    );
  }
}

function setup() {
  console.log("Setup starting...");
  console.log("Document ready state:", document.readyState);
  
  // Create fullscreen canvas
  canvasElement = createCanvas(windowWidth, windowHeight);
  console.log("Fullscreen canvas created:", canvasElement);
  
  // Try to attach to p5-container
  try {
    let containerElement = document.querySelector('#p5-container');
    console.log("Container element found:", containerElement);
    
    if (containerElement) {
      canvasElement.parent(containerElement);
      console.log("Canvas attached to p5-container");
    } else {
      console.log("p5-container not found, canvas will be attached to body");
    }
  } catch (error) {
    console.error("Error attaching canvas:", error);
  }
  
  canvasElement.canvas.id = 'scene';
  
  // Set up UI event listeners
  setupUI();
  
  // Set up gamepad listeners
  setupGamepad();
  
  // Set up hamburger button
  setupHamburgerButton();
  
  // Try to load custom font (non-blocking)
  loadCustomFont();
  
  // Initialize color menu
  setTimeout(() => {
    updateColorPreviews();
    setupColorSliders();
  }, 100);
  
  // Trigger initial resize to fit properly
  windowResized();
  
  console.log("p5.js setup complete");

  console.log('Using conversion server URL:', SERVER_CONVERT_URL);

  // Start server status pinger (updates #serverStatus every 3s)
  setInterval(pingConversionServer, 3000);

  // Wire conversion URL input/test UI
  try {
    const input = document.getElementById('convertUrlInput');
    const btn = document.getElementById('convertTestBtn');
    const res = document.getElementById('convertTestResult');
  const uploadTest = document.getElementById('convertUploadTestBtn');
    if (input) input.value = SERVER_CONVERT_URL || '';
    if (btn) btn.addEventListener('click', async () => {
      try {
        const val = input && input.value ? input.value.trim() : ''; 
        if (!val) return; 
        const clean = sanitizeConvertUrl(val);
        // Set global to cleaned value so later uploads use it
        SERVER_CONVERT_URL = clean;
        res.textContent = 'Testing ' + clean + ' ...';
        const headers = {};
        let auth = SERVER_CONVERT_AUTH;
        if (!auth && SERVER_CONVERT_USER && SERVER_CONVERT_PASS) auth = btoa(`${SERVER_CONVERT_USER}:${SERVER_CONVERT_PASS}`);
        if (auth) headers['Authorization'] = `Basic ${auth}`;
        const r = await fetch(clean, { method: 'GET', headers, cache: 'no-store' });
        res.textContent = `Status: ${r.status} ${r.statusText}`;
      } catch (e) {
        res.textContent = 'Test failed: ' + (e && e.message ? e.message : String(e));
      }
    });
    if (uploadTest) uploadTest.addEventListener('click', async () => {
      try {
        const clean = sanitizeConvertUrl(SERVER_CONVERT_URL || (input && input.value) || '');
        if (!clean) { uiLog('No convert URL configured'); return; }
        uiLog('Uploading tiny test blob to ' + clean);
        const headers = {};
        let auth = SERVER_CONVERT_AUTH;
        if (!auth && SERVER_CONVERT_USER && SERVER_CONVERT_PASS) auth = btoa(`${SERVER_CONVERT_USER}:${SERVER_CONVERT_PASS}`);
        if (auth) headers['Authorization'] = `Basic ${auth}`;
  // Create a larger synthetic blob (~48KB) so the server's minimum-size check passes
  const size = 48 * 1024;
  const arr = new Uint8Array(size);
  // Fill with a simple pattern so it's not all zeros
  for (let i = 0; i < size; i++) arr[i] = i % 256;
  const blob = new Blob([arr], { type: 'application/octet-stream' });
  const form = new FormData();
  form.append('file', blob, 'tiny-test.webm');
  // Tell server this is a synthetic test upload so it can avoid running ffmpeg
  form.append('test', '1');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const resp = await fetch(clean, { method: 'POST', headers, body: form, signal: controller.signal });
        clearTimeout(timeoutId);
        uiLog(`Upload test response ${resp.status} ${resp.statusText}`);
        if (resp.ok) {
          const data = await resp.blob();
          uiLog(`Server returned ${data.size} bytes`);
        } else {
          const txt = await resp.text();
          uiLog(`Server error: ${resp.status} ${txt.slice(0,200)}`);
        }
      } catch (e) { uiLog('Upload test failed: ' + (e && e.message ? e.message : e)); }
    });
  } catch (e) {}

  // Export preset wiring: default to Full HD
  try {
    const presetSel = document.getElementById('exportPreset');
    // Centralized export settings object derived from selected preset
    window.exportSettings = {
      preset: (presetSel && presetSel.value) ? presetSel.value : 'youtube_hd',
      // derived fields: codec, resolution, bitrateMbps, forceBitrate, format, vbr_pass, max_bitrate
      codec: 'h264',
      resolution: '1920x1080',
      bitrateMbps: 12,
      forceBitrate: true,
      format: 'mp4',
      vbr_pass: '2',
      max_bitrate: null,
      allowLocalOversize: true,
      trim: true,
      scale: 1
    };
    const applyPreset = (p) => {
      let s = window.exportSettings;
      s.preset = p;
      switch (p) {
        case 'youtube_4k': s.codec='h264'; s.resolution='3840x2160'; s.bitrateMbps=40; s.forceBitrate=true; s.vbr_pass='2'; s.max_bitrate=60000000; s.format='mp4'; break;
        case 'archive_4k': s.codec='prores'; s.resolution='3840x2160'; s.bitrateMbps=0; s.forceBitrate=false; s.vbr_pass='1'; s.format='mov'; break;
        case 'transparency_4k': s.codec='prores4444'; s.resolution='3840x2160'; s.bitrateMbps=0; s.forceBitrate=false; s.vbr_pass='1'; s.format='mov'; break;
        case 'social_4k': s.codec='h264'; s.resolution='3840x2160'; s.bitrateMbps=25; s.forceBitrate=true; s.vbr_pass='2'; s.format='mp4'; break;
        case 'youtube_hd': s.codec='h264'; s.resolution='1920x1080'; s.bitrateMbps=12; s.forceBitrate=true; s.vbr_pass='2'; s.max_bitrate=25000000; s.format='mp4'; break;
        case 'archive_hd': s.codec='prores'; s.resolution='1920x1080'; s.bitrateMbps=0; s.forceBitrate=false; s.vbr_pass='1'; s.format='mov'; break;
        case 'transparency_hd': s.codec='prores4444'; s.resolution='1920x1080'; s.bitrateMbps=0; s.forceBitrate=false; s.vbr_pass='1'; s.format='mov'; break;
        case 'social_hd': s.codec='h264'; s.resolution='1920x1080'; s.bitrateMbps=10; s.forceBitrate=true; s.vbr_pass='2'; s.format='mp4'; break;
        default: /* custom: leave settings as-is */ break;
      }
      // update computed UI preview if present
      try { window.updateComputedExportResolution && window.updateComputedExportResolution(); } catch(e){}
    };
    // apply initial preset
    applyPreset(window.exportSettings.preset || 'youtube_hd');
    if (presetSel) presetSel.addEventListener('change', (ev) => { applyPreset(ev.target.value); });
    // Wire client override controls for computed export preview
    try {
      const clientMaxEl = document.getElementById('clientSafeMax');
      const pdEl = document.getElementById('exportPixelDensity');
      if (clientMaxEl) clientMaxEl.addEventListener('input', () => { try { window.updateComputedExportResolution && window.updateComputedExportResolution(); } catch(e){} });
      if (pdEl) pdEl.addEventListener('change', () => { try { window.updateComputedExportResolution && window.updateComputedExportResolution(); } catch(e){} });
    } catch(e){}
  } catch (e) { console.warn('Export preset wiring failed', e); }

  // Wire orbit path toggle checkbox
  try {
    const orbitChk = document.getElementById('toggleOrbitPathChk');
    if (orbitChk) {
      orbitChk.checked = !!S.showOrbitPath;
      orbitChk.addEventListener('change', () => { S.showOrbitPath = !!orbitChk.checked; });
    }
  } catch (e) {}

  // Global error handler - display errors in convert overlay for easier debugging
  window.addEventListener('error', function (e) {
    try { showConvertOverlay('Error: ' + (e && e.message ? e.message : 'Unknown')); const manual = document.getElementById('convertManualDownload'); if (manual) manual.style.display = 'inline-block'; } catch(err){}
    console.error('Global error:', e.error || e.message || e);
  });
}

async function pingConversionServer() {
  const el = document.getElementById('serverStatus');
  if (!el) return;
  if (!SERVER_CONVERT_URL) {
    el.textContent = 'Server: disabled';
    el.style.color = '#999';
    return;
  }
  try {
    // Use HEAD to check endpoint quickly; include auth header if configured
    const headers = {};
    let auth = SERVER_CONVERT_AUTH;
    if (!auth && SERVER_CONVERT_USER && SERVER_CONVERT_PASS) auth = btoa(`${SERVER_CONVERT_USER}:${SERVER_CONVERT_PASS}`);
    if (auth) headers['Authorization'] = `Basic ${auth}`;
  const url = sanitizeConvertUrl(SERVER_CONVERT_URL);
  console.log('Pinging conversion server at:', url);
  const resp = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
    if (resp.ok) {
      el.textContent = 'Server: online';
      el.style.color = '#0a0';
      el.onclick = () => {
        navigator.clipboard.writeText(SERVER_CONVERT_URL).then(() => {
          const prev = el.textContent;
          el.textContent = 'Copied URL';
          setTimeout(() => { el.textContent = prev; }, 1200);
        }).catch(() => {});
      };
    } else if (resp.status === 401 || resp.status === 403) {
      el.textContent = 'Server: auth';
      el.style.color = '#e65';
    } else {
      el.textContent = `Server: ${resp.status}`;
      el.style.color = '#e65';
    }
  } catch (e) {
    el.textContent = 'Server: unreachable';
    el.style.color = '#999';
    el.onclick = null;
  }
}

function draw() {
  // Debug: log once to verify draw is being called
  if (frameCount === 1) {
    console.log("Draw function called, canvas size:", width, "x", height);
  }
  
  // Handle gamepad input
  handleGamepadInput();
  
  drawScene();

  // If SVG recording is active, sample the current scene parameters for later export
  if (_svgRecording) {
    sampleSVGFrame();
  }
  
  // Handle animation
  if (S.playing) {
    let currentTime = millis();
    if (S.lastT == null) S.lastT = currentTime;
    let dt = Math.min(0.05, (currentTime - S.lastT) / 1000);
    S.lastT = currentTime;
    let total = S.speed * dt;
    let inc = Math.max(0.25, S.maxStepDeg);
    let steps = Math.max(1, Math.ceil(total / inc));
    let step = total / steps;
    for (let i = 0; i < steps; i++) {
      S.thetaDeg = (S.thetaDeg + step) % 360;
    }
    let v = S.thetaDeg.toFixed(1);
    let th = select("#theta");
    let tn = select("#thetaNum");
    if (th) th.value(v);
    if (tn) tn.value(v);
  }
}

// Lightweight orbit demo used both on-canvas and as the basis for an SVG exporter example.
function drawOrbitDemo() {
  // initialize demo state
  if (typeof S.svgDemoAngle === 'undefined') S.svgDemoAngle = 0;
  const now = millis();
  if (typeof S.svgDemoLastT === 'undefined') S.svgDemoLastT = now;
  const dt = Math.min(0.05, (now - S.svgDemoLastT) / 1000);
  S.svgDemoLastT = now;
  // advance demo angle at modest speed
  S.svgDemoAngle = (S.svgDemoAngle + dt * 90) % 360; // 90 deg/sec

  // draw a subtle demo at canvas center — non-destructive
  push();
  noFill();
  stroke(180);
  strokeWeight(1);
  const cx = width / 2, cy = height / 2;
  const orbitR = Math.min(width, height) * 0.22;
  // orbit path
  circle(cx, cy, orbitR * 2);
  // orbiting dot
  const a = (S.svgDemoAngle * Math.PI) / 180;
  const dx = cx + orbitR * Math.cos(a);
  const dy = cy + orbitR * Math.sin(a);
  fill(`rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})`);
  noStroke();
  circle(dx, dy, Math.max(6, S.lw * 0.6));
  pop();
}

// Export a vector-only SVG with SMIL animation describing an orbiting circle.
// filename: optional, default 'animation.svg'
// Build an SVG with SMIL animations that mirrors the current scene's moving elements
function saveAnimatedSVG(filename = 'animation.svg', durationSec = null, fps = 30) {
  try {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    // default duration: if not provided, compute a single-rotation duration from S.speed
    let dur = durationSec && durationSec > 0 ? Number(durationSec) : (S.speed && S.speed > 0 ? (360 / S.speed) : 4);
    // clamp frames to reasonable amount
    const frames = Math.min(60, Math.max(12, Math.round((dur || 4) * (fps || 30))));

    // Compute static geometry
    const poly = housePoly(24, 24, w - 48, h - 48); // reuse same padding as drawScene
    const H = centroid(poly);
    const masterScaleFactor = S.masterScale / 100;
    const scaledR = S.R * masterScaleFactor;
    const scaledRc = S.rc * masterScaleFactor;
    const sx = S.scaleX || 1;
    const sy = S.scaleY || 1;

    // starting angle (degrees)
    const startTheta = (typeof S.thetaDeg === 'number') ? S.thetaDeg : 0;

    // Precompute sample frames (positions for moving items)
    const circleCx = [];
    const circleCy = [];
    const p1x = [], p1y = [], p2x = [], p2y = [];
    for (let i = 0; i < frames; i++) {
      const t = i / frames; // 0 .. <1
      const timeSec = t * dur;
      const theta = startTheta + (S.speed || 60) * timeSec; // degrees
      const ang = (theta * Math.PI) / 180 + Math.PI / 2;
      const Cx = H.x + scaledR * Math.cos(ang) * sx;
      const Cy = H.y + scaledR * Math.sin(ang) * sy;
      circleCx.push(Number(Cx.toFixed(3)));
      circleCy.push(Number(Cy.toFixed(3)));

      // use current anchor points a1/a2 (do not change S.t1/t2 state machine)
      const a1 = getHousePoint(S.t1, poly);
      const a2 = getHousePoint(S.t2, poly);
      const tang = chooseTangents({ x: Cx, y: Cy }, scaledRc, a1, a2, S.p1Prev, S.p2Prev);
      const tp1 = tang[0], tp2 = tang[1];
      p1x.push(Number(tp1.x.toFixed(3))); p1y.push(Number(tp1.y.toFixed(3)));
      p2x.push(Number(tp2.x.toFixed(3))); p2y.push(Number(tp2.y.toFixed(3)));
    }

    // helper: make keyTimes and values strings for SMIL
    const keyTimes = Array.from({ length: frames }, (_, i) => (i / frames).toFixed(4)).join(';') + ';1';
    // But better map to 0..1 inclusive: we need exactly frames samples including endpoint
    const keyTimesArr = [];
    for (let i = 0; i <= frames; i++) keyTimesArr.push((i / frames).toFixed(6));
    const keyTimesStr = keyTimesArr.join(';');

    function valuesStr(arr) {
      // arr length == frames
      const vals = [];
      for (let i = 0; i < frames; i++) vals.push(arr[i]);
      // append first value to close loop
      vals.push(arr[0]);
      return vals.join(';');
    }

    const svg = [];
    svg.push('<?xml version="1.0" encoding="utf-8"?>');
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
    svg.push(`<rect width="100%" height="100%" fill="rgb(${colors.background.r}, ${colors.background.g}, ${colors.background.b})"/>`);

    // House polygon (static)
    const polyPoints = poly.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
    svg.push(`<polygon points="${polyPoints}" fill="none" stroke="rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})" stroke-width="${(S.lw * masterScaleFactor).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`);

    // Tangent lines (animated endpoints p1 -> a1 and p2 -> a2). We'll animate x1,y1 and leave x2,y2 static.
    const a1pt = getHousePoint(S.t1, poly);
    const a2pt = getHousePoint(S.t2, poly);
    // Line 1
    svg.push(`<line id="t1" x1="${p1x[0]}" y1="${p1y[0]}" x2="${a1pt.x.toFixed(3)}" y2="${a1pt.y.toFixed(3)}" stroke="rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})" stroke-width="${(S.lw * masterScaleFactor).toFixed(2)}" stroke-linecap="round"/>`);
    // Line 2
    svg.push(`<line id="t2" x1="${p2x[0]}" y1="${p2y[0]}" x2="${a2pt.x.toFixed(3)}" y2="${a2pt.y.toFixed(3)}" stroke="rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})" stroke-width="${(S.lw * masterScaleFactor).toFixed(2)}" stroke-linecap="round"/>`);

    // Orbiting circle (animated cx,cy)
    svg.push(`<circle id="orb" cx="${circleCx[0]}" cy="${circleCy[0]}" r="${Math.max(2, (S.rc * masterScaleFactor * 0.25)).toFixed(2)}" fill="rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})"/>`);

    // Add animate tags: circle cx/cy
    svg.push(`<animate xlink:href="#orb" attributeName="cx" dur="${dur}s" repeatCount="indefinite" keyTimes="${keyTimesStr}" values="${valuesStr(circleCx)}" calcMode="linear"/>`);
    svg.push(`<animate xlink:href="#orb" attributeName="cy" dur="${dur}s" repeatCount="indefinite" keyTimes="${keyTimesStr}" values="${valuesStr(circleCy)}" calcMode="linear"/>`);

    // Tangent animates for t1 (x1,y1) and t2
    svg.push(`<animate xlink:href="#t1" attributeName="x1" dur="${dur}s" repeatCount="indefinite" keyTimes="${keyTimesStr}" values="${valuesStr(p1x)}" calcMode="linear"/>`);
    svg.push(`<animate xlink:href="#t1" attributeName="y1" dur="${dur}s" repeatCount="indefinite" keyTimes="${keyTimesStr}" values="${valuesStr(p1y)}" calcMode="linear"/>`);
    svg.push(`<animate xlink:href="#t2" attributeName="x1" dur="${dur}s" repeatCount="indefinite" keyTimes="${keyTimesStr}" values="${valuesStr(p2x)}" calcMode="linear"/>`);
    svg.push(`<animate xlink:href="#t2" attributeName="y1" dur="${dur}s" repeatCount="indefinite" keyTimes="${keyTimesStr}" values="${valuesStr(p2y)}" calcMode="linear"/>`);

    svg.push(`</svg>`);

    const svgString = svg.join('\n');
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'animation.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    console.log('Animated SVG saved:', filename);
  } catch (e) {
    console.error('saveAnimatedSVG failed', e);
  }
}

function windowResized() {
  let mainElement = select('main');
  if (canvasElement && mainElement) {
    let rect = mainElement.elt.getBoundingClientRect();
    let w = Math.max(400, rect.width);
    let h = Math.max(300, rect.height);
    resizeCanvas(w, h);
  }
}

function setupGamepad() {
  // Listen for gamepad connection
  window.addEventListener("gamepadconnected", function(e) {
    console.log("Gamepad connected:", e.gamepad);
    gamepad = e.gamepad;
  });
  
  // Listen for gamepad disconnection
  window.addEventListener("gamepaddisconnected", function(e) {
    console.log("Gamepad disconnected");
    gamepad = null;
  });
}

function setupHamburgerButton() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const uiOverlay = document.getElementById('uiOverlay');
  
  if (hamburgerBtn && uiOverlay) {
    hamburgerBtn.addEventListener('click', function() {
      uiVisible = !uiVisible;
      
        if (uiVisible) {
          uiOverlay.classList.remove('hidden');
          // position the settings button to the right edge of the panel so it doesn't hover over the content
          hamburgerBtn.classList.remove('ui-hidden');
          hamburgerBtn.classList.add('ui-open');
          // show a close icon
          hamburgerBtn.innerHTML = '✕';
        } else {
          uiOverlay.classList.add('hidden');
          hamburgerBtn.classList.remove('ui-open');
          hamburgerBtn.classList.add('ui-hidden');
          // show a settings icon when closed
          hamburgerBtn.innerHTML = '⚙';
        }
    });
  }
}

function handleGamepadInput() {
  // Get current gamepads
  const gamepads = navigator.getGamepads();
  
  if (gamepads[0]) {
    gamepad = gamepads[0];
    gamepadButtons = gamepad.buttons;
    gamepadAxes = gamepad.axes;
    
    // PSN button (button 16): Toggle color menu
    if (gamepadButtons[16] && gamepadButtons[16].pressed && !lastButtonStates[16]) {
      toggleColorMenu();
    }
    
    // Circle button (button 1): when recording, stop recording; otherwise toggle foreground
    if (gamepadButtons[1] && gamepadButtons[1].pressed && !lastButtonStates[1]) {
      if (_isRecording) {
        stopRecording();
      } else if (!colorMenuVisible) {
        S.showForeground = !S.showForeground;
        updateUIElement('showForeground', S.showForeground);
      } else {
        // In color menu, circle closes menu (handled elsewhere)
      }
    }
    
    // If color menu is visible, handle color menu navigation
    if (colorMenuVisible) {
      handleColorMenuInput();
    } else {
      // Normal controls when color menu is not visible
      handleNormalGamepadInput();
    }
    
    // Update last button states
    for (let i = 0; i < gamepadButtons.length; i++) {
      lastButtonStates[i] = gamepadButtons[i] ? gamepadButtons[i].pressed : false;
    }
  }
}

function handleColorMenuInput() {
  // Use a slightly smaller deadzone for editing so analog sticks (which can be subtle)
  // still register when the color menu is open.
  const deadZoneDefault = 0.3;
  const deadZoneEditing = 0.12; // more sensitive while editing colors
  const deadZone = (menuState === 'editing') ? deadZoneEditing : deadZoneDefault;
  const currentTime = millis();
  // Dominant axis logic: require a noticeably larger magnitude on one axis
  // to avoid accidental diagonal input. This ensures left/right movements
  // don't accidentally trigger up/down navigation.
  const releaseDeadZone = 0.08; // smaller threshold to release axis lock
  const dominantFactor = 1.8; // axis must be ~1.8x stronger than the other to be dominant
  const leftXAxis = gamepadAxes[0] || 0;
  const leftYAxis = gamepadAxes[1] || 0;
  const absLX = Math.abs(leftXAxis), absLY = Math.abs(leftYAxis);
  let dominant = null; // 'x' | 'y' | null
  if (absLX > deadZone && absLX > dominantFactor * absLY) dominant = 'x';
  else if (absLY > deadZone && absLY > dominantFactor * absLX) dominant = 'y';
  
  if (menuState === 'main') {
    // Main menu navigation (discrete)
  if ((gamepadButtons[12] && gamepadButtons[12].pressed && !lastButtonStates[12]) ||
    (dominant === 'y' && leftYAxis < -deadZone && !axisPressed.leftY)) {
      menuIndex = Math.max(0, menuIndex - 1);
      updateColorMenuDisplay();
      axisPressed.leftY = true;
    }
    
  if ((gamepadButtons[13] && gamepadButtons[13].pressed && !lastButtonStates[13]) ||
    (dominant === 'y' && leftYAxis > deadZone && !axisPressed.leftY)) {
      menuIndex = Math.min(mainMenuOptions.length - 1, menuIndex + 1);
      updateColorMenuDisplay();
      axisPressed.leftY = true;
    }
    
  // Release vertical axis lock when the stick returns near center (using a smaller release dead zone)
  if (Math.abs(leftYAxis) <= releaseDeadZone) axisPressed.leftY = false;
    
    // X button: Select option
    if (gamepadButtons[0] && gamepadButtons[0].pressed && !lastButtonStates[0]) {
      selectMainMenuOption();
    }
    
    // Circle button: Close menu
    if (gamepadButtons[1] && gamepadButtons[1].pressed && !lastButtonStates[1]) {
      toggleColorMenu();
    }
    
  } else if (menuState === 'editing') {
    // RGB component selection (discrete)
  if ((gamepadButtons[12] && gamepadButtons[12].pressed && !lastButtonStates[12]) ||
    (dominant === 'y' && leftYAxis < -deadZone && !axisPressed.leftY)) {
      rgbComponentIndex = Math.max(0, rgbComponentIndex - 1);
      updateColorMenuDisplay();
      axisPressed.leftY = true;
    }
    
  if ((gamepadButtons[13] && gamepadButtons[13].pressed && !lastButtonStates[13]) ||
    (dominant === 'y' && leftYAxis > deadZone && !axisPressed.leftY)) {
      rgbComponentIndex = Math.min(2, rgbComponentIndex + 1);
      updateColorMenuDisplay();
      axisPressed.leftY = true;
    }
    
  // Release vertical axis lock when the stick returns near center
  if (Math.abs(leftYAxis) <= releaseDeadZone) axisPressed.leftY = false;
    
  // Left/Right: Discrete RGB value adjustment with D-pad
    if ((gamepadButtons[14] && gamepadButtons[14].pressed && !lastButtonStates[14])) {
      adjustRGBValue(-5);
    }
    
    if ((gamepadButtons[15] && gamepadButtons[15].pressed && !lastButtonStates[15])) {
      adjustRGBValue(5);
    }
    
    // Continuous smooth joystick control for RGB values
    // Use LEFT stick X-axis for color adjustment (this was the original working version)
  // Reuse leftXAxis from above (dominant logic). Use axis only when it's the dominant axis
  const rightXAxis = gamepadAxes[2] || 0; // Right stick X-axis (as alternative)

    // Diagnostic logging to help trace why horizontal axis isn't triggering adjustments.
    // This will print axis values when in editing mode; remove when issue is resolved.
    try {
      console.log(`COLOR-EDIT AXES: leftX=${leftXAxis.toFixed(3)}, leftY=${gamepadAxes[1].toFixed(3)}, rightX=${rightXAxis.toFixed(3)}, rightY=${gamepadAxes[3].toFixed(3)}, deadZone=${deadZone}`);
    } catch (e) {
      // ignore formatting errors
    }
    
    // Left stick X: Primary color value adjustment (this was working before)
    if (dominant === 'x' && Math.abs(leftXAxis) > deadZone) {
      console.log(`COLOR-EDIT: leftXAxis passed deadZone (${leftXAxis.toFixed(3)})`);
      // Use exponential scaling for smoother feel
      const intensity = Math.pow(Math.abs(leftXAxis), 1.5);
      const direction = leftXAxis > 0 ? 1 : -1; // Right = positive (increase), Left = negative (decrease)
      const adjustmentSpeed = intensity * 120; // Max 120 per second
      // Use a sensible default for the first movement so the first stick motion produces an update
      const deltaTime = axisPressed.lastUpdateTime ? (currentTime - axisPressed.lastUpdateTime) : 16;
      console.log(`COLOR-EDIT: deltaTime=${deltaTime}, lastUpdateTime=${axisPressed.lastUpdateTime}, currentTime=${currentTime}`);

      if (deltaTime >= 16) { // ~60fps update rate - changed from > to >=
        let adjustment = direction * adjustmentSpeed * (deltaTime / 1000);
        // Round and ensure a non-zero integer change when there's movement
        let intAdj = Math.round(adjustment);
        if (intAdj === 0) intAdj = adjustment > 0 ? 1 : -1;
        console.log(`COLOR-EDIT: calling adjustRGBValue(${intAdj}) (raw ${adjustment.toFixed(3)})`);
        adjustRGBValue(intAdj);
        axisPressed.lastUpdateTime = currentTime;
      } else {
        console.log(`COLOR-EDIT: deltaTime too small (${deltaTime}), skipping adjustment`);
      }
    } else {
      // Reset the timer so when stick is moved again adjustment isn't blocked by a stale timestamp
      axisPressed.lastUpdateTime = null;
    }
    
    // Right stick X: Alternative fine adjustment (slower)
  if (Math.abs(rightXAxis) > deadZone) {
      const intensity = Math.pow(Math.abs(rightXAxis), 2);
      const direction = rightXAxis > 0 ? 1 : -1; // Right = positive (increase), Left = negative (decrease)
      const adjustmentSpeed = intensity * 40; // Max 40 per second (fine control)
      const deltaTime = axisPressed.lastFineUpdateTime ? (currentTime - axisPressed.lastFineUpdateTime) : 16;

      if (deltaTime >= 16) { // Changed from > to >=
        let adjustment = direction * adjustmentSpeed * (deltaTime / 1000);
        let intAdj = Math.round(adjustment);
        if (intAdj === 0) intAdj = adjustment > 0 ? 1 : -1;
        adjustRGBValue(intAdj);
        axisPressed.lastFineUpdateTime = currentTime;
      }
    } else {
      axisPressed.lastFineUpdateTime = null;
    }
    
    // Circle button: Go back to main menu
    if (gamepadButtons[1] && gamepadButtons[1].pressed && !lastButtonStates[1]) {
      menuState = 'main';
      updateColorMenuDisplay();
    }
  }
}

function handleNormalGamepadInput() {
    
    // Right stick: Grid proportions (axes 2 and 3)
    // Right stick X (axis 2): Grid width (side to side)
    if (Math.abs(gamepadAxes[2]) > 0.1) {
      let newGridWidth = S.gridWidth + (gamepadAxes[2] * 0.02); // Adjust sensitivity
      S.gridWidth = constrain(newGridWidth, 0.1, 3.0);
      updateUIElement('gridWidth', S.gridWidth);
    }
    
    // Right stick Y (axis 3): Grid height (up and down)
    if (Math.abs(gamepadAxes[3]) > 0.1) {
      let newGridHeight = S.gridHeight + (-gamepadAxes[3] * 0.02); // Invert Y axis, adjust sensitivity
      S.gridHeight = constrain(newGridHeight, 0.1, 3.0);
      updateUIElement('gridHeight', S.gridHeight);
    }
    
    // Left stick: Orbit size and rotation (axes 0 and 1)
    // Left stick Y (axis 1): Orbit size (R) - Up increases, Down decreases
    if (Math.abs(gamepadAxes[1]) > 0.1) {
      let newR = S.R + (-gamepadAxes[1] * 5); // Invert Y axis (up = negative axis value)
      S.R = constrain(newR, 10, 1000); // Extended range beyond UI limits
      updateUIElement('R', S.R);
    }
    
    // Left stick X (axis 0): Orbit rotation (thetaDeg) - Left/Right controls rotation
    if (Math.abs(gamepadAxes[0]) > 0.1) {
      let newTheta = S.thetaDeg + (gamepadAxes[0] * 2); // Adjust sensitivity
      // Wrap around at 360 degrees (like animation)
      if (newTheta >= 360) newTheta -= 360;
      if (newTheta < 0) newTheta += 360;
      S.thetaDeg = newTheta;
      updateUIElement('theta', S.thetaDeg); // Use 'theta' instead of 'thetaDeg' to match HTML ID
    }
    
    // R1 and L1 buttons: Planet size (rc) - the circle
    // R1 button (button 5): Increase planet size
    if (gamepadButtons[5] && gamepadButtons[5].pressed && !lastButtonStates[5]) {
      S.rc = constrain(S.rc + 5, 1, 200); // Increase by 5
      updateUIElement('rc', S.rc);
    }
    
    // L1 button (button 4): Decrease planet size
    if (gamepadButtons[4] && gamepadButtons[4].pressed && !lastButtonStates[4]) {
      S.rc = constrain(S.rc - 5, 1, 200); // Decrease by 5
      updateUIElement('rc', S.rc);
    }
    
    // D-pad: Animation speed and text size
    // D-pad Up (button 12): Increase animation speed
    if (gamepadButtons[12] && gamepadButtons[12].pressed && !lastButtonStates[12]) {
      S.speed = constrain(S.speed + 10, 0, 500); // Extended range beyond UI limits
      updateUIElement('speed', S.speed);
    }
    
    // D-pad Down (button 13): Decrease animation speed
    if (gamepadButtons[13] && gamepadButtons[13].pressed && !lastButtonStates[13]) {
      S.speed = constrain(S.speed - 10, 0, 500); // Extended range beyond UI limits
      updateUIElement('speed', S.speed);
    }
    
    // D-pad Left (button 14): Decrease text size
    if (gamepadButtons[14] && gamepadButtons[14].pressed && !lastButtonStates[14]) {
      S.fontSize = constrain(S.fontSize - 5, 5, 200); // Extended range beyond UI limits
      updateUIElement('fontSize', S.fontSize);
    }
    
    // D-pad Right (button 15): Increase text size
    if (gamepadButtons[15] && gamepadButtons[15].pressed && !lastButtonStates[15]) {
      S.fontSize = constrain(S.fontSize + 5, 5, 200); // Extended range beyond UI limits
      updateUIElement('fontSize', S.fontSize);
    }
    
    // X button (button 0): Toggle animation
    if (gamepadButtons[0] && gamepadButtons[0].pressed && !lastButtonStates[0]) {
      S.playing = !S.playing;
      updateUIElement('playing', S.playing);
    }
    
    // Square button (button 2): Decrease stroke width
    if (gamepadButtons[2] && gamepadButtons[2].pressed && !lastButtonStates[2]) {
      S.lw = constrain(S.lw - 1, 0.5, 50); // Extended range beyond UI limits
      updateUIElement('lw', S.lw);
    }
    
    // Triangle button (button 3): Increase stroke width
    if (gamepadButtons[3] && gamepadButtons[3].pressed && !lastButtonStates[3]) {
      S.lw = constrain(S.lw + 1, 0.5, 50); // Extended range beyond UI limits
      updateUIElement('lw', S.lw);
    }
    
    // Options button (button 9): Toggle UI visibility
    if (gamepadButtons[9] && gamepadButtons[9].pressed && !lastButtonStates[9]) {
      // Trigger hamburger button click
      const hamburgerBtn = document.getElementById('hamburgerBtn');
      if (hamburgerBtn) {
        hamburgerBtn.click();
      }
    }
    
    // Share button (button 8): hold 1s to start SVG recording, tap to stop or run export actions
    const shareBtn = gamepadButtons[8];
    if (shareBtn) {
      // Pressed (edge) -> start hold timer
      if (shareBtn.pressed && !lastButtonStates[8]) {
        // start hold timer: schedule a toggle (start if not recording, stop if recording)
        if (_shareHoldTimer) clearTimeout(_shareHoldTimer);
        _shareHoldActive = false;
        _shareHoldStartedAt = Date.now();
        _shareHoldTimer = setTimeout(() => {
          _shareHoldActive = true;
          // Clear any pending tap/multi-press state so the hold isn't treated as a tap
          _sharePressCount = 0;
          if (_sharePressTimer) { clearTimeout(_sharePressTimer); _sharePressTimer = null; }
          if (!_svgRecording) startSVGRecording(); else stopSVGRecording();
        }, _shareHoldThreshold);
      }
        // Released (edge) -> clear hold timer and interpret action
        if (!shareBtn.pressed && lastButtonStates[8]) {
          if (_shareHoldTimer) { clearTimeout(_shareHoldTimer); _shareHoldTimer = null; }
          const holdDuration = Date.now() - (_shareHoldStartedAt || 0);
          // If the press was long enough to be considered a hold (>= threshold), the hold callback already toggled recording.
          if (holdDuration >= _shareHoldThreshold) {
            // ensure we clear active flag and don't treat as tap
            _shareHoldActive = false;
            _sharePressCount = 0;
            if (_sharePressTimer) { clearTimeout(_sharePressTimer); _sharePressTimer = null; }
          } else {
            // Short press path: only treat as tap if it's shorter than the tap max
            const _shareTapMax = 250; // ms
            if (holdDuration <= _shareTapMax) {
              // Valid tap: use existing multi-press behavior
              _sharePressCount++;
              if (_isRecording && _sharePressCount >= 2) {
                stopRecording();
                _sharePressCount = 0;
                if (_sharePressTimer) { clearTimeout(_sharePressTimer); _sharePressTimer = null; }
              } else {
                handleSharePressAction();
              }
            } else {
              // mid-length press: ignore as neither tap nor completed hold
              _sharePressCount = 0;
              if (_sharePressTimer) { clearTimeout(_sharePressTimer); _sharePressTimer = null; }
            }
          }
        }
    }
    
    // R3 button (button 11): single-tap toggles grid, double-tap toggles orbit path
    if (gamepadButtons[11] && gamepadButtons[11].pressed && !lastButtonStates[11]) {
      _r3PressCount++;
      // If this is the first press, start a short timer to detect double-tap
      if (_r3PressCount === 1) {
        _r3PressTimer = setTimeout(() => {
          // Single tap action (grid toggle)
          S.showGrid = !S.showGrid;
          updateUIElement('showGrid', S.showGrid);
          _r3PressCount = 0;
          _r3PressTimer = null;
        }, 300); // 300ms window for double-tap
      } else if (_r3PressCount === 2) {
        // Double tap detected within 300ms: cancel single-tap and do orbit toggle
        if (_r3PressTimer) { clearTimeout(_r3PressTimer); _r3PressTimer = null; }
        S.showOrbitPath = !S.showOrbitPath;
        try { const chk = document.getElementById('toggleOrbitPathChk'); if (chk) chk.checked = !!S.showOrbitPath; } catch(e){}
        _r3PressCount = 0;
      }
    }
    
    // L3 button (button 10): Toggle debug mode
    if (gamepadButtons[10] && gamepadButtons[10].pressed && !lastButtonStates[10]) {
      S.debug = !S.debug;
      updateUIElement('debug', S.debug);
    }

    // L2 (button 6): control orbital eccentricity (make orbit oval) while held
    // R2 (button 7): control path height scale (adjust ellipse height) while held
    try {
      const l2 = gamepadButtons[6] ? (gamepadButtons[6].value !== undefined ? gamepadButtons[6].value : (gamepadButtons[6].pressed ? 1 : 0)) : 0;
      const r2 = gamepadButtons[7] ? (gamepadButtons[7].value !== undefined ? gamepadButtons[7].value : (gamepadButtons[7].pressed ? 1 : 0)) : 0;
      const DEAD = 0.02; // small deadzone to suppress noise
      // Continuous change while held: scale per-frame by trigger value
      if (l2 > DEAD) {
        // L2 increases horizontal scale; to preserve area, set scaleY = 1/scaleX
        const delta = l2 * 0.006; // small per-frame change
        S.scaleX = constrain(S.scaleX + delta, 0.3, 3.0);
        S.scaleY = constrain(1 / S.scaleX, 0.333, 3.0);
        try { updateUIElement('scaleX', S.scaleX); updateUIElement('scaleY', S.scaleY); } catch(e){}
      }
      if (r2 > DEAD) {
        // R2 increases vertical scale; preserve area by adjusting scaleX
        const delta = r2 * 0.006;
        S.scaleY = constrain(S.scaleY + delta, 0.3, 3.0);
        S.scaleX = constrain(1 / S.scaleY, 0.333, 3.0);
        try { updateUIElement('scaleX', S.scaleX); updateUIElement('scaleY', S.scaleY); } catch(e){}
      }
      // Keep last trigger values for compatibility/noise handling elsewhere
      lastTriggerValues.l2 = l2;
      lastTriggerValues.r2 = r2;
    } catch (e) {
      // ignore gamepad read errors
    }

  // Note: touchpad no longer toggles orbit path; R3 double-tap used instead.
}

function updateUIElement(elementId, value) {
  // Update both slider and number input if they exist
  let slider = select(`#${elementId}`);
  let numberInput = select(`#${elementId}Num`);
  
  if (slider) slider.value(value);
  if (numberInput) numberInput.value(value);
  // If the element is a checkbox, set its checked state
  let checkbox = select(`#${elementId}`);
  if (checkbox && checkbox.elt && checkbox.elt.type === 'checkbox') {
    checkbox.elt.checked = !!value;
  }
}

// Color menu functions
function toggleColorMenu() {
  const colorMenu = document.getElementById('colorMenu');
  colorMenuVisible = !colorMenuVisible;
  
  if (colorMenuVisible) {
    colorMenu.style.display = 'flex';
    menuState = 'main';
    menuIndex = 0;
    updateColorMenuDisplay();
    syncSlidersWithColors();
  } else {
    colorMenu.style.display = 'none';
  }
}

function selectMainMenuOption() {
  const selectedOption = mainMenuOptions[menuIndex];
  
  if (selectedOption === 'reset') {
    resetColors();
  } else {
    currentColorType = selectedOption;
    menuState = 'editing';
    rgbComponentIndex = 0;
    updateColorMenuDisplay();
  }
}

function resetColors() {
  colors.background = {...defaultColors.background};
  colors.foreground = {...defaultColors.foreground};
  syncSlidersWithColors();
  applyColors();
}

function updateColorMenuDisplay() {
  // Remove all active states
  document.querySelectorAll('.color-item').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.rgb-slider input').forEach(slider => {
    slider.classList.remove('selected');
    slider.style.background = '';
  });
  document.querySelectorAll('.rgb-slider').forEach(slider => {
    slider.classList.remove('selected', 'inactive');
  });
  document.querySelectorAll('.menu-option').forEach(option => option.classList.remove('active'));
  
  if (menuState === 'main') {
    // Highlight main menu options
    const colorItems = document.querySelectorAll('.color-item');
    const resetOption = document.getElementById('resetOption');
    
    if (menuIndex === 0 && colorItems[0]) colorItems[0].classList.add('active');
    if (menuIndex === 1 && colorItems[1]) colorItems[1].classList.add('active');
    if (menuIndex === 2 && resetOption) {
      resetOption.classList.add('active');
      try { resetOption.focus(); } catch(e){}
    } else if (resetOption) {
      resetOption.classList.remove('active');
      try { resetOption.blur(); } catch(e){}
    }
    
  } else if (menuState === 'editing') {
    // Highlight selected color category and RGB component
    const colorItems = document.querySelectorAll('.color-item');
    const targetIndex = currentColorType === 'background' ? 0 : 1;
    
    if (colorItems[targetIndex]) {
      colorItems[targetIndex].classList.add('active');
      
      const rgbSliders = colorItems[targetIndex].querySelectorAll('.rgb-slider');
      rgbSliders.forEach((slider, index) => {
        if (index === rgbComponentIndex) {
          slider.classList.add('selected');
          const input = slider.querySelector('input');
          if (input) input.classList.add('selected');
        } else {
          slider.classList.add('inactive');
        }
      });
    }
  }
  
  // Update color previews
  updateColorPreviews();
}

function updateColorPreviews() {
  const bgPreview = document.getElementById('backgroundPreview');
  const fgPreview = document.getElementById('foregroundPreview');
  
  if (bgPreview) {
    const bg = colors.background;
    bgPreview.style.backgroundColor = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
  }
  if (fgPreview) {
    const fg = colors.foreground;
    fgPreview.style.backgroundColor = `rgb(${fg.r}, ${fg.g}, ${fg.b})`;
  }
}

function syncSlidersWithColors() {
  // Background sliders
  const bgR = document.getElementById('backgroundR');
  const bgG = document.getElementById('backgroundG');
  const bgB = document.getElementById('backgroundB');
  
  if (bgR) bgR.value = colors.background.r;
  if (bgG) bgG.value = colors.background.g;
  if (bgB) bgB.value = colors.background.b;
  
  // Update value displays
  const bgValueElements = document.querySelectorAll('#colorMenu .color-item[data-type="background"] .value');
  if (bgValueElements[0]) bgValueElements[0].textContent = colors.background.r;
  if (bgValueElements[1]) bgValueElements[1].textContent = colors.background.g;
  if (bgValueElements[2]) bgValueElements[2].textContent = colors.background.b;
  
  // Foreground sliders
  const fgR = document.getElementById('foregroundR');
  const fgG = document.getElementById('foregroundG');
  const fgB = document.getElementById('foregroundB');
  
  if (fgR) fgR.value = colors.foreground.r;
  if (fgG) fgG.value = colors.foreground.g;
  if (fgB) fgB.value = colors.foreground.b;
  
  // Update value displays
  const fgValueElements = document.querySelectorAll('#colorMenu .color-item[data-type="foreground"] .value');
  if (fgValueElements[0]) fgValueElements[0].textContent = colors.foreground.r;
  if (fgValueElements[1]) fgValueElements[1].textContent = colors.foreground.g;
  if (fgValueElements[2]) fgValueElements[2].textContent = colors.foreground.b;
  
  updateColorPreviews();
}

function adjustRGBValue(delta) {
  console.log(`ADJUST-RGB: delta=${delta}, currentColorType="${currentColorType}", rgbComponentIndex=${rgbComponentIndex}`);
  if (!currentColorType) {
    console.log(`ADJUST-RGB: currentColorType is empty, returning`);
    return;
  }
  
  const components = ['r', 'g', 'b'];
  const component = components[rgbComponentIndex];
  const oldValue = colors[currentColorType][component];
  
  // Adjust the value
  colors[currentColorType][component] = Math.max(0, Math.min(255, colors[currentColorType][component] + delta));
  const newValue = colors[currentColorType][component];
  
  console.log(`ADJUST-RGB: ${currentColorType}.${component}: ${oldValue} -> ${newValue}`);
  
  // Update sliders and display
  syncSlidersWithColors();
  applyColors();
}

function applyColors() {
  // Update canvas background
  const bg = colors.background;
  const canvas = document.querySelector('canvas');
  if (canvas) {
    canvas.style.backgroundColor = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
  }
  
  // Update global color variables for drawing
  const fg = colors.foreground;
  COL.cyan = `rgb(${fg.r}, ${fg.g}, ${fg.b})`;
}

function setupColorSliders() {
  // Background sliders
  ['R', 'G', 'B'].forEach((component, index) => {
    const slider = document.getElementById(`background${component}`);
    const valueDisplay = document.querySelector(`#colorMenu .color-item[data-type="background"] .rgb-slider:nth-child(${index + 1}) .value`);
    
    if (slider) {
      slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        colors.background[component.toLowerCase()] = value;
        if (valueDisplay) valueDisplay.textContent = value;
        updateColorPreviews();
        applyColors();
      });
    }
  });
  
  // Foreground sliders  
  ['R', 'G', 'B'].forEach((component, index) => {
    const slider = document.getElementById(`foreground${component}`);
    const valueDisplay = document.querySelector(`#colorMenu .color-item[data-type="foreground"] .rgb-slider:nth-child(${index + 1}) .value`);
    
    if (slider) {
      slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        colors.foreground[component.toLowerCase()] = value;
        if (valueDisplay) valueDisplay.textContent = value;
        updateColorPreviews();
        applyColors();
      });
    }
  });
}

function setupUI() {
  const link = (a, b) => {
    let elementA = select(`#${a}`);
    let elementB = select(`#${b}`);
    if (elementA) {
      elementA.input(() => {
        if (elementB) elementB.value(elementA.value());
        applySettings();
      });
    }
    if (elementB) {
      elementB.input(() => {
        if (elementA) elementA.value(elementB.value());
        applySettings();
      });
    }
  };
  
  link("theta", "thetaNum");
  link("R", "Rnum");
  link("rc", "rcNum");
  link("lw", "lwNum");
  link("speed", "speedNum");
  link("gridScale", "gridScaleNum");
  link("masterScale", "masterScaleNum");
  link("gridWidth", "gridWidthNum");
  link("gridHeight", "gridHeightNum");
  link("fontSize", "fontSizeNum");
  link("lineHeight", "lineHeightNum");
  link("textPadding", "textPaddingNum");
  
  let gridCheckbox = select("#grid");
  if (gridCheckbox) {
    gridCheckbox.changed(() => {
      S.showGrid = gridCheckbox.checked();
    });
  }
  
  let debugCheckbox = select("#debug");
  if (debugCheckbox) {
    debugCheckbox.changed(() => {
      S.debug = debugCheckbox.checked();
    });
  }

  // Show/hide foreground elements checkbox
  let showFgCheckbox = select("#showForeground");
  if (showFgCheckbox) {
    showFgCheckbox.changed(() => {
      S.showForeground = showFgCheckbox.checked();
    });
  }
  
  const updatePlayBtn = () => {
    let b = select("#playBtn");
    if (b) b.html(S.playing ? "⏸︎ Pauze" : "▶︎ Animatie");
  };
  
  let playBtn = select("#playBtn");
  if (playBtn) {
    playBtn.mousePressed(() => {
      S.playing = !S.playing;
      updatePlayBtn();
      if (S.playing) {
        S.lastT = null;
      }
    });
  }
  
  let resetBtn = select("#reset");
  if (resetBtn) {
    resetBtn.mousePressed(() => {
      Object.assign(S, {
        thetaDeg: 0,
        R: 270,
        rc: 60,
        lw: 13,
        showGrid: true,
        debug: false,
        zone: null,
        spinDeg: 0,
        thetaPrevDeg: 0,
        dir: 0,
        t1: 5,
        t2: 4,
        p1yPrev: null,
        p2yPrev: null,
        p1Prev: null,
        p2Prev: null,
        playing: false,
        speed: 60,
        lastT: null,
        maxStepDeg: 1,
        gridScale: 100,
        gridWidth: 1.0,
        gridHeight: 1.0,
        showText: true,
        textContent: "HOUSE\nOF\nORBIT",
        fontSize: 45,
        lineHeight: 0.9,
        textPadding: 20,
      });
      
      ["theta", "R", "rc", "lw", "speed", "gridScale", "masterScale", "gridWidth", "gridHeight", "fontSize", "lineHeight", "textPadding"].forEach((id) => {
        const base = { theta: 0, R: 270, rc: 60, lw: 13, speed: 60, gridScale: 100, masterScale: 100, gridWidth: 1.0, gridHeight: 1.0, fontSize: 45, lineHeight: 0.9, textPadding: 20 };
        const d = base[id === "theta" ? "theta" : id];
        let elem = select(`#${id}`);
        let elemNum = select(`#${id}Num`);
        if (elem) elem.value(d);
        if (elemNum) elemNum.value(d);
      });
      
      if (gridCheckbox) gridCheckbox.checked(true);
      if (debugCheckbox) debugCheckbox.checked(false);
      updatePlayBtn();
    });
  }
  
  // Export button event listeners
  let exportSVGBtn = select("#svgBtn");
  if (exportSVGBtn) {
    exportSVGBtn.mousePressed(() => {
      exportAsSVG();
    });
  }
  
  let exportPNGBtn = select("#saveBtn");
  if (exportPNGBtn) {
    exportPNGBtn.mousePressed(() => {
      exportAsPNG();
    });
  }
  
  // Color button event listener
  let colorBtn = select("#colorBtn");
  if (colorBtn) {
    colorBtn.mousePressed(() => {
      toggleColorMenu();
    });
  }

  // Record/Export button
  let recordBtn = select('#recordBtn');
  if (recordBtn) {
    recordBtn.mousePressed(() => {
      // default: 180s (3 minutes) recording at 60fps — prevents short accidental auto-stops
      toggleRecording(180, 60);
    });
  }
  
  updatePlayBtn();
  // Initialize showForeground checkbox state
  let initShowFg = select('#showForeground');
  if (initShowFg && initShowFg.elt) initShowFg.elt.checked = !!S.showForeground;
}

function applySettings() {
  let theta = select("#theta");
  let R = select("#R");
  let rc = select("#rc");
  let lw = select("#lw");
  let speed = select("#speed");
  let gridScale = select("#gridScale");
  let masterScale = select("#masterScale");
  let gridWidth = select("#gridWidth");
  let gridHeight = select("#gridHeight");
  let fontSize = select("#fontSize");
  let lineHeight = select("#lineHeight");
  let textPadding = select("#textPadding");
  let showText = select("#showText");
  let textContent = select("#textContent");
  
  if (theta) S.thetaDeg = parseFloat(theta.value());
  if (R) S.R = parseFloat(R.value());
  if (rc) S.rc = parseFloat(rc.value());
  if (lw) S.lw = parseFloat(lw.value());
  if (speed) S.speed = parseFloat(speed.value());
  if (gridScale) S.gridScale = parseFloat(gridScale.value());
  if (masterScale) S.masterScale = parseFloat(masterScale.value());
  if (gridWidth) S.gridWidth = parseFloat(gridWidth.value());
  if (gridHeight) S.gridHeight = parseFloat(gridHeight.value());
  if (fontSize) S.fontSize = parseFloat(fontSize.value());
  if (lineHeight) S.lineHeight = parseFloat(lineHeight.value());
  if (textPadding) S.textPadding = parseFloat(textPadding.value());
  if (showText) S.showText = showText.checked();
  if (textContent) S.textContent = textContent.value();
}

function wrapDeg(a) {
  return ((a % 360) + 360) % 360;
}

// Helper function to get master-scaled values
function getMasterScaleFactor() {
  return S.masterScale / 100;
}

function getScaledValue(originalValue) {
  return originalValue * getMasterScaleFactor();
}

function getGridArea(canvasX, canvasY, canvasW, canvasH) {
  // Calculate base size to fit screen - use smaller dimension to ensure it fits
  const screenFitSize = min(canvasW, canvasH) * 0.8; // 80% of smaller dimension for some padding
  
  // Apply percentage-based scaling (gridScale is in %)
  const baseSize = screenFitSize * (S.gridScale / 100);
  
  // Calculate grid dimensions based on scaling factors
  const gridW = baseSize * S.gridWidth;
  const gridH = baseSize * S.gridHeight;
  
  // Center the grid in the available canvas area
  const gridX = canvasX + (canvasW - gridW) / 2;
  const gridY = canvasY + (canvasH - gridH) / 2;
  
  return { x: gridX, y: gridY, w: gridW, h: gridH };
}

function housePoly(gridX, gridY, gridW, gridH) {
  // House uses the full grid dimensions (no separate scaling)
  const baseW = gridW;
  const baseH = gridH;
  
  // No offset needed - house fills the grid area
  const houseX = gridX;
  const houseY = gridY;
  
  const t = (fx, fy) => ({ x: houseX + fx * baseW, y: houseY + fy * baseH });
  return [
    t(1 / 3, 1 / 2),
    t(1 / 3, 1 / 3),
    t(1 / 2, 1 / 4),
    t(2 / 3, 1 / 3),
    t(2 / 3, 1 / 2),
  ];
}

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

function drawGrid(x, y, w, h) {
  if (!S.showGrid) return;
  
  const x0 = x, y0 = y, x1 = x + w, y1 = y + h;
  const vx1 = x + w / 3, vx2 = x + (2 * w) / 3, my = y + h / 2;
  
  // Grid is always light blue with thinner lines
  stroke(COL.cyan);
  strokeWeight(1);
  strokeCap(ROUND);   // Add rounded line ends
  strokeJoin(ROUND);  // Add rounded corners
  noFill();
  
  // Outer rectangle
  rect(x0, y0, w, h);
  
  // Vertical lines
  line(vx1, y0, vx1, y1);
  line(vx2, y0, vx2, y1);
  
  // Horizontal line
  line(x0, my, x1, my);
  
  // Diagonal lines
  line(x0, my, x1, y0);
  line(x0, y0, x1, my);
  
  if (S.debug) {
    textAlign(CENTER, TOP);
    textSize(12);
    textStyle(BOLD);
    
    const vxs = [x0, vx1, vx2, x1];
    for (let i = 0; i < vxs.length; i++) {
      const lx = vxs[i];
      const ly = y0 + 4;
      const label = `GV${i + 1}`;
      
      fill(255);
      stroke(255);
      strokeWeight(3);
      text(label, lx, ly);
      
      fill(COL.cyan);
      noStroke();
      text(label, lx, ly);
    }
    
    textAlign(LEFT, CENTER);
    const hys = [y0, my, y1];
    for (let i = 0; i < hys.length; i++) {
      const ly = hys[i];
      const lx = x0 + 6;
      const label = `GH${i + 1}`;
      
      fill(255);
      stroke(255);
      strokeWeight(3);
      text(label, lx, ly);
      
      fill(COL.cyan);
      noStroke();
      text(label, lx, ly);
    }
    
    textAlign(CENTER, BASELINE);
    const gd1 = { x: x0 + 0.35 * (x1 - x0), y: my + 0.35 * (y0 - my) };
    const gd2 = { x: x0 + 0.65 * (x1 - x0), y: y0 + 0.65 * (my - y0) };
    
    fill(255);
    stroke(255);
    strokeWeight(3);
    text("GD1", gd1.x, gd1.y);
    text("GD2", gd2.x, gd2.y);
    
    fill(COL.cyan);
    noStroke();
    text("GD1", gd1.x, gd1.y);
    text("GD2", gd2.x, gd2.y);
  }
}

const houseToIdx = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 0 };
const getHousePoint = (h, poly) => poly[houseToIdx[h]];

function zoneKey(C, x, y, w, h) {
  const cw = w / 3, ch = h / 2;
  let col = Math.floor((C.x - x) / cw);
  col = Math.max(0, Math.min(2, col));
  let row = Math.floor((C.y - y) / ch);
  row = Math.max(0, Math.min(1, row));
  const A = { x: x, y: y + h / 2 }, B = { x: x + w, y: y };
  const sideV = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
  const above = sideV < 0 ? "A" : "B";
  const cCode = col === 0 ? "L" : col === 1 ? "M" : "R";
  const rCode = row === 0 ? "T" : "B";
  return `${rCode}${cCode}_${above}`;
}

function tangentPointsFrom(C, r, V) {
  const dx = V.x - C.x, dy = V.y - C.y, d = Math.hypot(dx, dy);
  if (d <= r + EPS) return null;
  const base = Math.atan2(dy, dx), delta = Math.acos(Math.max(-1, Math.min(1, r / d)));
  const a1 = base + delta, a2 = base - delta;
  return [
    { x: C.x + r * Math.cos(a1), y: C.y + r * Math.sin(a1), ang: a1 },
    { x: C.x + r * Math.cos(a2), y: C.y + r * Math.sin(a2), ang: a2 },
  ];
}

function nearVertical(a, b, xv, tol) {
  return Math.abs(a.x - xv) <= tol && Math.abs(b.x - xv) <= tol;
}

function nearHorizontal(a, b, yv, tol) {
  return Math.abs(a.y - yv) <= tol && Math.abs(b.y - yv) <= tol;
}

function distPointToLine(p, l1, l2) {
  const A = l2.y - l1.y, B = l1.x - l2.x, C = l2.x * l1.y - l1.x * l2.y;
  return Math.abs(A * p.x + B * p.y + C) / Math.hypot(A, B);
}

function nearDiagonal(a, b, l1, l2, tol) {
  const d1 = distPointToLine(a, l1, l2), d2 = distPointToLine(b, l1, l2);
  return Math.max(d1, d2) <= tol;
}

function side(p, l1, l2) {
  return (l2.x - l1.x) * (p.y - l1.y) - (l2.y - l1.y) * (p.x - l1.x);
}

function clipToCircle(C, V, r) {
  const dx = V.x - C.x, dy = V.y - C.y, L = Math.hypot(dx, dy) || 1;
  return { x: C.x + (dx * r) / L, y: C.y + (dy * r) / L };
}

function chooseTangents(C, r, v1, v2, prev1, prev2) {
  const t1s = tangentPointsFrom(C, r, v1), t2s = tangentPointsFrom(C, r, v2);
  if (!t1s || !t2s) return [clipToCircle(C, v1, r), clipToCircle(C, v2, r)];
  const cross = (A, B) => (A.x - C.x) * (B.y - C.y) - (A.y - C.y) * (B.x - C.x);
  function pick(ts, V, targetSign, prev) {
    const s0 = Math.sign(cross(V, ts[0])), s1 = Math.sign(cross(V, ts[1]));
    let pick = null;
    if (s0 === targetSign && s1 !== targetSign) pick = ts[0];
    else if (s1 === targetSign && s0 !== targetSign) pick = ts[1];
    else if (prev) {
      const d0 = (ts[0].x - prev.x) ** 2 + (ts[0].y - prev.y) ** 2;
      const d1 = (ts[1].x - prev.x) ** 2 + (ts[1].y - prev.y) ** 2;
      pick = d0 <= d1 ? ts[0] : ts[1];
    } else {
      pick = targetSign * (s0 || 0) >= targetSign * (s1 || 0) ? ts[0] : ts[1];
    }
    return { x: pick.x, y: pick.y };
  }
  const T1 = pick(t1s, v1, -1, prev1);
  const T2 = pick(t2s, v2, +1, prev2);
  return [T1, T2];
}

function wrapPi(a) {
  let t = (a + Math.PI) % (2 * Math.PI);
  if (t < 0) t += 2 * Math.PI;
  return t - Math.PI;
}

function angDiffParallel(a, b) {
  let d = Math.abs(wrapPi(a - b));
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

function alignedType(angle, w, h) {
  const tol = 0.03;
  const phi = Math.atan2(h / 2, w);
  if (angDiffParallel(angle, 0) <= tol) return "GH";
  if (angDiffParallel(angle, Math.PI / 2) <= tol) return "GV";
  if (angDiffParallel(angle, -phi) <= tol) return "GD1";
  if (angDiffParallel(angle, phi) <= tol) return "GD2";
  return null;
}

function drawText(gridX, gridY, gridW, gridH, masterScaleFactor = 1) {
  if (!S.showText) return;
  
  // Calculate the center grid position (middle third of the grid)
  // The grid is 3x2, so center grid is at (1/3, 0) to (2/3, 1/2)
  const centerGridX = gridX + gridW / 3;
  const centerGridY = gridY;
  const centerGridW = gridW / 3;
  const centerGridH = gridH / 2;
  
  // Split text into lines
  const lines = S.textContent.split('\n');
  
  // Apply master scaling to text properties
  const scaledFontSize = S.fontSize * masterScaleFactor;
  const scaledTextPadding = S.textPadding * masterScaleFactor;
  const lineHeight = scaledFontSize * S.lineHeight;
  
  // Calculate available space for text (grid minus scaled padding)
  const availableWidth = centerGridW - (scaledTextPadding * 2);
  const availableHeight = centerGridH - (scaledTextPadding * 2);
  
  // Calculate text dimensions to check if scaling is needed
  let actualFontSize = scaledFontSize;
  let actualLineHeight = lineHeight;
  
  // Use CSS-loaded font with verification
  push();
  
  // Check if CSS font is loaded using document.fonts API
  if (document.fonts && document.fonts.check) {
    const fontLoaded = document.fonts.check('bold 40px Nebulica-Bold');
    if (fontLoaded) {
      textFont('Nebulica-Bold');
    } else {
      // Force CSS font load and use fallback
      document.fonts.load('bold 40px Nebulica-Bold').then(() => {
        console.log('CSS Nebulica-Bold font loaded');
      });
      textFont('"Arial Black", Impact, "Helvetica Neue", Helvetica, Arial, sans-serif');
    }
  } else {
    // Fallback for browsers without font loading API
    textFont('Nebulica-Bold, "Arial Black", Impact, "Helvetica Neue", Helvetica, Arial, sans-serif');
  }
  
  // Set initial text properties for measurement
  textSize(actualFontSize);
  textStyle(BOLD);
  
  // Calculate total text height needed
  const totalTextHeight = lines.length * actualLineHeight;
  
  // Check if text fits within available space and scale down if needed
  let maxTextWidth = 0;
  for (let line of lines) {
    const lineWidth = textWidth(line);
    if (lineWidth > maxTextWidth) {
      maxTextWidth = lineWidth;
    }
  }
  
  // Calculate scaling factors if text is too large
  const widthScale = maxTextWidth > availableWidth ? availableWidth / maxTextWidth : 1;
  const heightScale = totalTextHeight > availableHeight ? availableHeight / totalTextHeight : 1;
  
  // Use the smaller scale factor to ensure text fits in both dimensions
  const textScale = Math.min(widthScale, heightScale);
  
  // Apply scaling if needed
  if (textScale < 1) {
    actualFontSize = scaledFontSize * textScale;
    actualLineHeight = actualFontSize * S.lineHeight;
    textSize(actualFontSize);
  }
  
  // Calculate position - align text to bottom-left of center grid with proper padding
  const textX = centerGridX + scaledTextPadding;
  
  // Position text at the very bottom of the center grid
  // When padding is 0, text should touch the bottom edge
  const textBottomY = centerGridY + centerGridH - scaledTextPadding;
  
  const fg = colors.foreground;
  fill(`rgb(${fg.r}, ${fg.g}, ${fg.b})`); // Use dynamic foreground color for text
  noStroke();
  textAlign(LEFT, BASELINE); // Use BASELINE for more precise bottom alignment
  
  // Draw each line from bottom up
  for (let i = 0; i < lines.length; i++) {
    // Calculate Y position for each line, starting from bottom
    // The last line (i = lines.length - 1) should be at textBottomY
    const lineY = textBottomY - (lines.length - 1 - i) * actualLineHeight;
    text(lines[i], textX, lineY);
  }
  
  pop();
  
  // Debug: Draw center grid boundaries in debug mode
  if (S.debug) {
    push();
    stroke(255, 0, 0); // Red color for debug
    strokeWeight(2);
    noFill();
    rect(centerGridX, centerGridY, centerGridW, centerGridH);
    
    // Draw available text area
    stroke(0, 255, 0); // Green for text area
    strokeWeight(1);
    rect(centerGridX + scaledTextPadding, centerGridY + scaledTextPadding, 
         availableWidth, availableHeight);
    pop();
  }
}

function drawScene() {
  // Apply dynamic background color
  const bg = colors.background;
  background(`rgb(${bg.r}, ${bg.g}, ${bg.b})`);
  
  // Debug: log once to verify drawScene is being called
  if (frameCount === 1) {
    console.log("DrawScene called, canvas dimensions:", width, height);
  }
  
  const pad = 24;
  const vpw = width, vph = height;
  if (vpw <= 2 * pad || vph <= 2 * pad) {
    console.log("Canvas too small, skipping full draw");
    return;
  }
  
  const canvasArea = { x: pad, y: pad, w: vpw - 2 * pad, h: vph - 2 * pad };
  const grid = getGridArea(canvasArea.x, canvasArea.y, canvasArea.w, canvasArea.h);
  
  // Apply master scaling to all size-related properties
  const masterScaleFactor = S.masterScale / 100;
  const scaledR = S.R * masterScaleFactor;
  const scaledRc = S.rc * masterScaleFactor;
  const scaledLw = S.lw * masterScaleFactor;
  const hit = Math.max(2, 1 + scaledLw * 0.5);
  
  // Debug: log drawing area
  if (frameCount === 1) {
    console.log("Canvas area:", canvasArea);
    console.log("Grid area:", grid);
  }
  
  drawGrid(grid.x, grid.y, grid.w, grid.h);

  const poly = housePoly(grid.x, grid.y, grid.w, grid.h);
  
  // Draw house polygon
  const fg = colors.foreground;
  if (S.showForeground) {
    stroke(S.debug ? COL.cyan : `rgb(${fg.r}, ${fg.g}, ${fg.b})`); // Use dynamic foreground color in normal mode
    strokeWeight(scaledLw);
    strokeJoin(ROUND); // Add rounded corners
    strokeCap(ROUND);  // Add rounded line ends
    noFill();
    beginShape();
    for (let i = 0; i < poly.length; i++) {
      vertex(poly[i].x, poly[i].y);
    }
    endShape(CLOSE);

    // Draw text in the house area with master scaling applied
    drawText(grid.x, grid.y, grid.w, grid.h, masterScaleFactor);
  }

  const H = centroid(poly);
  const ang = (S.thetaDeg * Math.PI) / 180 + Math.PI / 2;
  // Use axis scale multipliers; preserve apparent 'area' by keeping scaleX*scaleY ~= 1
  const sx = S.scaleX || 1;
  const sy = S.scaleY || 1;
  const C = { x: H.x + scaledR * Math.cos(ang) * sx, y: H.y + scaledR * Math.sin(ang) * sy };

  // Optionally draw the orbital path as an ellipse centered on H
  if (S.showOrbitPath) {
    push();
    noFill();
    stroke(COL.cyan);
    strokeWeight(1);
  // ellipseMode(CENTER) is default; compute rx/ry separately so combining eccX/eccY can return to a circle
  const rx = 2 * scaledR * sx; // width
  const ry = 2 * scaledR * sy * (S.pathHeightScale || 1); // height
  ellipse(H.x, H.y, rx, ry);
    pop();
  }

  const angToHouse = (Math.atan2(H.y - C.y, H.x - C.x) * 180) / Math.PI;
  S.spinDeg = wrapDeg(angToHouse + 90);
  const dth = ((S.thetaDeg - S.thetaPrevDeg + 540) % 360) - 180;
  if (Math.abs(dth) > 0.001) S.dir = dth > 0 ? 1 : -1;
  S.thetaPrevDeg = S.thetaDeg;

  const gv2 = grid.x + grid.w / 3, gv3 = grid.x + (2 * grid.w) / 3, gh2 = grid.y + grid.h / 2;
  const GD1a = { x: grid.x, y: grid.y + grid.h / 2 }, GD1b = { x: grid.x + grid.w, y: grid.y };
  const GD2a = { x: grid.x, y: grid.y }, GD2b = { x: grid.x + grid.w, y: grid.y + grid.h / 2 };
  const th = ((S.thetaDeg % 360) + 360) % 360;
  if (th < 0.5 || th > 359.5) {
    S.t1 = 5;
    S.t2 = 4;
  }

  const key = zoneKey(C, grid.x, grid.y, grid.w, grid.h);
  S.zone = key;
  let zoneElement = select("#zone");
  if (zoneElement) zoneElement.value(key);

  let a1 = getHousePoint(S.t1, poly);
  let a2 = getHousePoint(S.t2, poly);
  let [p1, p2] = chooseTangents(C, scaledRc, a1, a2, S.p1Prev, S.p2Prev);

  const angT1 = Math.atan2(a1.y - p1.y, a1.x - p1.x);
  let al1 = alignedType(angT1, grid.w, grid.h);
  const onGV2 = () => nearVertical(p1, a1, gv2, hit);
  const onGV3 = () => nearVertical(p1, a1, gv3, hit);
  const onGH2 = () => nearHorizontal(p1, a1, gh2, hit);
  const onGD1 = () => nearDiagonal(p1, a1, GD1a, GD1b, hit);
  const onGD2 = () => nearDiagonal(p1, a1, GD2a, GD2b, hit);

  const angT2 = Math.atan2(a2.y - p2.y, a2.x - p2.x);
  let al2 = alignedType(angT2, grid.w, grid.h);
  const onGV2_2 = () => nearVertical(p2, a2, gv2, hit);
  const onGV3_2 = () => nearVertical(p2, a2, gv3, hit);
  const onGH2_2 = () => nearHorizontal(p2, a2, gh2, hit);
  const onGD1_2 = () => nearDiagonal(p2, a2, GD1a, GD1b, hit);
  const onGD2_2 = () => nearDiagonal(p2, a2, GD2a, GD2b, hit);

  let nextT1 = S.t1;
  const crossGV2_1 = S.p1Prev ? (S.p1Prev.x - gv2) * (p1.x - gv2) <= 0 : false;
  const crossGV3_1 = S.p1Prev ? (S.p1Prev.x - gv3) * (p1.x - gv3) <= 0 : false;
  const crossGH2_1 = S.p1Prev ? (S.p1Prev.y - gh2) * (p1.y - gh2) <= 0 : false;
  const crossGD1_1 = S.p1Prev ? side(S.p1Prev, GD1a, GD1b) * side(p1, GD1a, GD1b) <= 0 : false;
  const crossGD2_1 = S.p1Prev ? side(S.p1Prev, GD2a, GD2b) * side(p1, GD2a, GD2b) <= 0 : false;
  
  if (S.dir > 0) {
    if (S.t1 === 5 && ((al1 === "GV" && onGV2()) || crossGV2_1)) nextT1 = 1;
    else if (S.t1 === 1 && ((al1 === "GD1" && onGD1()) || crossGD1_1)) nextT1 = 2;
    else if (S.t1 === 2 && ((al1 === "GD2" && onGD2()) || crossGD2_1)) nextT1 = 3;
    else if (S.t1 === 3 && ((al1 === "GV" && onGV3()) || crossGV3_1)) nextT1 = 4;
    else if (S.t1 === 4 && (onGH2() || crossGH2_1)) nextT1 = 5;
  } else if (S.dir < 0) {
    if (S.t1 === 1 && ((al1 === "GV" && onGV2()) || crossGV2_1)) nextT1 = 5;
    else if (S.t1 === 2 && ((al1 === "GD1" && onGD1()) || crossGD1_1)) nextT1 = 1;
    else if (S.t1 === 3 && ((al1 === "GD2" && onGD2()) || crossGD2_1)) nextT1 = 2;
    else if (S.t1 === 4 && ((al1 === "GV" && onGV3()) || crossGV3_1)) nextT1 = 3;
    else if (S.t1 === 5 && (onGH2() || crossGH2_1)) nextT1 = 4;
  }
  if (nextT1 !== S.t1) {
    S.t1 = nextT1;
    a1 = getHousePoint(S.t1, poly);
    [p1, p2] = chooseTangents(C, S.rc, a1, a2, S.p1Prev, S.p2Prev);
    al1 = alignedType(Math.atan2(a1.y - p1.y, a1.x - p1.x), grid.w, grid.h);
  }

  let nextT2 = S.t2;
  const crossGV2_2 = S.p2Prev ? (S.p2Prev.x - gv2) * (p2.x - gv2) <= 0 : false;
  const crossGV3_2 = S.p2Prev ? (S.p2Prev.x - gv3) * (p2.x - gv3) <= 0 : false;
  const crossGH2_2 = S.p2Prev ? (S.p2Prev.y - gh2) * (p2.y - gh2) <= 0 : false;
  const crossGD1_2 = S.p2Prev ? side(S.p2Prev, GD1a, GD1b) * side(p2, GD1a, GD1b) <= 0 : false;
  const crossGD2_2 = S.p2Prev ? side(S.p2Prev, GD2a, GD2b) * side(p2, GD2a, GD2b) <= 0 : false;
  
  if (S.dir > 0) {
    if (S.t2 === 4 && (onGH2_2() || crossGH2_2)) nextT2 = 5;
    else if (S.t2 === 5 && ((al2 === "GV" && onGV2_2()) || crossGV2_2)) nextT2 = 1;
    else if (S.t2 === 1 && ((al2 === "GD1" && onGD1_2()) || crossGD1_2)) nextT2 = 2;
    else if (S.t2 === 2 && ((al2 === "GD2" && onGD2_2()) || crossGD2_2)) nextT2 = 3;
    else if (S.t2 === 3 && ((al2 === "GV" && onGV3_2()) || crossGV3_2)) nextT2 = 4;
  } else if (S.dir < 0) {
    if (S.t2 === 5 && (onGH2_2() || crossGH2_2)) nextT2 = 4;
    else if (S.t2 === 1 && ((al2 === "GV" && onGV2_2()) || crossGV2_2)) nextT2 = 5;
    else if (S.t2 === 2 && ((al2 === "GD1" && onGD1_2()) || crossGD1_2)) nextT2 = 1;
    else if (S.t2 === 3 && ((al2 === "GD2" && onGD2_2()) || crossGD2_2)) nextT2 = 2;
    else if (S.t2 === 4 && ((al2 === "GV" && onGV3_2()) || crossGV3_2)) nextT2 = 3;
  }
  if (nextT2 !== S.t2) {
    S.t2 = nextT2;
    a2 = getHousePoint(S.t2, poly);
    [p1, p2] = chooseTangents(C, S.rc, a1, a2, S.p1Prev, S.p2Prev);
    al2 = alignedType(Math.atan2(a2.y - p2.y, a2.x - p2.x), grid.w, grid.h);
  }
  
  S.p1yPrev = p1.y;
  S.p2yPrev = p2.y;
  S.p1Prev = { x: p1.x, y: p1.y };
  S.p2Prev = { x: p2.x, y: p2.y };

  // Draw tangent lines
  strokeCap(ROUND);
  strokeWeight(getScaledValue(S.lw));
  if (S.showForeground) {
    // First tangent line - use dynamic color in normal mode
    stroke(S.debug ? COL.mag : `rgb(${fg.r}, ${fg.g}, ${fg.b})`);
    line(p1.x, p1.y, a1.x, a1.y);
    
    // Second tangent line - use dynamic color in normal mode
    stroke(S.debug ? COL.mag : `rgb(${fg.r}, ${fg.g}, ${fg.b})`);
    line(p2.x, p2.y, a2.x, a2.y);

    // Draw the moving circle - use dynamic color in normal mode
    stroke(S.debug ? 0 : `rgb(${fg.r}, ${fg.g}, ${fg.b})`);
    strokeWeight(getScaledValue(S.lw));
    noFill();
    circle(C.x, C.y, getScaledValue(S.rc) * 2);
  }

  if (S.debug) {
    const a = (S.spinDeg * Math.PI) / 180;
    const pA = { x: C.x + S.rc * Math.cos(a), y: C.y + S.rc * Math.sin(a) };
    const pB = { x: C.x - S.rc * Math.cos(a), y: C.y - S.rc * Math.sin(a) };
    
    stroke(COL.green);
    strokeWeight(3);
    line(pA.x, pA.y, pB.x, pB.y);
    
    const numMap = [5, 1, 2, 3, 4];
    for (let i = 0; i < poly.length; i++) {
      const hp = poly[i];
      
      fill(255);
      stroke(color(204, 0, 0));
      strokeWeight(2);
      circle(hp.x, hp.y, 8);
      
      const tx = hp.x + 8, ty = hp.y - 8;
      textAlign(LEFT, BASELINE);
      textSize(12);
      textStyle(BOLD);
      
      fill(255);
      stroke(255);
      strokeWeight(3);
      text(String(numMap[i]), tx, ty);
      
      fill(color(204, 0, 0));
      noStroke();
      text(String(numMap[i]), tx, ty);
    }
    
    const mid1 = { x: (p1.x + a1.x) / 2, y: (p1.y + a1.y) / 2 };
    const mid2 = { x: (p2.x + a2.x) / 2, y: (p2.y + a2.y) / 2 };
    
    textAlign(LEFT, CENTER);
    textSize(12);
    textStyle(BOLD);
    
    fill(255);
    stroke(255);
    strokeWeight(3);
    text("T1", mid1.x + 6, mid1.y);
    text("T2", mid2.x + 6, mid2.y);
    
    fill(COL.mag);
    noStroke();
    text("T1", mid1.x + 6, mid1.y);
    text("T2", mid2.x + 6, mid2.y);
  }
}

// Render the same scene into a provided p5.Graphics buffer (high-res export)
function drawSceneTo(gfx, targetW, targetH) {
  if (!gfx) return;
  // We will compute a uniform scale between the interactive canvas and the target buffer
  const srcW = width || (gfx.width || targetW);
  const srcH = height || (gfx.height || targetH);
  const scaleX = targetW / srcW;
  const scaleY = targetH / srcH;
  const scale = Math.min(scaleX, scaleY);

  // Prepare gfx
  try { gfx.push(); } catch(e){}
  try { gfx.clear(); } catch(e){}
  // Set pixel density 1 on gfx to avoid DPR artifacts
  try { gfx.pixelDensity(1); } catch(e){}

  // Use scaled coordinate space
  try { gfx.scale(scale); } catch(e){}

  // Temporarily swap drawing primitives: use gfx.* versions instead of global p5
  // Background
  const bg = colors.background;
  try { gfx.background(`rgb(${bg.r}, ${bg.g}, ${bg.b})`); } catch(e){}

  const pad = 24;
  const vpw = srcW, vph = srcH;
  if (vpw <= 2 * pad || vph <= 2 * pad) {
    try { gfx.pop(); } catch(e){}
    return;
  }

  const canvasArea = { x: pad, y: pad, w: vpw - 2 * pad, h: vph - 2 * pad };
  const grid = getGridArea(canvasArea.x, canvasArea.y, canvasArea.w, canvasArea.h);

  const masterScaleFactor = S.masterScale / 100;
  const scaledR = S.R * masterScaleFactor;
  const scaledRc = S.rc * masterScaleFactor;
  const scaledLw = S.lw * masterScaleFactor;

  // draw grid
  if (S.showGrid) {
    try {
      gfx.push();
      gfx.stroke(COL.cyan);
      gfx.strokeWeight(1);
      gfx.strokeCap(ROUND);
      gfx.strokeJoin(ROUND);
      gfx.noFill();
      gfx.rect(grid.x, grid.y, grid.w, grid.h);
      const vx1 = grid.x + grid.w / 3, vx2 = grid.x + (2 * grid.w) / 3, my = grid.y + grid.h / 2;
      gfx.line(vx1, grid.y, vx1, grid.y + grid.h);
      gfx.line(vx2, grid.y, vx2, grid.y + grid.h);
      gfx.line(grid.x, my, grid.x + grid.w, my);
      gfx.line(grid.x, my, grid.x + grid.w, grid.y);
      gfx.line(grid.x, grid.y, grid.x + grid.w, my);
      // Debug labels (match drawGrid behavior) — draw into gfx so exports include labels
      if (S.debug) {
        try {
          gfx.push();
          gfx.textAlign(CENTER, TOP);
          gfx.textSize(12 * (S.masterScale/100));
          gfx.textStyle(BOLD);
          const vxs = [grid.x, vx1, vx2, grid.x + grid.w];
          for (let i = 0; i < vxs.length; i++) {
            const lx = vxs[i];
            const ly = grid.y + 4;
            const label = `GV${i + 1}`;
            gfx.fill(255);
            gfx.stroke(255);
            gfx.strokeWeight(3);
            gfx.text(label, lx, ly);
            gfx.fill(COL.cyan);
            gfx.noStroke();
            gfx.text(label, lx, ly);
          }

          gfx.textAlign(LEFT, CENTER);
          const hys = [grid.y, my, grid.y + grid.h];
          for (let i = 0; i < hys.length; i++) {
            const ly = hys[i];
            const lx = grid.x + 6;
            const label = `GH${i + 1}`;
            gfx.fill(255);
            gfx.stroke(255);
            gfx.strokeWeight(3);
            gfx.text(label, lx, ly);
            gfx.fill(COL.cyan);
            gfx.noStroke();
            gfx.text(label, lx, ly);
          }

          gfx.textAlign(CENTER, BASELINE);
          const gd1 = { x: grid.x + 0.35 * (grid.x + grid.w - grid.x), y: my + 0.35 * (grid.y - my) };
          const gd2 = { x: grid.x + 0.65 * (grid.x + grid.w - grid.x), y: grid.y + 0.65 * (my - grid.y) };
          gfx.fill(255);
          gfx.stroke(255);
          gfx.strokeWeight(3);
          gfx.text('GD1', gd1.x, gd1.y);
          gfx.text('GD2', gd2.x, gd2.y);
          gfx.fill(COL.cyan);
          gfx.noStroke();
          gfx.text('GD1', gd1.x, gd1.y);
          gfx.text('GD2', gd2.x, gd2.y);
          gfx.pop();
        } catch(e) { /* ignore */ }
      }
      gfx.pop();
    } catch (e) { /* ignore draw errors */ }
  }

  const poly = housePoly(grid.x, grid.y, grid.w, grid.h);

  // Draw house polygon
  const fg = colors.foreground;
  if (S.showForeground) {
    try {
      gfx.push();
      gfx.stroke(S.debug ? COL.cyan : `rgb(${fg.r}, ${fg.g}, ${fg.b})`);
      gfx.strokeWeight(scaledLw);
      gfx.strokeJoin(ROUND);
      gfx.strokeCap(ROUND);
      gfx.noFill();
      gfx.beginShape();
      for (let i = 0; i < poly.length; i++) gfx.vertex(poly[i].x, poly[i].y);
      gfx.endShape(CLOSE);
      // draw text using existing helper but we need a drawTextTo that uses gfx; fallback to drawing on gfx directly
      try { drawTextTo(gfx, grid.x, grid.y, grid.w, grid.h, masterScaleFactor); } catch(e) { /* ignore */ }
      gfx.pop();
    } catch (e) { /* ignore */ }
  }

  // Orbital elements
  const H = centroid(poly);
  const ang = (S.thetaDeg * Math.PI) / 180 + Math.PI / 2;
  const sx = S.scaleX || 1;
  const sy = S.scaleY || 1;
  const C = { x: H.x + scaledR * Math.cos(ang) * sx, y: H.y + scaledR * Math.sin(ang) * sy };

  if (S.showOrbitPath) {
    try { gfx.push(); gfx.noFill(); gfx.stroke(COL.cyan); gfx.strokeWeight(1); const rx = 2 * scaledR * sx; const ry = 2 * scaledR * sy * (S.pathHeightScale || 1); gfx.ellipse(H.x, H.y, rx, ry); gfx.pop(); } catch(e){}
  }

  let a1 = getHousePoint(S.t1, poly);
  let a2 = getHousePoint(S.t2, poly);
  let [p1, p2] = chooseTangents(C, scaledRc, a1, a2, S.p1Prev, S.p2Prev);

  try {
    gfx.push();
    gfx.strokeCap(ROUND);
    gfx.strokeWeight(getScaledValue(S.lw));
    if (S.showForeground) {
      gfx.stroke(S.debug ? COL.mag : `rgb(${fg.r}, ${fg.g}, ${fg.b})`);
      gfx.line(p1.x, p1.y, a1.x, a1.y);
      gfx.line(p2.x, p2.y, a2.x, a2.y);
      gfx.stroke(S.debug ? 0 : `rgb(${fg.r}, ${fg.g}, ${fg.b})`);
      gfx.strokeWeight(getScaledValue(S.lw));
      gfx.noFill();
      gfx.circle(C.x, C.y, getScaledValue(S.rc) * 2);
    }
    gfx.pop();
  } catch (e) { /* ignore */ }

  try { gfx.pop(); } catch(e){}
}

// drawTextTo: similar to drawText but drawing into gfx
function drawTextTo(gfx, gridX, gridY, gridW, gridH, masterScaleFactor = 1) {
  if (!S.showText) return;
  const centerGridX = gridX + gridW / 3;
  const centerGridY = gridY;
  const centerGridW = gridW / 3;
  const centerGridH = gridH / 2;
  const lines = S.textContent.split('\n');
  const scaledFontSize = S.fontSize * masterScaleFactor;
  const scaledTextPadding = S.textPadding * masterScaleFactor;
  const lineHeight = scaledFontSize * S.lineHeight;
  let actualFontSize = scaledFontSize;
  let actualLineHeight = lineHeight;
  gfx.push();
  try { gfx.textFont('Nebulica-Bold'); } catch(e){}
  gfx.textSize(actualFontSize);
  gfx.textStyle(BOLD);
  const totalTextHeight = lines.length * actualLineHeight;
  let maxTextWidth = 0;
  for (let line of lines) { try { const w = gfx.textWidth(line); if (w > maxTextWidth) maxTextWidth = w; } catch(e){} }
  const availableWidth = centerGridW - (scaledTextPadding * 2);
  const availableHeight = centerGridH - (scaledTextPadding * 2);
  const widthScale = maxTextWidth > availableWidth ? availableWidth / maxTextWidth : 1;
  const heightScale = totalTextHeight > availableHeight ? availableHeight / totalTextHeight : 1;
  const textScale = Math.min(widthScale, heightScale);
  if (textScale < 1) { actualFontSize = scaledFontSize * textScale; actualLineHeight = actualFontSize * S.lineHeight; gfx.textSize(actualFontSize); }
  const textX = centerGridX + scaledTextPadding;
  const textBottomY = centerGridY + centerGridH - scaledTextPadding;
  const fg = colors.foreground;
  try { gfx.fill(`rgb(${fg.r}, ${fg.g}, ${fg.b})`); gfx.noStroke(); gfx.textAlign(LEFT, BASELINE); } catch(e){}
  for (let i = 0; i < lines.length; i++) {
    const lineY = textBottomY - (lines.length - 1 - i) * actualLineHeight;
    try { gfx.text(lines[i], textX, lineY); } catch(e){}
  }
  gfx.pop();
}

// Self tests (converted to p5.js console logging)
function performSelfTests() {
  console.groupCollapsed("Zelftests");
  console.assert(
    wrapDeg(0) === 0 &&
      wrapDeg(360) === 0 &&
      wrapDeg(-1) === 359 &&
      wrapDeg(361) === 1,
    "wrapDeg faalt"
  );
  const C0 = { x: 100, y: 100 }, r0 = 35, V0 = { x: 200, y: 100 };
  const tps = tangentPointsFrom(C0, r0, V0);
  if (tps) {
    const d1 = Math.hypot(tps[0].x - C0.x, tps[0].y - C0.y);
    const d2 = Math.hypot(tps[1].x - C0.x, tps[1].y - C0.y);
    console.assert(
      Math.abs(d1 - r0) < 1e-6 && Math.abs(d2 - r0) < 1e-6,
      "Tangenten liggen niet op de cirkel"
    );
  }
  console.assert(!!canvasElement, "Canvas element ontbreekt");
  console.groupEnd();
}

// Run self tests after setup
setTimeout(performSelfTests, 1000);

// Export functions
function exportAsSVG() {
  try {
    console.log("Starting SVG export...");
    
    // Create an SVG element
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("xmlns", svgNamespace);
    
    // Add background with current background color
    const bg = document.createElementNS(svgNamespace, "rect");
    bg.setAttribute("width", width);
    bg.setAttribute("height", height);
    bg.setAttribute("fill", `rgb(${colors.background.r}, ${colors.background.g}, ${colors.background.b})`);
    svg.appendChild(bg);
    
    // Get current drawing parameters
    const pad = 24;
    const canvasArea = { x: pad, y: pad, w: width - 2 * pad, h: height - 2 * pad };
    const grid = getGridArea(canvasArea.x, canvasArea.y, canvasArea.w, canvasArea.h);
    
    // Apply master scaling
    const masterScaleFactor = getMasterScaleFactor();
    const scaledR = S.R * masterScaleFactor;
    const scaledRc = S.rc * masterScaleFactor;
    const scaledLw = S.lw * masterScaleFactor;
    
    // Current foreground color
    const foregroundColor = `rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})`;
    const debugHouseColor = "#00FFFF";
    const debugLineColor = "#FF00FF";
    
    // Draw grid if enabled
    if (S.showGrid) {
      addGridToSVG(svg, grid.x, grid.y, grid.w, grid.h);
    }
    
    // Draw house polygon
    const poly = housePoly(grid.x, grid.y, grid.w, grid.h);
    if (S.showForeground) {
      addPolygonToSVG(svg, poly, scaledLw, S.debug ? debugHouseColor : foregroundColor);
      // Draw text if enabled
      if (S.showText) {
        addTextToSVG(svg, grid.x, grid.y, grid.w, grid.h, masterScaleFactor);
      }
    }
    
    // Calculate orbital elements
    const H = centroid(poly);
  const ang = (S.thetaDeg * Math.PI) / 180 + Math.PI / 2;
  const sx = S.scaleX || 1;
  const sy = S.scaleY || 1;
  const C = { x: H.x + scaledR * Math.cos(ang) * sx, y: H.y + scaledR * Math.sin(ang) * sy };
    
    // Get tangent points
    let a1 = getHousePoint(S.t1, poly);
    let a2 = getHousePoint(S.t2, poly);
    let [p1, p2] = chooseTangents(C, scaledRc, a1, a2, S.p1Prev, S.p2Prev);
    
    // Draw tangent lines
    if (S.showForeground) {
      const lineColor = S.debug ? debugLineColor : foregroundColor;
      addLineToSVG(svg, p1.x, p1.y, a1.x, a1.y, scaledLw, lineColor);
      addLineToSVG(svg, p2.x, p2.y, a2.x, a2.y, scaledLw, lineColor);
      
      // Draw moving circle
      addCircleToSVG(svg, C.x, C.y, scaledRc, scaledLw, S.debug ? debugHouseColor : foregroundColor);
    }

      // Draw orbit path ellipse in SVG if enabled
      if (S.showOrbitPath) {
  const rx = scaledR * sx;
  const ry = scaledR * sy * (S.pathHeightScale || 1);
        const ellipseEl = document.createElementNS(svgNamespace, 'ellipse');
        ellipseEl.setAttribute('cx', H.x);
        ellipseEl.setAttribute('cy', H.y);
  ellipseEl.setAttribute('rx', rx);
  ellipseEl.setAttribute('ry', ry);
        ellipseEl.setAttribute('fill', 'none');
        ellipseEl.setAttribute('stroke', '#25a4ff');
        ellipseEl.setAttribute('stroke-width', 1);
        svg.appendChild(ellipseEl);
      }
    
    // Convert to string and download
    const svgString = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `house-of-orbit-${Date.now()}.svg`;
    a.click();
    
    URL.revokeObjectURL(url);
    console.log("Vector SVG exported successfully");
  } catch (error) {
    console.error("Error exporting SVG:", error);
    alert("Error exporting SVG. Check console for details.");
  }
}

// Helper functions for SVG creation
function addGridToSVG(svg, x, y, w, h) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const gridColor = "#00FFFF"; // Light blue/cyan
  const gridStroke = 1;
  
  // Vertical lines
  for (let i = 1; i <= 2; i++) {
    const line = document.createElementNS(svgNamespace, "line");
    line.setAttribute("x1", x + (w / 3) * i);
    line.setAttribute("y1", y);
    line.setAttribute("x2", x + (w / 3) * i);
    line.setAttribute("y2", y + h);
    line.setAttribute("stroke", gridColor);
    line.setAttribute("stroke-width", gridStroke);
    svg.appendChild(line);
  }
  
  // Horizontal line
  const line = document.createElementNS(svgNamespace, "line");
  line.setAttribute("x1", x);
  line.setAttribute("y1", y + h / 2);
  line.setAttribute("x2", x + w);
  line.setAttribute("y2", y + h / 2);
  line.setAttribute("stroke", gridColor);
  line.setAttribute("stroke-width", gridStroke);
  svg.appendChild(line);
  
  // Diagonal lines
  const diag1 = document.createElementNS(svgNamespace, "line");
  diag1.setAttribute("x1", x);
  diag1.setAttribute("y1", y + h / 2);
  diag1.setAttribute("x2", x + w);
  diag1.setAttribute("y2", y);
  diag1.setAttribute("stroke", gridColor);
  diag1.setAttribute("stroke-width", gridStroke);
  svg.appendChild(diag1);
  
  const diag2 = document.createElementNS(svgNamespace, "line");
  diag2.setAttribute("x1", x);
  diag2.setAttribute("y1", y);
  diag2.setAttribute("x2", x + w);
  diag2.setAttribute("y2", y + h / 2);
  diag2.setAttribute("stroke", gridColor);
  diag2.setAttribute("stroke-width", gridStroke);
  svg.appendChild(diag2);
}

function addPolygonToSVG(svg, poly, strokeWidth, strokeColor) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const polygon = document.createElementNS(svgNamespace, "polygon");
  const points = poly.map(p => `${p.x},${p.y}`).join(" ");
  polygon.setAttribute("points", points);
  polygon.setAttribute("fill", "none");
  polygon.setAttribute("stroke", strokeColor);
  polygon.setAttribute("stroke-width", strokeWidth);
  polygon.setAttribute("stroke-linejoin", "round");
  svg.appendChild(polygon);
  return polygon;
}

function addLineToSVG(svg, x1, y1, x2, y2, strokeWidth, strokeColor) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const line = document.createElementNS(svgNamespace, "line");
  
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("stroke", strokeColor);
  line.setAttribute("stroke-width", strokeWidth);
  line.setAttribute("stroke-linecap", "round");
  
  svg.appendChild(line);
  return line;
}

function addCircleToSVG(svg, cx, cy, r, strokeWidth, strokeColor) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const circle = document.createElementNS(svgNamespace, "circle");
  
  circle.setAttribute("cx", cx);
  circle.setAttribute("cy", cy);
  circle.setAttribute("r", r);
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", strokeColor);
  circle.setAttribute("stroke-width", strokeWidth);
  
  svg.appendChild(circle);
  return circle;
}

function addTextToSVG(svg, gridX, gridY, gridW, gridH, masterScaleFactor) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  
  // Calculate center grid position
  const centerGridX = gridX + gridW / 3;
  const centerGridY = gridY;
  const centerGridH = gridH / 2;
  
  // Apply master scaling to text properties
  const scaledFontSize = S.fontSize * masterScaleFactor;
  const scaledTextPadding = S.textPadding * masterScaleFactor;
  
  // Split text into lines
  const lines = S.textContent.split('\n');
  const lineHeight = scaledFontSize * S.lineHeight;
  
  // Position text at bottom-left with padding
  const textX = centerGridX + scaledTextPadding;
  const textBottomY = centerGridY + centerGridH - scaledTextPadding;
  
  // Create text group
  const textGroup = document.createElementNS(svgNamespace, "g");
  textGroup.setAttribute("fill", `rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})`);
  textGroup.setAttribute("font-family", "Nebulica-Bold, Arial Black, Impact, sans-serif");
  textGroup.setAttribute("font-size", scaledFontSize);
  textGroup.setAttribute("font-weight", "bold");
  
  // Add each line
  lines.forEach((line, i) => {
    const textElement = document.createElementNS(svgNamespace, "text");
    textElement.setAttribute("x", textX);
    textElement.setAttribute("y", textBottomY - (lines.length - 1 - i) * lineHeight);
    textElement.setAttribute("dominant-baseline", "baseline");
    textElement.textContent = line;
    textGroup.appendChild(textElement);
  });
  
  svg.appendChild(textGroup);
}

function exportAsPNG() {
  try {
    // Get canvas element
    const canvas = document.querySelector('canvas');
    if (canvas) {
      // Create download link
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `house-of-orbit-${Date.now()}.png`;
      a.click();
      
      console.log("PNG exported successfully");
    } else {
      throw new Error("Canvas not found");
    }
  } catch (error) {
    console.error("Error exporting PNG:", error);
    alert("Error exporting PNG. Check console for details.");
  }
}

// --- Recording helpers (MediaRecorder) ---
let _recorder = null;
// store chunks as { data: Blob, t: timestamp }
let _recordedChunks = [];
let _isRecording = false;
let _recordStartTime = null;
let _recordTimerId = null;
// ms to drop at start/end to avoid initial/final glitchy frames
const RECORD_DROP_INITIAL_MS = 300;
const RECORD_DROP_FINAL_MS = 150;

async function startRecording(durationSec = 5, fps = 60) {
  const canvas = document.querySelector('canvas');
  if (!canvas) return console.warn('No canvas to record');
  if (!('MediaRecorder' in window)) return alert('MediaRecorder not supported in this browser');

  if (_isRecording) return console.warn('Already recording');
  // Read export settings from centralized exportSettings object (set by exportPreset)
  const es = window.exportSettings || {};
  let exportScale = es.scale || 1;
  let resMode = es.resolution || 'native';
  let customW = (es.customW) ? es.customW : 0, customH = (es.customH) ? es.customH : 0;

  // Helper to compute target resolution (exposed so UI can preview)
  function computeTargetResolution(forCanvas) {
    const canvasRef = forCanvas || document.querySelector('canvas');
    if (!canvasRef) return { w: 0, h: 0 };
  // Allow explicit pixelDensity multiplier from UI (exportPixelDensity)
  let pd = 1;
  try { const pdEl = document.getElementById('exportPixelDensity'); if (pdEl && pdEl.value) pd = Number(pdEl.value) || 1; } catch(e){}
  const effScale = (exportScale || 1) * pd;
  let tW = Math.max(1, Math.round(canvasRef.width * effScale));
  let tH = Math.max(1, Math.round(canvasRef.height * effScale));
    try {
      if (resMode && resMode !== 'native') {
        if (resMode === 'custom' && customW > 0 && customH > 0) {
          const canvasRatio = canvasRef.width / canvasRef.height;
          let w = customW, h = customH;
          const customRatio = w / h;
          if (Math.abs(customRatio - canvasRatio) > 0.001) {
            if (customRatio > canvasRatio) {
              h = Math.max(1, Math.round(w / canvasRatio));
            } else {
              w = Math.max(1, Math.round(h * canvasRatio));
            }
          }
          tW = w; tH = h;
        } else if (/^\d+x\d+$/.test(resMode)) {
          const parts = resMode.split('x');
          const w = parseInt(parts[0])||0, h = parseInt(parts[1])||0;
          if (w>0 && h>0) {
            const canvasRatio = canvasRef.width / canvasRef.height;
            const presetRatio = w / h;
            if (Math.abs(presetRatio - canvasRatio) < 0.01) {
              tW = w; tH = h;
            } else if (presetRatio > canvasRatio) {
              tW = w; tH = Math.max(1, Math.round(w / canvasRatio));
            } else {
              tH = h; tW = Math.max(1, Math.round(h * canvasRatio));
            }
          }
        }
      }
    } catch(e) {}
    // server clamp / client oversize logic (same as below)
    const SERVER_MAX_W = (typeof SERVER_CONVERT_MAX_WIDTH !== 'undefined' && Number(SERVER_CONVERT_MAX_WIDTH)) ? Number(SERVER_CONVERT_MAX_WIDTH) : 1920;
  let allowLocalOversize = !!(window.exportSettings && window.exportSettings.allowLocalOversize);
    // CLIENT_SAFE_MAX_W can be overridden via the UI (#clientSafeMax)
    let CLIENT_SAFE_MAX_W = 4096;
    try {
      const el = document.getElementById('clientSafeMax');
      const v = el && el.value ? Number(el.value) : null;
      if (v && !isNaN(v)) CLIENT_SAFE_MAX_W = Math.max(512, Math.min(7680, Math.round(v)));
    } catch(e){}
    if (!allowLocalOversize && tW > SERVER_MAX_W) {
      const ratio = SERVER_MAX_W / tW;
      tW = SERVER_MAX_W;
      tH = Math.max(1, Math.round(tH * ratio));
    }
    if (allowLocalOversize && tW > CLIENT_SAFE_MAX_W) {
      const ratio = CLIENT_SAFE_MAX_W / tW;
      tW = CLIENT_SAFE_MAX_W;
      tH = Math.max(1, Math.round(tH * ratio));
    }
    return { w: tW, h: tH };
  }

    // Expose UI updater to window so index.html can call it
  window.updateComputedExportResolution = function() {
    try {
      const infoEl = document.getElementById('computedExportSize');
      const canvasEl = document.querySelector('canvas');
      if (!infoEl || !canvasEl) return;
      // refresh from centralized settings
      const es2 = window.exportSettings || {};
      exportScale = es2.scale || exportScale;
      resMode = es2.resolution || resMode;
      customW = es2.customW || customW;
      customH = es2.customH || customH;
  const t = computeTargetResolution(canvasEl);
  // Ensure even dimensions to avoid encoder errors / automatic rescale
  const evenW = t.w % 2 === 0 ? t.w : t.w - 1;
  const evenH = t.h % 2 === 0 ? t.h : t.h - 1;
  infoEl.textContent = `${evenW}×${evenH}`;
    try {
      const clientMaxEl = document.getElementById('clientSafeMax');
      const warnEl = document.getElementById('exportWarning');
      if (clientMaxEl && warnEl) {
        const clientMax = Number(clientMaxEl.value) || 4096;
        if (evenW > clientMax) warnEl.style.display = 'block'; else warnEl.style.display = 'none';
      }
    } catch(e){}
    } catch(e){}
  };
  // initial update
  try { window.updateComputedExportResolution && window.updateComputedExportResolution(); } catch(e){}
  let doTrim = (es && typeof es.trim !== 'undefined') ? !!es.trim : true;

  // Attempt to capture a live stream from the canvas. If exportScale>1 create an
  // offscreen high-resolution canvas and draw the visible canvas into it so the
  // captured frames are higher-resolution bitmaps (improves rasterized output).
  let stream = null;
  let _offscreen = null;
  let _offscreenRAF = null;
  if (exportScale > 1 || (resMode && resMode !== 'native')) {
  try { window.updateComputedExportResolution && window.updateComputedExportResolution(); } catch(e){}
    try {
      // Prefer p5's createGraphics when available — it preserves p5 drawing primitives
      if (typeof createGraphics === 'function') {
        _exportGraphics = createGraphics(targetW, targetH);
        // Ensure pixel density is 1 for the export buffer to avoid DPR scaling artifacts
        try { _exportGraphics.pixelDensity(1); } catch (e) {}
      } else {
        _offscreen = document.createElement('canvas');
        _offscreen.width = targetW;
        _offscreen.height = targetH;
      }
  // Prevent creating extremely large offscreen canvases that cause CPU/memory pressure.
  // Honor a server-provided max width if present as a global; otherwise default to 1920.
  const SERVER_MAX_W = (typeof SERVER_CONVERT_MAX_WIDTH !== 'undefined' && Number(SERVER_CONVERT_MAX_WIDTH)) ? Number(SERVER_CONVERT_MAX_WIDTH) : 1920;
  // Allow user to optionally override server clamp for local capture (use with care)
  let allowLocalOversize = !!(window.exportSettings && window.exportSettings.allowLocalOversize);
  // Hard client-side safety cap to avoid creating ridiculously large canvases in the browser
  const CLIENT_SAFE_MAX_W = 4096; // 4K cap for local capture
      // Compute desired target size. Priority: preset/custom resolution -> exportScale * native
  // compute target using helper to ensure consistency with UI preview
  const t = computeTargetResolution(canvas);
  let targetW = Math.max(1, Math.round(t.w));
  let targetH = Math.max(1, Math.round(t.h));
      try {
        if (resMode && resMode !== 'native') {
          if (resMode === 'custom' && customW > 0 && customH > 0) {
            // Fit custom to canvas aspect ratio by scaling to fit either width or height
            const canvasRatio = canvas.width / canvas.height;
            let w = customW, h = customH;
            const customRatio = w / h;
            if (Math.abs(customRatio - canvasRatio) > 0.001) {
              // preserve canvas aspect by adjusting one dimension
              if (customRatio > canvasRatio) {
                // custom wider -> match width and compute height
                h = Math.max(1, Math.round(w / canvasRatio));
              } else {
                // custom taller -> match height and compute width
                w = Math.max(1, Math.round(h * canvasRatio));
              }
            }
            targetW = w; targetH = h;
          } else if (/^\d+x\d+$/.test(resMode)) {
            const parts = resMode.split('x');
            const w = parseInt(parts[0])||0, h = parseInt(parts[1])||0;
            if (w>0 && h>0) {
              // Fit preset to canvas aspect ratio by letterboxing/fit: compute max size that fits in preset while preserving aspect
              const canvasRatio = canvas.width / canvas.height;
              const presetRatio = w / h;
              if (Math.abs(presetRatio - canvasRatio) < 0.01) {
                targetW = w; targetH = h;
              } else if (presetRatio > canvasRatio) {
                // preset wider -> width limited
                targetW = w; targetH = Math.max(1, Math.round(w / canvasRatio));
              } else {
                // preset taller -> height limited
                targetH = h; targetW = Math.max(1, Math.round(h * canvasRatio));
              }
            }
          }
        }
      } catch(e) { console.warn('Error computing target resolution:', e); }
      if (!allowLocalOversize && targetW > SERVER_MAX_W) {
        const ratio = SERVER_MAX_W / targetW;
        targetW = SERVER_MAX_W;
        targetH = Math.max(1, Math.round(targetH * ratio));
      }
      // If user allowed oversize, clamp to a hard client safety limit
      if (allowLocalOversize && targetW > CLIENT_SAFE_MAX_W) {
        const ratio = CLIENT_SAFE_MAX_W / targetW;
        targetW = CLIENT_SAFE_MAX_W;
        targetH = Math.max(1, Math.round(targetH * ratio));
      }
      _offscreen.width = targetW;
      _offscreen.height = targetH;
  console.log('Offscreen capture size:', _offscreen.width, 'x', _offscreen.height, 'exportScale:', exportScale, 'resMode:', resMode, 'serverMaxW:', SERVER_MAX_W);
      // Copy loop: render scene into the high-res graphics buffer so strokes/text scale cleanly
      if (_exportGraphics) {
        const copyFrame = () => {
          try {
            // clear and draw the scene into the graphics buffer using p5 primitives
            _exportGraphics.push();
            _exportGraphics.clear();
            // Temporarily swap global drawing target by calling drawing functions directly
            // We wrap drawScene to accept a target graphics context when present.
            if (typeof drawSceneTo === 'function') {
              drawSceneTo(_exportGraphics, targetW, targetH);
            } else {
              // Fallback: scale current canvas into the graphics buffer
              _exportGraphics.drawingContext.drawImage(canvas, 0, 0, targetW, targetH);
            }
            _exportGraphics.pop();
          } catch (e) { console.warn('Export graphics draw failed', e); }
          _exportRAF = requestAnimationFrame(copyFrame);
        };
        _exportRAF = requestAnimationFrame(copyFrame);
        try { stream = _exportGraphics.canvas.captureStream ? _exportGraphics.canvas.captureStream(fps) : null; } catch(e){ stream = null; }
      } else {
        const ctx = _offscreen.getContext('2d');
        try { ctx.imageSmoothingEnabled = false; ctx.imageSmoothingQuality = 'low'; } catch(e){}
        // Copy loop: draw the visible canvas scaled into the offscreen canvas
        const copyFrame = () => {
          try { ctx.clearRect(0,0,_offscreen.width,_offscreen.height); ctx.drawImage(canvas, 0, 0, _offscreen.width, _offscreen.height); } catch(e){}
          _offscreenRAF = requestAnimationFrame(copyFrame);
        };
        _offscreenRAF = requestAnimationFrame(copyFrame);
        stream = _offscreen.captureStream ? _offscreen.captureStream(fps) : null;
      }
    } catch (e) {
      console.warn('Offscreen capture failed, falling back to canvas capture', e);
      try { if (_offscreenRAF) cancelAnimationFrame(_offscreenRAF); } catch(e){}
      _offscreen = null;
      stream = canvas && canvas.captureStream ? canvas.captureStream(fps) : null;
    }
  } else {
    stream = canvas && canvas.captureStream ? canvas.captureStream(fps) : null;
  }

  // Helper: wait until stream has a live video track, or timeout
  const waitForLiveTrack = async (s, timeoutMs = 1500) => {
    if (!s || !s.getVideoTracks) return false;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const tracks = s.getVideoTracks();
      if (tracks && tracks.length > 0 && tracks[0].readyState === 'live') return true;
      // sometimes readyState is "live" slightly later; yield and re-check
  await new Promise(r => setTimeout(r, 120));
    }
    return false;
  };

  // If the stream isn't ready yet, give it a short chance to become live.
  const streamReady = await waitForLiveTrack(stream, 1500);
  if (!streamReady) {
    console.warn('Canvas captureStream not live after wait; attempting one quick retry');
    try { showConvertOverlay('Preparing capture...'); } catch(e){}
    // try recapturing once
  const s2 = canvas && canvas.captureStream ? canvas.captureStream(fps) : null;
  const s2ready = await waitForLiveTrack(s2, 2500);
    if (!s2ready) {
      console.error('Failed to get live video track from canvas captureStream');
      try { showConvertOverlay('Capture unavailable'); const manual = document.getElementById('convertManualDownload'); if (manual) manual.style.display = 'inline-block'; } catch(e){}
      return;
    }
  // replace stream with s2
  stream = s2;
  }
    try {
      _recordedChunks = [];
      // Choose recording mime and bitrate based on export preset settings
      let chosenMime = '';
      try {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) chosenMime = 'video/webm;codecs=vp9';
        else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) chosenMime = 'video/webm;codecs=vp8';
        else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/mp4')) chosenMime = 'video/mp4';
      } catch (e) { chosenMime = ''; }

      // Map exportSettings to MediaRecorder bitrate hints
      let vbr = 10_000_000; // default
      try {
        if (es && typeof es.bitrateMbps !== 'undefined' && es.bitrateMbps > 0) vbr = Math.round(es.bitrateMbps * 1000 * 1000);
        else if (es && es.preset && es.preset.indexOf('4k') !== -1) vbr = 40000000; // rough 4K baseline
        else vbr = 10000000;
      } catch (e) {}

    // Create MediaRecorder with the chosen mime and bitrate when possible.
    try {
      if (chosenMime) _recorder = new MediaRecorder(stream, { mimeType: chosenMime, videoBitsPerSecond: vbr });
      else _recorder = new MediaRecorder(stream, { videoBitsPerSecond: vbr });
      try { console.log('MediaRecorder mime chosen:', chosenMime || _recorder.mimeType || '<default>', 'vbr=', vbr); } catch(e){}
    } catch (e) {
      // Fallback: try without options if creation failed for some reason
      try { _recorder = new MediaRecorder(stream); console.warn('MediaRecorder fallback to no-options due to:', e && e.message); } catch (e2) { _recorder = new MediaRecorder(stream); }
    }
  } catch (e) {
    _recorder = new MediaRecorder(stream);
  }

  _recorder.ondataavailable = (e) => {
    try {
      if (e.data) console.log('MediaRecorder.ondataavailable chunk:', { size: e.data.size, type: e.data.type });
      try { if (e.data && e.data.size) uiLog(`chunk: ${e.data.size} bytes (${e.data.type || 'unknown'})`); } catch(e){}
    } catch (ee) {}
    if (e.data && e.data.size > 0) {
      _recordedChunks.push({ data: e.data, t: Date.now() });
    }
  };

  // Choose timeslice based on export settings and expected duration so we don't create many tiny chunks
  let timeslice = 100; // ms
  try {
    const estDur = (durationSec && durationSec > 0) ? durationSec : null;
  if (exportScale > 1 || (resMode && resMode !== 'native')) timeslice = 800; // higher-res -> fewer chunks
    if (estDur && estDur > 60) timeslice = Math.max(timeslice, 2000); // long recordings -> fewer chunks
  } catch (e) {}
  try {
    _recorder.start(timeslice);
  } catch (e) {
    try { _recorder.start(); } catch (e2) { console.warn('MediaRecorder.start failed', e2); throw e2; }
  }
  // Mark recording state and show indicator immediately after starting
  _isRecording = true;
  console.log('Recording started');
  // start record timer UI
  try {
    _recordStartTime = Date.now();
    const recEl = document.getElementById('recDuration');
    if (recEl) recEl.textContent = '00:00';
    if (_recordTimerId) clearInterval(_recordTimerId);
    _recordTimerId = setInterval(() => {
      try {
        if (!_recordStartTime) return;
        const s = Math.floor((Date.now() - _recordStartTime) / 1000);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        const recEl2 = document.getElementById('recDuration');
        if (recEl2) recEl2.textContent = `${mm}:${ss}`;
      } catch (e) {}
    }, 250);
  } catch (e) {}
  try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'flex'; } catch(e){}
  if (durationSec > 0) setTimeout(() => { if (_isRecording) stopRecording(); }, durationSec * 1000);

  _recorder.onstop = async () => {
    // stop UI timer
    try {
      if (_recordTimerId) { clearInterval(_recordTimerId); _recordTimerId = null; }
      _recordStartTime = null;
      const recEl = document.getElementById('recDuration'); if (recEl) recEl.textContent = '00:00';
    } catch (e) {}
    try {
      // Clean up offscreen capture if used
      try {
        if (typeof _offscreenRAF !== 'undefined' && _offscreenRAF) cancelAnimationFrame(_offscreenRAF);
      } catch (e) {}
      try { if (typeof _offscreen !== 'undefined' && _offscreen && _offscreen.width) { _offscreen.width = 1; _offscreen.height = 1; } } catch(e){}
      try { if (typeof _exportRAF !== 'undefined' && _exportRAF) cancelAnimationFrame(_exportRAF); } catch(e){}
      try { if (_exportGraphics && _exportGraphics.width) { _exportGraphics.clear(); /* release */ _exportGraphics = null; } } catch(e){}

      // Create blob from recorded chunks. Use timestamps to trim the first and last unstable ms
      let recordedBlob = null;
      try {
        if (!_recordedChunks || _recordedChunks.length === 0) {
          recordedBlob = new Blob([], { type: 'video/webm' });
        } else {
          if (!doTrim) {
            const raw = _recordedChunks.map(c => c.data);
            recordedBlob = new Blob(raw, { type: (raw.length && raw[0] && raw[0].type) ? raw[0].type : 'video/webm' });
          } else {
            const firstT = _recordedChunks[0].t || Date.now();
            const lastT = _recordedChunks[_recordedChunks.length - 1].t || Date.now();
            const startCut = (_recordStartTime || firstT) + RECORD_DROP_INITIAL_MS;
            const endCut = lastT - RECORD_DROP_FINAL_MS;
            const kept = _recordedChunks.filter(c => (c.t >= startCut && c.t <= endCut)).map(c => c.data);
            const fallback = _recordedChunks.map(c => c.data);
            let chosen = (kept && kept.length > 0) ? kept : fallback;
            // Ensure the assembled blob includes the container header. Some browsers'
            // MediaRecorder chunk trimming can drop the initial initialization
            // segment (EBML / ftyp / RIFF), leaving a chunk that starts mid-cluster.
            // If the first chosen chunk doesn't include a known container signature,
            // prepend the first raw chunk (fallback[0]) to preserve the header.
            try {
              const firstChunk = chosen && chosen.length > 0 ? chosen[0] : null;
              let hasHeader = false;
              if (firstChunk) {
                try {
                  const headBuf = await firstChunk.slice(0, 16).arrayBuffer();
                  const u = new Uint8Array(headBuf);
                  // EBML (WebM): 0x1A 0x45 0xDF 0xA3
                  if (u.length >= 4 && u[0] === 0x1A && u[1] === 0x45 && u[2] === 0xDF && u[3] === 0xA3) hasHeader = true;
                  // MP4: contains 'ftyp' in header
                  const ascii = new TextDecoder().decode(u);
                  if (!hasHeader && ascii && ascii.indexOf('ftyp') !== -1) hasHeader = true;
                  // RIFF/WAV/AVI: starts with 'RIFF'
                  if (!hasHeader && ascii && ascii.indexOf('RIFF') === 0) hasHeader = true;
                } catch (e) { /* ignore */ }
              }
              if (!hasHeader && fallback && fallback.length > 0 && fallback[0] !== firstChunk) {
                // Prepend the raw first chunk to restore header
                chosen = [fallback[0], ...chosen];
              }
            } catch (e) { console.warn('Header-preserve check failed', e); }
            recordedBlob = new Blob(chosen, { type: (chosen.length && chosen[0] && chosen[0].type) ? chosen[0].type : 'video/webm' });
          }
        }
      } catch (assembleErr) {
        console.warn('Error assembling trimmed recorded blob, falling back:', assembleErr);
        const raw = _recordedChunks.map(c => c.data);
        recordedBlob = new Blob(raw, { type: raw.length && raw[0] && raw[0].type ? raw[0].type : 'video/webm' });
      }
    try { console.log('Recorded blob created:', { size: recordedBlob.size, type: recordedBlob.type, chunks: _recordedChunks.length }); } catch(e){}

      // Always show overlay after recording (debugging) and display blob size; show manual download button
      try {
        window.__lastRecordedBlob = recordedBlob;
        showConvertOverlay(`Recorded ${Math.round(recordedBlob.size/1024)} KB`);
        const manual = document.getElementById('convertManualDownload');
        if (manual) {
          manual.style.display = 'inline-block';
      manual.onclick = () => { try { downloadBlob(getLastRecordedBlob(), `house-of-orbit-${Date.now()}.webm`); } catch(e){} };
        }
      } catch(e){}

      // If the recorded blob appears empty, abort server upload to avoid 0-byte files but keep UI visible for debugging
      if (!recordedBlob || !recordedBlob.size || recordedBlob.size < 32) {
        console.warn('Recorded blob is empty or too small, attempting a short retry recording as a fallback');
        try { uiLog('Recorded blob empty — retrying short capture...'); } catch(e){}
        // Try a short 1s fallback capture with explicit webm vp8 mime (Safari may respond better)
        try {
          const fallbackStream = canvas && canvas.captureStream ? canvas.captureStream(15) : null;
          if (fallbackStream) {
            const fallbackChunks = [];
            let fallbackRec;
            try { fallbackRec = new MediaRecorder(fallbackStream, { mimeType: 'video/webm;codecs=vp8' }); } catch (er) { fallbackRec = new MediaRecorder(fallbackStream); }
            fallbackRec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) fallbackChunks.push(ev.data); };
            try { fallbackRec.start(100); } catch (er) { try { fallbackRec.start(); } catch(e2){} }
            await new Promise(r => setTimeout(r, 1100));
            try { fallbackRec.stop(); } catch(e){}
            await new Promise(r => setTimeout(r, 300));
            const fb = new Blob(fallbackChunks, { type: fallbackChunks.length && fallbackChunks[0] && fallbackChunks[0].type ? fallbackChunks[0].type : 'video/webm' });
            console.log('Fallback recorded blob size:', fb.size);
            if (fb && fb.size && fb.size > 32) {
              // use fallback blob as the recordedBlob
              try { uiLog('Fallback capture succeeded'); } catch(e){}
              window.__lastRecordedBlob = fb;
              // continue with upload flow using fb
              recordedBlob = fb;
            } else {
              uiLog('Fallback capture failed — recording unavailable');
              console.warn('Fallback capture produced empty blob');
              _isRecording = false;
              try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
              return;
            }
          } else {
            uiLog('Fallback capture not supported in this browser');
            _isRecording = false;
            try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
            return;
          }
        } catch (retryErr) {
          console.warn('Retry capture failed', retryErr);
          _isRecording = false;
          try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
          return;
        }
      }


      // If the recorder already produced MP4, download immediately
      if (recordedBlob.type && recordedBlob.type.includes('mp4')) {
        downloadBlob(recordedBlob, `house-of-orbit-${Date.now()}.mp4`);
        console.log('Native MP4 recording downloaded');
  _isRecording = false;
        try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
        return;
      }

      // Before attempting a full server-side conversion, run a tiny preflight
      // recording (short, low-fps) to ensure the recorder actually emits data
      // in this browser. Some browsers (especially Safari) may require the
      // capture to be warmed up.
      const preflightOk = await (async () => {
        try {
          const pfStream = canvas && canvas.captureStream ? canvas.captureStream(5) : null;
          if (!pfStream) return false;
          const pfChunks = [];
          let pfRec;
          try {
            pfRec = new MediaRecorder(pfStream, { mimeType: 'video/webm;codecs=vp8' });
          } catch (e) {
            pfRec = new MediaRecorder(pfStream);
          }
          pfRec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) pfChunks.push(ev.data); };
          pfRec.start();
          await new Promise(r => setTimeout(r, 500));
          pfRec.stop();
          await new Promise(r => setTimeout(r, 200));
          const b = new Blob(pfChunks, { type: pfChunks.length && pfChunks[0].type ? pfChunks[0].type : 'video/webm' });
          console.log('Preflight recorded blob size:', b.size);
          return b && b.size && b.size > 64;
        } catch (e) {
          console.warn('Preflight capture failed', e);
          return false;
        }
      })();
      if (!preflightOk) {
        console.warn('Preflight capture failed — aborting full upload to avoid empty files');
        try { showConvertOverlay('Capture failed — try reloading or use a different browser'); const manual = document.getElementById('convertManualDownload'); if (manual) manual.style.display = 'inline-block'; } catch(e){}
        _isRecording = false;
        try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
        return;
      }

      // Probe the recorded blob to collect its intrinsic video metadata (width/height/duration)
      async function probeRecordedBlob(blob) {
        try {
          const url = URL.createObjectURL(blob);
          const v = document.createElement('video');
          v.muted = true;
          v.playsInline = true;
          v.src = url;
          await new Promise((resolve, reject) => {
            const to = setTimeout(() => { reject(new Error('probe timeout')); }, 3000);
            v.addEventListener('loadedmetadata', () => { clearTimeout(to); resolve(); }, { once: true });
            v.addEventListener('error', (e) => { clearTimeout(to); reject(e); }, { once: true });
          });
          const info = { width: v.videoWidth || 0, height: v.videoHeight || 0, duration: v.duration || 0 };
          try { console.log('Probed recorded blob:', info, 'type:', blob.type, 'size:', blob.size); } catch(e){}
          URL.revokeObjectURL(url);
          return info;
        } catch (e) {
          console.warn('Could not probe recorded blob', e);
          return { width: 0, height: 0, duration: 0 };
        }
      }

      // Probe and log recorded blob info; if it is substantially smaller than expected warn the user
      try {
        const probe = await probeRecordedBlob(recordedBlob);
        const desired = (typeof computeTargetResolution === 'function') ? computeTargetResolution(canvas) : { w: Math.round(canvas.width * exportScale), h: canvas.height };
        if (probe.width && desired.w && probe.width < Math.max(1, Math.round(desired.w * 0.85))) {
          const overs = (typeof allowLocalOversize !== 'undefined' && allowLocalOversize) ? ' (oversize allowed, may still be clamped by browser)' : '';
          uiLog(`Recorded resolution ${probe.width}x${probe.height} lower than expected ${desired.w}${overs} — try increasing export scale or reduce device pixel ratio`);
          showConvertOverlay('Recorded appears low-res — consider re-recording at higher scale');
          // still continue to attempt upload so user can inspect fallback
        }
      } catch (e) {}

      // If the recorded blob is too large for the server (multer limit), skip upload and show manual download
      try {
        const MAX_SERVER_UPLOAD = 200 * 1024 * 1024; // match server multer config
        if (recordedBlob.size > MAX_SERVER_UPLOAD) {
          uiLog('Recorded file too large for server conversion; use manual download or reduce scale/duration.');
          showConvertOverlay('File too large for server. Use manual download.');
          _isRecording = false;
          try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
          return;
        }
      } catch(e) {}

      // Try server-side conversion first with retries (XHR so we can show progress and cancel)
      const tryServerConvertWithRetries = async (blob, attempts = 3, delayMs = 5000) => {
        if (!SERVER_CONVERT_URL || SERVER_CONVERT_URL.length === 0) return false;
        for (let i = 0; i < attempts; i++) {
          console.log(`Upload attempt ${i + 1}/${attempts} to ${SERVER_CONVERT_URL}`);
          showConvertOverlay(`Uploading (attempt ${i + 1}/${attempts})`);
          try {
            // Use fetch() for upload (simpler and often more reliable than XHR for FormData)
            const form = new FormData();
            try { console.log('Uploading blob to server (fetch):', { size: blob.size, type: blob.type }); } catch(e){}
            form.append('file', blob, 'recording.webm');
            // Attach a short client-side signature (hex of first bytes) to help server diagnose container corruption
            try {
              const head = blob.slice(0, 64);
              head.arrayBuffer().then(buf => {
                const bytes = new Uint8Array(buf);
                const hex = Array.from(bytes).slice(0, 32).map(b => b.toString(16).padStart(2,'0')).join('');
                console.log('Client blob header hex:', hex);
                form.append('client_sig', hex);
              }).catch(e => { console.warn('Failed to read blob header for client_sig', e); });
            } catch (e) { console.warn('Could not compute client signature:', e); }
            // Include selected quality from UI so the server can adapt ffmpeg settings
            try {
              // Export settings come from window.exportSettings
              const esu = window.exportSettings || {};
              if (esu.preset) form.append('preset', esu.preset);
              if (esu.resolution) form.append('resolution', esu.resolution);
              if (esu.bitrateMbps && esu.bitrateMbps > 0) form.append('target_bitrate', String(Math.round(esu.bitrateMbps * 1000 * 1000)));
              if (esu.forceBitrate) form.append('force_bitrate', '1');
              if (esu.format) form.append('format', esu.format);
              if (esu.codec) form.append('codec', esu.codec);
              if (esu.max_bitrate) form.append('max_bitrate', String(esu.max_bitrate));
              if (esu.vbr_pass) form.append('vbr_pass', String(esu.vbr_pass));
            } catch(e) { console.warn('Failed to append export preset fields', e); }
            // If user requested a non-native resolution or allowed local oversize, tell server not to auto-scale
            try {
              const esu = window.exportSettings || {};
              const wantNoScale = (esu.resolution && esu.resolution !== 'native') || (!!esu.allowLocalOversize);
              if (wantNoScale) { form.append('no_scale', 'true'); console.log('Uploading with no_scale=true'); }
            } catch(e) {}

            // Build headers (only Authorization and Accept; do NOT set Content-Type for FormData)
            const headers = {};
            let auth = SERVER_CONVERT_AUTH;
            if (!auth && SERVER_CONVERT_USER && SERVER_CONVERT_PASS) auth = btoa(`${SERVER_CONVERT_USER}:${SERVER_CONVERT_PASS}`);
            if (auth) headers['Authorization'] = `Basic ${auth}`;
            headers['Accept'] = 'video/mp4';

            // Timeout using AbortController (longer timeout for slow conversions/uploads)
            const controller = new AbortController();
            const timeoutMs = (typeof window.CLIENT_UPLOAD_TIMEOUT_MS !== 'undefined' ? Number(window.CLIENT_UPLOAD_TIMEOUT_MS) : 120000); // ms
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            let outBlob = null;
            try {
              const effectiveUrl = sanitizeConvertUrl(SERVER_CONVERT_URL);
              console.log('Uploading to (effective):', effectiveUrl);
              uiLog(`Uploading ${Math.round(blob.size/1024)}KB to ${effectiveUrl}`);
              const resp = await fetch(effectiveUrl, { method: 'POST', headers, body: form, signal: controller.signal, cache: 'no-store' });
              clearTimeout(timeoutId);
              console.log('Upload response status:', resp.status, 'content-type:', resp.headers.get('Content-Type'));
              uiLog(`Upload response: ${resp.status} ${resp.statusText}`);
              if (!resp.ok) {
                // Log response text for diagnostics and show overlay/manual button
                let txt = '';
                try { txt = await resp.text(); } catch(e) { txt = '<could not read response text>'; }
                console.warn('Server non-OK response:', resp.status, txt);
                try { showConvertOverlay(`Server error ${resp.status}`); const manual = document.getElementById('convertManualDownload'); if (manual) manual.style.display = 'inline-block'; } catch(e){}
                throw new Error(`Server returned ${resp.status}: ${txt}`);
              }
              setConvertProgress(70, 'Processing on server...');
              outBlob = await resp.blob();
              try { uiLog(`Server returned ${outBlob.size} bytes`); } catch(e){}
            } catch (fetchErr) {
              clearTimeout(timeoutId);
              console.warn('Upload/convert failed:', fetchErr);
              try { showConvertOverlay('Upload failed'); const manual = document.getElementById('convertManualDownload'); if (manual) manual.style.display = 'inline-block'; } catch(e){}
              throw fetchErr;
            }
            // If we got a blob, treat it as MP4 and download (also create a visible manual link as a fallback)
            if (outBlob) {
              const ct = outBlob.type || '';
              const ext = ct.includes('mp4') ? 'mp4' : 'mp4';
              setConvertProgress(100, 'Download ready');
              // Log response headers for diagnostics
              try {
                uiLog(`Response headers: Content-Type=${resp.headers.get('Content-Type')}, Content-Length=${resp.headers.get('Content-Length')}, Content-Disposition=${resp.headers.get('Content-Disposition')}`);
              } catch (e) {}

              // Try automatic download
              try {
                downloadBlob(outBlob, `house-of-orbit-${Date.now()}.${ext}`);
                console.log('Triggered automatic download');
              } catch (e) {
                console.warn('Automatic download may be blocked, will show manual link', e);
              }

              // Create a manual download link (visible) as a robust fallback for browsers that block programmatic clicks
              try {
                const manual = document.getElementById('convertManualDownload');
                if (manual) {
                  const url = URL.createObjectURL(outBlob);
                  manual.href = url;
                  manual.download = `house-of-orbit-${Date.now()}.${ext}`;
                  manual.style.display = 'inline-block';
                  // When clicked, revoke the object URL after a short delay
                  manual.onclick = () => { setTimeout(() => URL.revokeObjectURL(url), 2000); };
                }
              } catch (e) { console.warn('Could not create manual download link', e); }

              hideConvertOverlay();
              console.log('Server conversion complete (blob received)');
              // Consider success even if automatic download was blocked; user can click the manual link
              return true;
            } else {
              throw new Error('Empty response from server');
            }
          } catch (err) {
            console.warn(`Server conversion attempt ${i + 1} failed:`, err);
            setConvertProgress(0, `Attempt ${i + 1} failed`);
            if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
          }
        }
        hideConvertOverlay();
        return false;
      };

      // Expose recordedBlob for manual download UI
      try { window.__lastRecordedBlob = recordedBlob; } catch(e){}
      const manualBtn = document.getElementById('convertManualDownload');
      if (manualBtn) {
        manualBtn.onclick = () => { try { if (window.__lastRecordedBlob) downloadBlob(window.__lastRecordedBlob, `house-of-orbit-${Date.now()}.webm`); } catch(e){} };
      }

      let serverOk = false;
      try { serverOk = await tryServerConvertWithRetries(recordedBlob, 3, 3000); } catch (e) { serverOk = false; }

      if (serverOk) {
        _isRecording = false;
        try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
        return;
      }

      // Server conversion failed or not available. Try ffmpeg.wasm client-side if available
      const canAttemptFFmpeg = (typeof createFFmpeg === 'function' && typeof fetchFile === 'function') || (window.FFmpeg && typeof window.FFmpeg.createFFmpeg === 'function');
      const vtest = document.createElement('video');
      const supportsMp4 = !!(vtest && typeof vtest.canPlayType === 'function' && (vtest.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') || vtest.canPlayType('video/mp4')));

      if (canAttemptFFmpeg && supportsMp4) {
        try {
          console.log('Attempting client-side WebM->MP4 conversion via ffmpeg.wasm (may take a while)...');
          const create = (typeof createFFmpeg === 'function') ? createFFmpeg : (window.FFmpeg && window.FFmpeg.createFFmpeg) ? window.FFmpeg.createFFmpeg : null;
          const fetchF = (typeof fetchFile === 'function') ? fetchFile : (window.FFmpeg && window.FFmpeg.fetchFile) ? window.FFmpeg.fetchFile : null;
          if (!create || !fetchF) throw new Error('ffmpeg helpers not found');
          const ffmpeg = create({ log: false });
          await ffmpeg.load();
          ffmpeg.FS('writeFile', 'input.webm', await fetchF(recordedBlob));
          await ffmpeg.run(
            '-i', 'input.webm',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-profile:v', 'baseline',
            '-level', '3.0',
            '-movflags', '+faststart',
            'output.mp4'
          );
          const data = ffmpeg.FS('readFile', 'output.mp4');
          const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });
          downloadBlob(mp4Blob, `house-of-orbit-${Date.now()}.mp4`);
          try { ffmpeg.FS('unlink', 'input.webm'); ffmpeg.FS('unlink', 'output.mp4'); } catch (e){}
          console.log('MP4 conversion and download complete');
          _isRecording = false;
          try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
          return;
        } catch (convErr) {
          console.warn('FFmpeg conversion failed, falling back to WebM download:', convErr);
        }
      }

      // Final fallback: download the original WebM
      downloadBlob(recordedBlob, `house-of-orbit-${Date.now()}.webm`);
      console.log('Recording saved (no conversion)');

    } catch (err) {
      console.error('Error handling recorded data:', err);
      alert('Recording saved failed. Check console for details.');
    } finally {
      _isRecording = false;
      // Hide recording indicator
      try { const ri = document.getElementById('recordIndicator'); if (ri) ri.style.display = 'none'; } catch(e){}
    }
  };

  // recorder already started above; recording state and timeout handled there
}

// Setup convert overlay buttons
try {
  const cancel = document.getElementById('convertCancel');
  if (cancel) cancel.addEventListener('click', () => { hideConvertOverlay(); });
  const manual = document.getElementById('convertManualDownload');
  if (manual) manual.addEventListener('click', () => { try { if (window.__lastRecordedBlob) downloadBlob(window.__lastRecordedBlob, `house-of-orbit-${Date.now()}.webm`); } catch(e){} });
} catch(e) {}

// Helper: return a single Blob for the last recorded data regardless of internal chunk storage
function getLastRecordedBlob() {
  try {
    if (window.__lastRecordedBlob) return window.__lastRecordedBlob;
    if (_recordedChunks && _recordedChunks.length > 0) {
      // _recordedChunks may store {data,t} objects
      const arr = _recordedChunks.map(c => c.data ? c.data : c);
      return new Blob(arr, { type: (arr.length && arr[0] && arr[0].type) ? arr[0].type : 'video/webm' });
    }
    return null;
  } catch (e) { return null; }
}

function stopRecording() {
  if (_recorder && _isRecording) {
    _recorder.stop();
    console.log('Recording stopped');
  }
}

function toggleRecording(durationSec = 5, fps = 60) {
  if (_isRecording) stopRecording(); else startRecording(durationSec, fps);
}

// Share button multi-press handling: 1 press = SVG, 2 presses = start recording, 3 presses = PNG
let _sharePressCount = 0;
let _sharePressTimer = null;
const _sharePressWindow = 520; // ms within which presses count
// Hold-to-record helpers for share button
let _shareHoldTimer = null;
let _shareHoldActive = false;
let _shareHoldStartedAt = 0;
const _shareHoldThreshold = 1000; // ms to hold before starting SVG recording

function handleSharePressAction() {
  if (_sharePressTimer) clearTimeout(_sharePressTimer);
  _sharePressTimer = setTimeout(() => {
    if (_sharePressCount === 1) {
      exportAsSVG();
    } else if (_sharePressCount === 2) {
      // Start recording (manual stop via Circle button or toggle)
      startRecording(0, 60); // 0 = manual stop
    } else if (_sharePressCount >= 3) {
      exportAsPNG();
    }
    _sharePressCount = 0;
  }, _sharePressWindow);
}


function keyPressed() {
  // ESC key closes color menu
  if (keyCode === 27) { // 27 is ESC key code
    if (colorMenuVisible) {
      toggleColorMenu();
    }
  }
  // 'E' exports animated SVG demo
  try {
    if ((typeof key === 'string' && (key === 'e' || key === 'E')) || keyCode === 69) {
      // Toggle SVG recording: start on first press, stop and export on second
      if (!_svgRecording) startSVGRecording(); else stopSVGRecording();
    }
  } catch(e){}
}

// Sample the scene's moving parameters (circle position and tangent endpoints) into _svgFrames
function sampleSVGFrame() {
  try {
    if (_svgFrames.length >= _svgMaxFrames) return; // safety cap
    // compute the same values drawScene uses
    const pad = 24;
    const canvasArea = { x: pad, y: pad, w: width - 2 * pad, h: height - 2 * pad };
    const grid = getGridArea(canvasArea.x, canvasArea.y, canvasArea.w, canvasArea.h);
    const poly = housePoly(grid.x, grid.y, grid.w, grid.h);
    const H = centroid(poly);
    const masterScaleFactor = S.masterScale / 100;
    const scaledR = S.R * masterScaleFactor;
    const sx = S.scaleX || 1;
    const sy = S.scaleY || 1;
    const ang = (S.thetaDeg * Math.PI) / 180 + Math.PI / 2;
    const Cx = H.x + scaledR * Math.cos(ang) * sx;
    const Cy = H.y + scaledR * Math.sin(ang) * sy;
    const a1 = getHousePoint(S.t1, poly);
    const a2 = getHousePoint(S.t2, poly);
    const tang = chooseTangents({ x: Cx, y: Cy }, S.rc * masterScaleFactor, a1, a2, S.p1Prev, S.p2Prev);
    const p1 = tang[0], p2 = tang[1];
  // orbit path parameters (ellipse centered on house centroid H)
  const orbitRx = 2 * scaledR; // diameter-like value in p5 coords (will be scaled to display)
  const orbitRy = 2 * scaledR * (S.pathHeightScale || 1);
    // Also record the house polygon vertices so the polygon can be animated in the SVG
    const polyPts = poly.map((p,i)=> ({ x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)) }));
    _svgFrames.push({
      cx: Number(Cx.toFixed(3)), cy: Number(Cy.toFixed(3)),
      p1x: Number(p1.x.toFixed(3)), p1y: Number(p1.y.toFixed(3)),
      p2x: Number(p2.x.toFixed(3)), p2y: Number(p2.y.toFixed(3)),
      a1x: Number(a1.x.toFixed(3)), a1y: Number(a1.y.toFixed(3)),
      a2x: Number(a2.x.toFixed(3)), a2y: Number(a2.y.toFixed(3)),
      rc: Number((S.rc * masterScaleFactor).toFixed(3)), lw: Number((S.lw * masterScaleFactor).toFixed(3)),
      poly: polyPts,
      grid: { x: Number(grid.x.toFixed(3)), y: Number(grid.y.toFixed(3)), w: Number(grid.w.toFixed(3)), h: Number(grid.h.toFixed(3)) },
      master: Number(masterScaleFactor.toFixed(6)),
  fontSizeRaw: Number(S.fontSize),
  textPaddingRaw: Number(S.textPadding),
  showOrbitFlag: !!S.showOrbitPath,
  orbit: { hx: Number(H.x.toFixed(3)), hy: Number(H.y.toFixed(3)), rx: Number(orbitRx.toFixed(3)), ry: Number(orbitRy.toFixed(3)) },
  showGridFlag: !!S.showGrid,
  debugFlag: !!S.debug
    });
  } catch (e) { console.warn('sampleSVGFrame failed', e); }
}

function startSVGRecording() {
  _svgRecording = true;
  _svgFrames = [];
  _svgRecordStart = Date.now();
  // show simple UI indicator if element exists
  try {
    const ri = document.getElementById('recordIndicator');
    const recEl = document.getElementById('recDuration');
    if (ri) ri.style.display = 'flex';
    if (recEl) recEl.textContent = '00:00';
  } catch(e){}
  _svgRecordTimerId = setInterval(() => {
    try {
      const recEl = document.getElementById('recDuration');
      if (recEl) {
        const s = Math.floor((Date.now() - _svgRecordStart) / 1000);
        const mm = String(Math.floor(s/60)).padStart(2,'0');
        const ss = String(s % 60).padStart(2,'0');
        recEl.textContent = `${mm}:${ss}`;
      }
    } catch(e){}
  }, 400);
  console.log('SVG recording started');
}

function stopSVGRecording() {
  _svgRecording = false;
  if (_svgRecordTimerId) { clearInterval(_svgRecordTimerId); _svgRecordTimerId = null; }
  try {
    // Hide the shared record indicator only if a normal screen recording is not active
    const ri = document.getElementById('recordIndicator');
    const recEl = document.getElementById('recDuration');
    if (!window._isRecording && ri) ri.style.display = 'none';
    if (recEl) recEl.textContent = '00:00';
  } catch(e){}
  console.log('SVG recording stopped, frames:', _svgFrames.length);
  // Build SMIL SVG from samples and trigger download
  try { buildSVGFromSamples(`house-of-orbit-${Date.now()}.svg`, _svgFrames, _svgRecordFps); } catch(e){ console.error('buildSVGFromSamples failed', e); }
}

function buildSVGFromSamples(filename, frames, fps) {
  if (!frames || frames.length < 2) { alert('Not enough frames recorded for SVG'); return; }
  // Prefer the canvas's displayed (CSS) size so the SVG matches what the user sees
  const canvasEl = document.querySelector('canvas');
  const displayW = (canvasEl && canvasEl.clientWidth) ? canvasEl.clientWidth : Math.max(1, Math.round(width));
  const displayH = (canvasEl && canvasEl.clientHeight) ? canvasEl.clientHeight : Math.max(1, Math.round(height));
  const w = Math.max(1, Math.round(displayW));
  const h = Math.max(1, Math.round(displayH));
  // Compute scale from p5 internal coords (width/height) to displayed pixels
  const srcW = Math.max(1, Math.round(width));
  const srcH = Math.max(1, Math.round(height));
  const sx = w / srcW;
  const sy = h / srcH;
  const avgScale = (sx + sy) / 2;
  const dur = (frames.length / (fps||30));
  // build keyTimes and values with loop closure (append first frame)
  const keyTimesArr = [];
  for (let i = 0; i <= frames.length; i++) keyTimesArr.push((i/frames.length).toFixed(6));
  const keyTimes = keyTimesArr.join(';');
  function vals(arrKey) { const v = frames.map(f => f[arrKey]); v.push(v[0]); return v.join(';'); }

  const svgNS = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(svgNS, 'svg');
  svgEl.setAttribute('xmlns', svgNS);
  svgEl.setAttribute('width', String(w));
  svgEl.setAttribute('height', String(h));
  svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', `rgb(${colors.background.r}, ${colors.background.g}, ${colors.background.b})`);
  svgEl.appendChild(bg);

  // Groups for grid and debug visuals; we'll animate their opacity based on sampled frames
  const gridGroup = document.createElementNS(svgNS, 'g');
  gridGroup.setAttribute('id','gridGroup');
  // set initial grid visibility from first sample
  try { gridGroup.setAttribute('opacity', frames[0] && frames[0].showGridFlag ? '1' : '0'); } catch(e){}
  svgEl.appendChild(gridGroup);
  const debugGroup = document.createElementNS(svgNS, 'g');
  debugGroup.setAttribute('id','debugGroup');
  // set initial debug visibility from first sample
  try { debugGroup.setAttribute('opacity', frames[0] && frames[0].debugFlag ? '1' : '0'); } catch(e){}
  svgEl.appendChild(debugGroup);


  // Compute grid in display coordinates using same helper as the canvas draw
  const displayCanvasArea = { x: 24, y: 24, w: w - 48, h: h - 48 };
  const grid = getGridArea(displayCanvasArea.x, displayCanvasArea.y, displayCanvasArea.w, displayCanvasArea.h);

  // House polygon (use helper to ensure stroke width and joins match)
  const poly = housePoly(grid.x, grid.y, grid.w, grid.h);
  const polyStroke = (S.lw * (S.masterScale/100)) * avgScale;
  // Use debug colors when recording started in debug mode; we'll also animate color changes across frames
  const debugHouseColor = '#00FFFF';
  const debugLineColor = '#FF00FF';
  const foregroundRgb = `rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})`;
  const polyEl = addPolygonToSVG(svgEl, poly, Number(polyStroke.toFixed(2)), (frames[0] && frames[0].debugFlag) ? debugHouseColor : foregroundRgb);

  // (text will be created and animated below; skip static insertion)

  // Tangent lines and orbiting circle created as DOM elements so we can attach <animate> children
  // Map the first-frame values into display coordinates for initial element positions
  const mapX = v => (v * sx).toFixed(3);
  const mapY = v => (v * sy).toFixed(3);
  const mapR = r => (r * avgScale).toFixed(3);
  const mapLW = lw => (lw * avgScale).toFixed(3);
  const t1 = addLineToSVG(svgEl, mapX(frames[0].p1x), mapY(frames[0].p1y), mapX(frames[0].a1x), mapY(frames[0].a1y), Number(mapLW(frames[0].lw)), (frames[0] && frames[0].debugFlag) ? debugLineColor : foregroundRgb);
  const t2 = addLineToSVG(svgEl, mapX(frames[0].p2x), mapY(frames[0].p2y), mapX(frames[0].a2x), mapY(frames[0].a2y), Number(mapLW(frames[0].lw)), (frames[0] && frames[0].debugFlag) ? debugLineColor : foregroundRgb);
  // frames[].rc is stored as the scaled radius (same as getScaledValue(S.rc)); mapR converts to display pixels — do not halve it here
  const orb = addCircleToSVG(svgEl, mapX(frames[0].cx), mapY(frames[0].cy), Number(mapR(frames[0].rc)), Number(mapLW(frames[0].lw)), (frames[0] && frames[0].debugFlag) ? debugLineColor : foregroundRgb);

  // Orbit ellipse element (create always so we can animate visibility later)
  let orbitEl = null;
  try {
    orbitEl = document.createElementNS(svgNS, 'ellipse');
    orbitEl.setAttribute('cx', (frames[0].orbit.hx * sx).toFixed(3));
    orbitEl.setAttribute('cy', (frames[0].orbit.hy * sy).toFixed(3));
    orbitEl.setAttribute('rx', (frames[0].orbit.rx * sx).toFixed(3));
    orbitEl.setAttribute('ry', (frames[0].orbit.ry * sy).toFixed(3));
    orbitEl.setAttribute('fill', 'none'); orbitEl.setAttribute('stroke', COL.cyan || '#25a4ff'); orbitEl.setAttribute('stroke-width', (1 * avgScale).toFixed(3));
    // initial opacity from first frame
    orbitEl.setAttribute('opacity', frames[0] && frames[0].showOrbitFlag ? '1' : '0');
    svgEl.appendChild(orbitEl);
  } catch(e) { console.warn('orbit element create failed', e); }

  // Populate gridGroup with lines positioned based on the computed grid (we'll animate opacity and coordinates later)
  try {
    // create vertical lines (three columns boundaries)
    for (let i = 1; i <= 2; i++) {
      const xPos = (grid.x + (grid.w / 3) * i) * sx;
      const l = document.createElementNS(svgNS, 'line');
      l.setAttribute('x1', xPos.toFixed(3)); l.setAttribute('y1', (grid.y * sy).toFixed(3));
      l.setAttribute('x2', xPos.toFixed(3)); l.setAttribute('y2', ((grid.y + grid.h) * sy).toFixed(3));
      l.setAttribute('stroke', '#00FFFF'); l.setAttribute('stroke-width', (1 * avgScale).toFixed(3));
      gridGroup.appendChild(l);
    }
    // horizontal center line
    const hc = document.createElementNS(svgNS, 'line');
    hc.setAttribute('x1', (grid.x * sx).toFixed(3)); hc.setAttribute('y1', ((grid.y + grid.h / 2) * sy).toFixed(3));
    hc.setAttribute('x2', ((grid.x + grid.w) * sx).toFixed(3)); hc.setAttribute('y2', ((grid.y + grid.h / 2) * sy).toFixed(3));
    hc.setAttribute('stroke', '#00FFFF'); hc.setAttribute('stroke-width', (1 * avgScale).toFixed(3));
    gridGroup.appendChild(hc);

    // diagonal lines
    const diag1 = document.createElementNS(svgNS, 'line');
    diag1.setAttribute('x1', (grid.x * sx).toFixed(3)); diag1.setAttribute('y1', ((grid.y + grid.h / 2) * sy).toFixed(3));
    diag1.setAttribute('x2', ((grid.x + grid.w) * sx).toFixed(3)); diag1.setAttribute('y2', (grid.y * sy).toFixed(3));
    diag1.setAttribute('stroke', '#00FFFF'); diag1.setAttribute('stroke-width', (1 * avgScale).toFixed(3));
    gridGroup.appendChild(diag1);
    const diag2 = document.createElementNS(svgNS, 'line');
    diag2.setAttribute('x1', (grid.x * sx).toFixed(3)); diag2.setAttribute('y1', (grid.y * sy).toFixed(3));
    diag2.setAttribute('x2', ((grid.x + grid.w) * sx).toFixed(3)); diag2.setAttribute('y2', ((grid.y + grid.h / 2) * sy).toFixed(3));
    diag2.setAttribute('stroke', '#00FFFF'); diag2.setAttribute('stroke-width', (1 * avgScale).toFixed(3));
    gridGroup.appendChild(diag2);
  } catch(e) { console.warn('gridGroup population failed', e); }

  // Populate debugGroup with scaled debug markers and debug labels; animate positions using sampled frames
  try {
    const dbgPoints = [];
    for (let i = 0; i < poly.length; i++) {
      const hp = poly[i];
      const dbg = document.createElementNS(svgNS, 'circle');
      dbg.setAttribute('cx', (hp.x * sx).toFixed(3)); dbg.setAttribute('cy', (hp.y * sy).toFixed(3)); dbg.setAttribute('r', (4 * avgScale).toFixed(3)); dbg.setAttribute('fill', 'none');
      dbg.setAttribute('stroke', (frames[0] && frames[0].debugFlag) ? debugHouseColor : foregroundRgb);
      dbg.setAttribute('stroke-width', (2 * avgScale).toFixed(3));
      dbg.setAttribute('id', `debugPoint${i}`);
      debugGroup.appendChild(dbg);
      dbgPoints.push(dbg);
    }

    // Animate debug points' cx/cy per-frame so they follow the polygon vertices
    for (let i = 0; i < dbgPoints.length; i++) {
      const el = dbgPoints[i];
      const cxVals = frames.map(f => ((f.poly && f.poly[i]) ? ((f.poly[i].x * sx).toFixed(3)) : ((poly[i].x * sx).toFixed(3)))).concat(((frames[0].poly && frames[0].poly[i]) ? ((frames[0].poly[i].x * sx).toFixed(3)) : ((poly[i].x * sx).toFixed(3)))).join(';');
      const cyVals = frames.map(f => ((f.poly && f.poly[i]) ? ((f.poly[i].y * sy).toFixed(3)) : ((poly[i].y * sy).toFixed(3)))).concat(((frames[0].poly && frames[0].poly[i]) ? ((frames[0].poly[i].y * sy).toFixed(3)) : ((poly[i].y * sy).toFixed(3)))).join(';');
      const aCx = document.createElementNS(svgNS, 'animate'); aCx.setAttribute('attributeName','cx'); aCx.setAttribute('dur', `${dur}s`); aCx.setAttribute('values', cxVals); aCx.setAttribute('keyTimes', keyTimes); aCx.setAttribute('repeatCount','indefinite'); aCx.setAttribute('calcMode','linear'); el.appendChild(aCx);
      const aCy = document.createElementNS(svgNS, 'animate'); aCy.setAttribute('attributeName','cy'); aCy.setAttribute('dur', `${dur}s`); aCy.setAttribute('values', cyVals); aCy.setAttribute('keyTimes', keyTimes); aCy.setAttribute('repeatCount','indefinite'); aCy.setAttribute('calcMode','linear'); el.appendChild(aCy);
    }

    // Add grid debug labels (GV1..4 horizontally, GH1..3 vertically, GD1/GD2 diagonals)
    const makeTextPair = (idBase, x0, y0, fontPx0) => {
      // outline text (white stroke)
      const out = document.createElementNS(svgNS, 'text');
      out.setAttribute('x', x0.toFixed(3)); out.setAttribute('y', y0.toFixed(3)); out.setAttribute('fill','none'); out.setAttribute('stroke','#FFFFFF'); out.setAttribute('stroke-width', (3 * avgScale).toFixed(3)); out.setAttribute('font-family','Nebulica-Bold, Arial Black, Impact, sans-serif'); out.setAttribute('font-size', (fontPx0 * avgScale).toFixed(3) + 'px'); out.setAttribute('id', idBase + '_outline');
      // main text (cyan fill)
      const main = document.createElementNS(svgNS, 'text');
      main.setAttribute('x', x0.toFixed(3)); main.setAttribute('y', y0.toFixed(3)); main.setAttribute('fill', '#00FFFF'); main.setAttribute('font-family','Nebulica-Bold, Arial Black, Impact, sans-serif'); main.setAttribute('font-size', (fontPx0 * avgScale).toFixed(3) + 'px'); main.setAttribute('id', idBase + '_main');
      return { out, main };
    };

    // compute per-frame positions for the grid labels
    // GV (vertical labels) positions
    const gvPerFrame = frames.map(f => {
      const gx = f.grid.x, gw = f.grid.w, gy = f.grid.y;
      const vxs = [gx, gx + gw / 3, gx + (2 * gw) / 3, gx + gw];
      return vxs.map(vx => ({ x: (vx * sx).toFixed(3), y: ((gy + 4) * sy).toFixed(3) }));
    });
    // GH (horizontal labels)
    const ghPerFrame = frames.map(f => {
      const gx = f.grid.x, gw = f.grid.w, gy = f.grid.y, gh = f.grid.h;
      const my = gy + gh / 2;
      const hys = [gy, my, gy + gh];
      return hys.map(hy => ({ x: ((gx + 6) * sx).toFixed(3), y: (hy * sy).toFixed(3) }));
    });
    // GD positions
    const gdPerFrame = frames.map(f => {
      const gx = f.grid.x, gw = f.grid.w, gy = f.grid.y, gh = f.grid.h;
      const my = gy + gh / 2;
      const gd1 = { x: (gx + 0.35 * gw) * sx, y: (my + 0.35 * (gy - my)) * sy };
      const gd2 = { x: (gx + 0.65 * gw) * sx, y: (gy + 0.65 * (my - gy)) * sy };
      return [ { x: gd1.x.toFixed(3), y: gd1.y.toFixed(3) }, { x: gd2.x.toFixed(3), y: gd2.y.toFixed(3) } ];
    });

    // create GV labels
    for (let i = 0; i < 4; i++) {
      const p0 = gvPerFrame[0][i];
      const tpair = makeTextPair(`GV${i+1}`, Number(p0.x), Number(p0.y), 12);
      tpair.out.textContent = `GV${i+1}`; tpair.main.textContent = `GV${i+1}`;
      debugGroup.appendChild(tpair.out); debugGroup.appendChild(tpair.main);
      // animate x/y and font-size for outline and main
      const xs = gvPerFrame.map(g => g[i].x).concat(gvPerFrame[0][i].x).join(';');
      const ys = gvPerFrame.map(g => g[i].y).concat(gvPerFrame[0][i].y).join(';');
      const fzs = frames.map(f => ((12 * (f.master || 1) * avgScale).toFixed(3) + 'px')).concat((12 * (frames[0].master || 1) * avgScale).toFixed(3) + 'px').join(';');
      const aox = document.createElementNS(svgNS,'animate'); aox.setAttribute('attributeName','x'); aox.setAttribute('dur', `${dur}s`); aox.setAttribute('values', xs); aox.setAttribute('keyTimes', keyTimes); aox.setAttribute('repeatCount','indefinite'); aox.setAttribute('calcMode','linear'); tpair.out.appendChild(aox);
      const aoy = document.createElementNS(svgNS,'animate'); aoy.setAttribute('attributeName','y'); aoy.setAttribute('dur', `${dur}s`); aoy.setAttribute('values', ys); aoy.setAttribute('keyTimes', keyTimes); aoy.setAttribute('repeatCount','indefinite'); aoy.setAttribute('calcMode','linear'); tpair.out.appendChild(aoy);
      const afz = document.createElementNS(svgNS,'animate'); afz.setAttribute('attributeName','font-size'); afz.setAttribute('dur', `${dur}s`); afz.setAttribute('values', fzs); afz.setAttribute('keyTimes', keyTimes); afz.setAttribute('repeatCount','indefinite'); afz.setAttribute('calcMode','linear'); tpair.out.appendChild(afz);
      // main
      const ax = aox.cloneNode(); const ay = aoy.cloneNode(); const af = afz.cloneNode(); tpair.main.appendChild(ax); tpair.main.appendChild(ay); tpair.main.appendChild(af);
    }

    // create GH labels
    for (let i = 0; i < 3; i++) {
      const p0 = ghPerFrame[0][i];
      const tpair = makeTextPair(`GH${i+1}`, Number(p0.x), Number(p0.y), 12);
      tpair.out.textContent = `GH${i+1}`; tpair.main.textContent = `GH${i+1}`;
      debugGroup.appendChild(tpair.out); debugGroup.appendChild(tpair.main);
      const xs = ghPerFrame.map(g => g[i].x).concat(ghPerFrame[0][i].x).join(';');
      const ys = ghPerFrame.map(g => g[i].y).concat(ghPerFrame[0][i].y).join(';');
      const fzs = frames.map(f => ((12 * (f.master || 1) * avgScale).toFixed(3) + 'px')).concat((12 * (frames[0].master || 1) * avgScale).toFixed(3) + 'px').join(';');
      const aox = document.createElementNS(svgNS,'animate'); aox.setAttribute('attributeName','x'); aox.setAttribute('dur', `${dur}s`); aox.setAttribute('values', xs); aox.setAttribute('keyTimes', keyTimes); aox.setAttribute('repeatCount','indefinite'); aox.setAttribute('calcMode','linear'); tpair.out.appendChild(aox);
      const aoy = document.createElementNS(svgNS,'animate'); aoy.setAttribute('attributeName','y'); aoy.setAttribute('dur', `${dur}s`); aoy.setAttribute('values', ys); aoy.setAttribute('keyTimes', keyTimes); aoy.setAttribute('repeatCount','indefinite'); aoy.setAttribute('calcMode','linear'); tpair.out.appendChild(aoy);
      const afz = document.createElementNS(svgNS,'animate'); afz.setAttribute('attributeName','font-size'); afz.setAttribute('dur', `${dur}s`); afz.setAttribute('values', fzs); afz.setAttribute('keyTimes', keyTimes); afz.setAttribute('repeatCount','indefinite'); afz.setAttribute('calcMode','linear'); tpair.out.appendChild(afz);
      const ax = aox.cloneNode(); const ay = aoy.cloneNode(); const af = afz.cloneNode(); tpair.main.appendChild(ax); tpair.main.appendChild(ay); tpair.main.appendChild(af);
    }

    // create GD labels (two labels)
    for (let i = 0; i < 2; i++) {
      const p0 = gdPerFrame[0][i];
      const tpair = makeTextPair(`GD${i+1}`, Number(p0.x), Number(p0.y), 12);
      tpair.out.textContent = `GD${i+1}`; tpair.main.textContent = `GD${i+1}`;
      debugGroup.appendChild(tpair.out); debugGroup.appendChild(tpair.main);
      const xs = gdPerFrame.map(g => g[i].x).concat(gdPerFrame[0][i].x).join(';');
      const ys = gdPerFrame.map(g => g[i].y).concat(gdPerFrame[0][i].y).join(';');
      const fzs = frames.map(f => ((12 * (f.master || 1) * avgScale).toFixed(3) + 'px')).concat((12 * (frames[0].master || 1) * avgScale).toFixed(3) + 'px').join(';');
      const aox = document.createElementNS(svgNS,'animate'); aox.setAttribute('attributeName','x'); aox.setAttribute('dur', `${dur}s`); aox.setAttribute('values', xs); aox.setAttribute('keyTimes', keyTimes); aox.setAttribute('repeatCount','indefinite'); aox.setAttribute('calcMode','linear'); tpair.out.appendChild(aox);
      const aoy = document.createElementNS(svgNS,'animate'); aoy.setAttribute('attributeName','y'); aoy.setAttribute('dur', `${dur}s`); aoy.setAttribute('values', ys); aoy.setAttribute('keyTimes', keyTimes); aoy.setAttribute('repeatCount','indefinite'); aoy.setAttribute('calcMode','linear'); tpair.out.appendChild(aoy);
      const afz = document.createElementNS(svgNS,'animate'); afz.setAttribute('attributeName','font-size'); afz.setAttribute('dur', `${dur}s`); afz.setAttribute('values', fzs); afz.setAttribute('keyTimes', keyTimes); afz.setAttribute('repeatCount','indefinite'); afz.setAttribute('calcMode','linear'); tpair.out.appendChild(afz);
      const ax = aox.cloneNode(); const ay = aoy.cloneNode(); const af = afz.cloneNode(); tpair.main.appendChild(ax); tpair.main.appendChild(ay); tpair.main.appendChild(af);
    }

  } catch(e) { console.warn('debugGroup population failed', e); }

  // helper to create animate child
  const makeAnim = (parent, attrName, valuesStr) => {
    const a = document.createElementNS(svgNS, 'animate');
    a.setAttribute('attributeName', attrName);
    a.setAttribute('dur', `${dur}s`);
    a.setAttribute('repeatCount', 'indefinite');
    a.setAttribute('keyTimes', keyTimes);
    a.setAttribute('values', valuesStr);
    a.setAttribute('calcMode', 'linear');
    parent.appendChild(a);
    return a;
  };

  // Build scaled value strings for animation (map all sampled coords to display space)
  function valsScaled(key, scaleFn) {
    const arr = frames.map(f => scaleFn(f[key]));
    arr.push(arr[0]);
    return arr.join(';');
  }
  makeAnim(orb, 'cx', valsScaled('cx', v => (v * sx).toFixed(3)));
  makeAnim(orb, 'cy', valsScaled('cy', v => (v * sy).toFixed(3)));
  // animate radius (frames[].rc is stored as scaled radius)
  try {
    const rVals = frames.map(f => (f.rc * avgScale).toFixed(3));
    rVals.push(rVals[0]);
    makeAnim(orb, 'r', rVals.join(';'));
  } catch(e) { console.warn('orb r animate failed', e); }

  makeAnim(t1, 'x1', valsScaled('p1x', v => (v * sx).toFixed(3)));
  makeAnim(t1, 'y1', valsScaled('p1y', v => (v * sy).toFixed(3)));
  makeAnim(t1, 'x2', frames.map(f=> (f.a1x * sx).toFixed(3)).concat(((frames[0].a1x * sx).toFixed(3))).join(';'));
  makeAnim(t1, 'y2', frames.map(f=> (f.a1y * sy).toFixed(3)).concat(((frames[0].a1y * sy).toFixed(3))).join(';'));

  makeAnim(t2, 'x1', valsScaled('p2x', v => (v * sx).toFixed(3)));
  makeAnim(t2, 'y1', valsScaled('p2y', v => (v * sy).toFixed(3)));
  makeAnim(t2, 'x2', frames.map(f=> (f.a2x * sx).toFixed(3)).concat(((frames[0].a2x * sx).toFixed(3))).join(';'));
  makeAnim(t2, 'y2', frames.map(f=> (f.a2y * sy).toFixed(3)).concat(((frames[0].a2y * sy).toFixed(3))).join(';'));

  // Animate stroke-width for lines, polygon and orb using sampled lw values mapped to display
  try {
    const lwVals = frames.map(f => (f.lw * avgScale).toFixed(3)); lwVals.push(lwVals[0]);
    const lwStr = lwVals.join(';');
    const aLine1 = document.createElementNS(svgNS, 'animate');
    aLine1.setAttribute('attributeName','stroke-width'); aLine1.setAttribute('dur', `${dur}s`); aLine1.setAttribute('values', lwStr); aLine1.setAttribute('keyTimes', keyTimes); aLine1.setAttribute('repeatCount','indefinite'); aLine1.setAttribute('calcMode','linear');
    t1.appendChild(aLine1);
    const aLine2 = document.createElementNS(svgNS, 'animate');
    aLine2.setAttribute('attributeName','stroke-width'); aLine2.setAttribute('dur', `${dur}s`); aLine2.setAttribute('values', lwStr); aLine2.setAttribute('keyTimes', keyTimes); aLine2.setAttribute('repeatCount','indefinite'); aLine2.setAttribute('calcMode','linear');
    t2.appendChild(aLine2);

    // polygon stroke-width animate
    try {
      const polyLwVals = frames.map(f => (f.lw * avgScale).toFixed(3)); polyLwVals.push(polyLwVals[0]);
      const polyLwStr = polyLwVals.join(';');
      const ap = document.createElementNS(svgNS, 'animate');
      ap.setAttribute('attributeName','stroke-width'); ap.setAttribute('dur', `${dur}s`); ap.setAttribute('values', polyLwStr); ap.setAttribute('keyTimes', keyTimes); ap.setAttribute('repeatCount','indefinite'); ap.setAttribute('calcMode','linear');
      if (polyEl) polyEl.appendChild(ap);
    } catch(e){console.warn('poly stroke animate failed', e);}

    // orb stroke-width animate
    try {
      const orbLwVals = frames.map(f => (f.lw * avgScale).toFixed(3)); orbLwVals.push(orbLwVals[0]);
      const orbLwStr = orbLwVals.join(';');
      const ao = document.createElementNS(svgNS, 'animate');
      ao.setAttribute('attributeName','stroke-width'); ao.setAttribute('dur', `${dur}s`); ao.setAttribute('values', orbLwStr); ao.setAttribute('keyTimes', keyTimes); ao.setAttribute('repeatCount','indefinite'); ao.setAttribute('calcMode','linear');
      if (orb) orb.appendChild(ao);
    } catch(e){console.warn('orb stroke animate failed', e);}

  } catch(e) { console.warn('stroke-width animate failed', e); }

  // Animate stroke color for debug visuals (discrete switch between debug colors and normal foreground)
  try {
    const colorVals = frames.map(f => (f.debugFlag ? debugLineColor : foregroundRgb)).concat((frames[0].debugFlag ? debugLineColor : foregroundRgb)).join(';');
    // tangents
    const t1c = document.createElementNS(svgNS, 'animate'); t1c.setAttribute('attributeName','stroke'); t1c.setAttribute('dur', `${dur}s`); t1c.setAttribute('values', colorVals); t1c.setAttribute('keyTimes', keyTimes); t1c.setAttribute('repeatCount','indefinite'); t1c.setAttribute('calcMode','discrete'); t1.appendChild(t1c);
    const t2c = document.createElementNS(svgNS, 'animate'); t2c.setAttribute('attributeName','stroke'); t2c.setAttribute('dur', `${dur}s`); t2c.setAttribute('values', colorVals); t2c.setAttribute('keyTimes', keyTimes); t2c.setAttribute('repeatCount','indefinite'); t2c.setAttribute('calcMode','discrete'); t2.appendChild(t2c);
    // polygon
    if (polyEl) {
      const pc = document.createElementNS(svgNS, 'animate'); pc.setAttribute('attributeName','stroke'); pc.setAttribute('dur', `${dur}s`); pc.setAttribute('values', frames.map(f => (f.debugFlag ? debugHouseColor : foregroundRgb)).concat((frames[0].debugFlag ? debugHouseColor : foregroundRgb)).join(';')); pc.setAttribute('keyTimes', keyTimes); pc.setAttribute('repeatCount','indefinite'); pc.setAttribute('calcMode','discrete'); polyEl.appendChild(pc);
    }
    // orb
    if (orb) {
      const oc = document.createElementNS(svgNS, 'animate'); oc.setAttribute('attributeName','stroke'); oc.setAttribute('dur', `${dur}s`); oc.setAttribute('values', colorVals); oc.setAttribute('keyTimes', keyTimes); oc.setAttribute('repeatCount','indefinite'); oc.setAttribute('calcMode','discrete'); orb.appendChild(oc);
    }
    // debug markers (each child of debugGroup)
    try {
      const dbgVals = frames.map(f => (f.debugFlag ? debugHouseColor : foregroundRgb)).concat((frames[0].debugFlag ? debugHouseColor : foregroundRgb)).join(';');
      for (let i = 0; i < debugGroup.children.length; i++) {
        const c = debugGroup.children[i];
        const da = document.createElementNS(svgNS,'animate'); da.setAttribute('attributeName','stroke'); da.setAttribute('dur', `${dur}s`); da.setAttribute('values', dbgVals); da.setAttribute('keyTimes', keyTimes); da.setAttribute('repeatCount','indefinite'); da.setAttribute('calcMode','discrete'); c.appendChild(da);
      }
    } catch(e) { console.warn('debug marker color animate failed', e); }
  } catch(e) { console.warn('color animate failed', e); }

  // Animate polygon points if we sampled them
  try {
    if (polyEl && frames[0] && frames[0].poly) {
      const pointsPerFrame = frames.map(f => f.poly.map(p => `${(p.x * sx).toFixed(3)},${(p.y * sy).toFixed(3)}`).join(' '));
      // close loop
      pointsPerFrame.push(pointsPerFrame[0]);
      const pointsValues = pointsPerFrame.join(';');
      const aPts = document.createElementNS(svgNS, 'animate');
      aPts.setAttribute('attributeName', 'points');
      aPts.setAttribute('dur', `${dur}s`);
      aPts.setAttribute('repeatCount', 'indefinite');
      aPts.setAttribute('values', pointsValues);
      aPts.setAttribute('keyTimes', keyTimes);
      aPts.setAttribute('calcMode', 'linear');
      polyEl.appendChild(aPts);
    }
  } catch(e) { console.warn('poly animate failed', e); }

  // Animate orbit ellipse if present
  try {
    if (orbitEl) {
      // cx, cy
      const cxVals = frames.map(f => ((f.orbit.hx * sx).toFixed(3))).concat(((frames[0].orbit.hx * sx).toFixed(3))).join(';');
      const cyVals = frames.map(f => ((f.orbit.hy * sy).toFixed(3))).concat(((frames[0].orbit.hy * sy).toFixed(3))).join(';');
      const rxVals = frames.map(f => ((f.orbit.rx * sx).toFixed(3))).concat(((frames[0].orbit.rx * sx).toFixed(3))).join(';');
      const ryVals = frames.map(f => ((f.orbit.ry * sy).toFixed(3))).concat(((frames[0].orbit.ry * sy).toFixed(3))).join(';');
      const swVals = frames.map(f => ((1 * avgScale).toFixed(3))).concat(((1 * avgScale).toFixed(3))).join(';');
      const cxA = document.createElementNS(svgNS,'animate'); cxA.setAttribute('attributeName','cx'); cxA.setAttribute('dur', `${dur}s`); cxA.setAttribute('values', cxVals); cxA.setAttribute('keyTimes', keyTimes); cxA.setAttribute('repeatCount','indefinite'); cxA.setAttribute('calcMode','linear'); orbitEl.appendChild(cxA);
      const cyA = document.createElementNS(svgNS,'animate'); cyA.setAttribute('attributeName','cy'); cyA.setAttribute('dur', `${dur}s`); cyA.setAttribute('values', cyVals); cyA.setAttribute('keyTimes', keyTimes); cyA.setAttribute('repeatCount','indefinite'); cyA.setAttribute('calcMode','linear'); orbitEl.appendChild(cyA);
      const rxA = document.createElementNS(svgNS,'animate'); rxA.setAttribute('attributeName','rx'); rxA.setAttribute('dur', `${dur}s`); rxA.setAttribute('values', rxVals); rxA.setAttribute('keyTimes', keyTimes); rxA.setAttribute('repeatCount','indefinite'); rxA.setAttribute('calcMode','linear'); orbitEl.appendChild(rxA);
      const ryA = document.createElementNS(svgNS,'animate'); ryA.setAttribute('attributeName','ry'); ryA.setAttribute('dur', `${dur}s`); ryA.setAttribute('values', ryVals); ryA.setAttribute('keyTimes', keyTimes); ryA.setAttribute('repeatCount','indefinite'); ryA.setAttribute('calcMode','linear'); orbitEl.appendChild(ryA);
      const swA = document.createElementNS(svgNS,'animate'); swA.setAttribute('attributeName','stroke-width'); swA.setAttribute('dur', `${dur}s`); swA.setAttribute('values', swVals); swA.setAttribute('keyTimes', keyTimes); swA.setAttribute('repeatCount','indefinite'); swA.setAttribute('calcMode','linear'); orbitEl.appendChild(swA);

      // animate opacity based on showOrbitFlag
      const showOp = frames.map(f => (f.showOrbitFlag ? '1' : '0')).concat((frames[0].showOrbitFlag ? '1' : '0')).join(';');
      const opa = document.createElementNS(svgNS,'animate'); opa.setAttribute('attributeName','opacity'); opa.setAttribute('dur', `${dur}s`); opa.setAttribute('values', showOp); opa.setAttribute('keyTimes', keyTimes); opa.setAttribute('repeatCount','indefinite'); opa.setAttribute('calcMode','discrete'); orbitEl.appendChild(opa);
    }
  } catch(e){ console.warn('orbit animate failed', e); }

  // Animate grid lines' positions and stroke-width based on frames[].grid so grid scales with house
  try {
    // gridGroup children order: vertical1, vertical2, horizontal, diag1, diag2
    const gridChildren = gridGroup.children;
    if (gridChildren && gridChildren.length >= 5) {
      // helper to produce per-frame values for a given expression
      const mapGrid = (exprFn) => frames.map(f => exprFn(f.grid)).concat(exprFn(frames[0])).join(';');

      // vertical lines x positions
      const v1xVals = frames.map(f => ((f.grid.x + (f.grid.w / 3) * 1) * sx).toFixed(3)).concat(((frames[0].grid.x + (frames[0].grid.w/3)*1)*sx).toFixed(3)).join(';');
      const v2xVals = frames.map(f => ((f.grid.x + (f.grid.w / 3) * 2) * sx).toFixed(3)).concat(((frames[0].grid.x + (frames[0].grid.w/3)*2)*sx).toFixed(3)).join(';');
      const y1Vals = frames.map(f => (f.grid.y * sy).toFixed(3)).concat(((frames[0].grid.y * sy).toFixed(3))).join(';');
      const y2Vals = frames.map(f => ((f.grid.y + f.grid.h) * sy).toFixed(3)).concat(((frames[0].grid.y + frames[0].grid.h) * sy).toFixed(3)).join(';');

      // vertical 1
      const v1 = gridChildren[0];
      const v1xAnim = document.createElementNS(svgNS, 'animate'); v1xAnim.setAttribute('attributeName', 'x1'); v1xAnim.setAttribute('dur', `${dur}s`); v1xAnim.setAttribute('values', v1xVals); v1xAnim.setAttribute('keyTimes', keyTimes); v1xAnim.setAttribute('repeatCount','indefinite'); v1xAnim.setAttribute('calcMode','linear'); v1.appendChild(v1xAnim);
      const v1xAnim2 = document.createElementNS(svgNS, 'animate'); v1xAnim2.setAttribute('attributeName', 'x2'); v1xAnim2.setAttribute('dur', `${dur}s`); v1xAnim2.setAttribute('values', v1xVals); v1xAnim2.setAttribute('keyTimes', keyTimes); v1xAnim2.setAttribute('repeatCount','indefinite'); v1xAnim2.setAttribute('calcMode','linear'); v1.appendChild(v1xAnim2);
      const v1y1 = document.createElementNS(svgNS, 'animate'); v1y1.setAttribute('attributeName', 'y1'); v1y1.setAttribute('dur', `${dur}s`); v1y1.setAttribute('values', y1Vals); v1y1.setAttribute('keyTimes', keyTimes); v1y1.setAttribute('repeatCount','indefinite'); v1y1.setAttribute('calcMode','linear'); v1.appendChild(v1y1);
      const v1y2 = document.createElementNS(svgNS, 'animate'); v1y2.setAttribute('attributeName', 'y2'); v1y2.setAttribute('dur', `${dur}s`); v1y2.setAttribute('values', y2Vals); v1y2.setAttribute('keyTimes', keyTimes); v1y2.setAttribute('repeatCount','indefinite'); v1y2.setAttribute('calcMode','linear'); v1.appendChild(v1y2);

      // vertical 2
      const v2 = gridChildren[1];
      const v2xAnim = document.createElementNS(svgNS, 'animate'); v2xAnim.setAttribute('attributeName', 'x1'); v2xAnim.setAttribute('dur', `${dur}s`); v2xAnim.setAttribute('values', v2xVals); v2xAnim.setAttribute('keyTimes', keyTimes); v2xAnim.setAttribute('repeatCount','indefinite'); v2xAnim.setAttribute('calcMode','linear'); v2.appendChild(v2xAnim);
      const v2xAnim2 = document.createElementNS(svgNS, 'animate'); v2xAnim2.setAttribute('attributeName', 'x2'); v2xAnim2.setAttribute('dur', `${dur}s`); v2xAnim2.setAttribute('values', v2xVals); v2xAnim2.setAttribute('keyTimes', keyTimes); v2xAnim2.setAttribute('repeatCount','indefinite'); v2xAnim2.setAttribute('calcMode','linear'); v2.appendChild(v2xAnim2);
      const v2y1 = document.createElementNS(svgNS, 'animate'); v2y1.setAttribute('attributeName', 'y1'); v2y1.setAttribute('dur', `${dur}s`); v2y1.setAttribute('values', y1Vals); v2y1.setAttribute('keyTimes', keyTimes); v2y1.setAttribute('repeatCount','indefinite'); v2y1.setAttribute('calcMode','linear'); v2.appendChild(v2y1);
      const v2y2 = document.createElementNS(svgNS, 'animate'); v2y2.setAttribute('attributeName', 'y2'); v2y2.setAttribute('dur', `${dur}s`); v2y2.setAttribute('values', y2Vals); v2y2.setAttribute('keyTimes', keyTimes); v2y2.setAttribute('repeatCount','indefinite'); v2y2.setAttribute('calcMode','linear'); v2.appendChild(v2y2);

      // horizontal
      const h = gridChildren[2];
      const hx1Vals = frames.map(f => ((f.grid.x) * sx).toFixed(3)).concat(((frames[0].grid.x) * sx).toFixed(3)).join(';');
      const hx2Vals = frames.map(f => ((f.grid.x + f.grid.w) * sx).toFixed(3)).concat(((frames[0].grid.x + frames[0].grid.w) * sx).toFixed(3)).join(';');
      const hyVals = frames.map(f => ((f.grid.y + f.grid.h / 2) * sy).toFixed(3)).concat(((frames[0].grid.y + frames[0].grid.h / 2) * sy).toFixed(3)).join(';');
      const hhx1 = document.createElementNS(svgNS, 'animate'); hhx1.setAttribute('attributeName','x1'); hhx1.setAttribute('dur', `${dur}s`); hhx1.setAttribute('values', hx1Vals); hhx1.setAttribute('keyTimes', keyTimes); hhx1.setAttribute('repeatCount','indefinite'); hhx1.setAttribute('calcMode','linear'); h.appendChild(hhx1);
      const hhx2 = document.createElementNS(svgNS, 'animate'); hhx2.setAttribute('attributeName','x2'); hhx2.setAttribute('dur', `${dur}s`); hhx2.setAttribute('values', hx2Vals); hhx2.setAttribute('keyTimes', keyTimes); hhx2.setAttribute('repeatCount','indefinite'); hhx2.setAttribute('calcMode','linear'); h.appendChild(hhx2);
      const hhy = document.createElementNS(svgNS, 'animate'); hhy.setAttribute('attributeName','y1'); hhy.setAttribute('dur', `${dur}s`); hhy.setAttribute('values', hyVals); hhy.setAttribute('keyTimes', keyTimes); hhy.setAttribute('repeatCount','indefinite'); hhy.setAttribute('calcMode','linear'); h.appendChild(hhy);
      const hhy2 = document.createElementNS(svgNS, 'animate'); hhy2.setAttribute('attributeName','y2'); hhy2.setAttribute('dur', `${dur}s`); hhy2.setAttribute('values', hyVals); hhy2.setAttribute('keyTimes', keyTimes); hhy2.setAttribute('repeatCount','indefinite'); hhy2.setAttribute('calcMode','linear'); h.appendChild(hhy2);

      // diagonal 1
      const d1 = gridChildren[3];
      const d1x1 = frames.map(f => ((f.grid.x) * sx).toFixed(3)).concat(((frames[0].grid.x) * sx).toFixed(3)).join(';');
      const d1y1 = frames.map(f => ((f.grid.y + f.grid.h/2) * sy).toFixed(3)).concat(((frames[0].grid.y + frames[0].grid.h/2) * sy).toFixed(3)).join(';');
      const d1x2 = frames.map(f => (((f.grid.x + f.grid.w) * sx)).toFixed(3)).concat(((frames[0].grid.x + frames[0].grid.w) * sx).toFixed(3)).join(';');
      const d1y2 = frames.map(f => ((f.grid.y) * sy).toFixed(3)).concat(((frames[0].grid.y * sy)).toFixed(3)).join(';');
      const d1a = document.createElementNS(svgNS, 'animate'); d1a.setAttribute('attributeName','x1'); d1a.setAttribute('dur', `${dur}s`); d1a.setAttribute('values', d1x1); d1a.setAttribute('keyTimes', keyTimes); d1a.setAttribute('repeatCount','indefinite'); d1a.setAttribute('calcMode','linear'); d1.appendChild(d1a);
      const d1b = document.createElementNS(svgNS, 'animate'); d1b.setAttribute('attributeName','y1'); d1b.setAttribute('dur', `${dur}s`); d1b.setAttribute('values', d1y1); d1b.setAttribute('keyTimes', keyTimes); d1b.setAttribute('repeatCount','indefinite'); d1b.setAttribute('calcMode','linear'); d1.appendChild(d1b);
      const d1c = document.createElementNS(svgNS, 'animate'); d1c.setAttribute('attributeName','x2'); d1c.setAttribute('dur', `${dur}s`); d1c.setAttribute('values', d1x2); d1c.setAttribute('keyTimes', keyTimes); d1c.setAttribute('repeatCount','indefinite'); d1c.setAttribute('calcMode','linear'); d1.appendChild(d1c);
      const d1d = document.createElementNS(svgNS, 'animate'); d1d.setAttribute('attributeName','y2'); d1d.setAttribute('dur', `${dur}s`); d1d.setAttribute('values', d1y2); d1d.setAttribute('keyTimes', keyTimes); d1d.setAttribute('repeatCount','indefinite'); d1d.setAttribute('calcMode','linear'); d1.appendChild(d1d);

      // diagonal 2
      const d2 = gridChildren[4];
      const d2x1 = frames.map(f => ((f.grid.x) * sx).toFixed(3)).concat(((frames[0].grid.x) * sx).toFixed(3)).join(';');
      const d2y1 = frames.map(f => ((f.grid.y) * sy).toFixed(3)).concat(((frames[0].grid.y) * sy).toFixed(3)).join(';');
      const d2x2 = frames.map(f => (((f.grid.x + f.grid.w) * sx)).toFixed(3)).concat(((frames[0].grid.x + frames[0].grid.w) * sx).toFixed(3)).join(';');
      const d2y2 = frames.map(f => (((f.grid.y + f.grid.h/2) * sy)).toFixed(3)).concat(((frames[0].grid.y + frames[0].grid.h/2) * sy).toFixed(3)).join(';');
      const d2a = document.createElementNS(svgNS, 'animate'); d2a.setAttribute('attributeName','x1'); d2a.setAttribute('dur', `${dur}s`); d2a.setAttribute('values', d2x1); d2a.setAttribute('keyTimes', keyTimes); d2a.setAttribute('repeatCount','indefinite'); d2a.setAttribute('calcMode','linear'); d2.appendChild(d2a);
      const d2b = document.createElementNS(svgNS, 'animate'); d2b.setAttribute('attributeName','y1'); d2b.setAttribute('dur', `${dur}s`); d2b.setAttribute('values', d2y1); d2b.setAttribute('keyTimes', keyTimes); d2b.setAttribute('repeatCount','indefinite'); d2b.setAttribute('calcMode','linear'); d2.appendChild(d2b);
      const d2c = document.createElementNS(svgNS, 'animate'); d2c.setAttribute('attributeName','x2'); d2c.setAttribute('dur', `${dur}s`); d2c.setAttribute('values', d2x2); d2c.setAttribute('keyTimes', keyTimes); d2c.setAttribute('repeatCount','indefinite'); d2c.setAttribute('calcMode','linear'); d2.appendChild(d2c);
      const d2d = document.createElementNS(svgNS, 'animate'); d2d.setAttribute('attributeName','y2'); d2d.setAttribute('dur', `${dur}s`); d2d.setAttribute('values', d2y2); d2d.setAttribute('keyTimes', keyTimes); d2d.setAttribute('repeatCount','indefinite'); d2d.setAttribute('calcMode','linear'); d2.appendChild(d2d);

      // animate stroke-width for all grid children
      for (let i = 0; i < 5; i++) {
        const el = gridChildren[i];
        const swVals = frames.map(f => (1 * ((f.master || 1) * avgScale)).toFixed(3)).concat(((frames[0].master || 1) * avgScale).toFixed(3)).join(';');
        const asw = document.createElementNS(svgNS, 'animate'); asw.setAttribute('attributeName','stroke-width'); asw.setAttribute('dur', `${dur}s`); asw.setAttribute('values', swVals); asw.setAttribute('keyTimes', keyTimes); asw.setAttribute('repeatCount','indefinite'); asw.setAttribute('calcMode','linear'); el.appendChild(asw);
      }
    }
  } catch(e) { console.warn('grid animate failed', e); }

  // Add animated text that anchors bottom-left inside the grid and scales with masterScale
  try {
    if (S.showText) {
      const lines = S.textContent.split('\n');
      // For each line, create a text element positioned relative to the grid's bottom-left
      const textGroup = document.createElementNS(svgNS, 'g');
      textGroup.setAttribute('fill', `rgb(${colors.foreground.r}, ${colors.foreground.g}, ${colors.foreground.b})`);
      textGroup.setAttribute('font-family', 'Nebulica-Bold, Arial Black, Impact, sans-serif');
      svgEl.appendChild(textGroup);

      // compute per-frame anchor positions and font sizes
      const perFrameAnchors = frames.map(f => {
        const gx = f.grid.x + f.grid.w / 3; // centerGridX
        const gy = f.grid.y; // centerGridY
        const padding = (f.textPaddingRaw * f.master);
        const fontSize = (f.fontSizeRaw * f.master).toFixed(3);
        const textX = gx + padding;
        const textBottomY = gy + (f.grid.h / 2) - padding;
        return { textX: textX, textBottomY: textBottomY, fontSize };
      });

      for (let i = 0; i < lines.length; i++) {
        const t = document.createElementNS(svgNS, 'text');
        // initial pos from first frame scaled to display space
        const x0 = (perFrameAnchors[0].textX * sx).toFixed(3);
        const y0 = ((perFrameAnchors[0].textBottomY - (lines.length - 1 - i) * (perFrameAnchors[0].fontSize * S.lineHeight)) * sy).toFixed(3);
        t.setAttribute('x', x0);
        t.setAttribute('y', y0);
        t.textContent = lines[i];
  t.setAttribute('font-size', (perFrameAnchors[0].fontSize) + 'px');
        t.setAttribute('dominant-baseline', 'baseline');
        textGroup.appendChild(t);

        // build animate values for x, y and font-size
  const xs = perFrameAnchors.map(a => (a.textX * sx).toFixed(3)).concat(((perFrameAnchors[0].textX * sx).toFixed(3))).join(';');
  const ys = frames.map((f, idx) => ((perFrameAnchors[idx].textBottomY - (lines.length - 1 - i) * (perFrameAnchors[idx].fontSize * S.lineHeight)) * sy).toFixed(3)).concat(((perFrameAnchors[0].textBottomY - (lines.length - 1 - i) * (perFrameAnchors[0].fontSize * S.lineHeight)) * sy).toFixed(3)).join(';');
  const fzs = perFrameAnchors.map(a => (a.fontSize + 'px')).concat(perFrameAnchors[0].fontSize + 'px').join(';');

        const ax = document.createElementNS(svgNS, 'animate');
        ax.setAttribute('attributeName', 'x'); ax.setAttribute('dur', `${dur}s`); ax.setAttribute('values', xs); ax.setAttribute('keyTimes', keyTimes); ax.setAttribute('repeatCount','indefinite'); ax.setAttribute('calcMode','linear');
        const ay = document.createElementNS(svgNS, 'animate');
        ay.setAttribute('attributeName', 'y'); ay.setAttribute('dur', `${dur}s`); ay.setAttribute('values', ys); ay.setAttribute('keyTimes', keyTimes); ay.setAttribute('repeatCount','indefinite'); ay.setAttribute('calcMode','linear');
        const af = document.createElementNS(svgNS, 'animate');
        af.setAttribute('attributeName', 'font-size'); af.setAttribute('dur', `${dur}s`); af.setAttribute('values', fzs); af.setAttribute('keyTimes', keyTimes); af.setAttribute('repeatCount','indefinite'); af.setAttribute('calcMode','linear');

        t.appendChild(ax); t.appendChild(ay); t.appendChild(af);
      }
    }
  } catch(e) { console.warn('text animate failed', e); }

  // Animate grid and debug group opacity based on sampled flags
  try {
    const gridOp = frames.map(f => (f.showGridFlag ? '1' : '0')).concat((frames[0].showGridFlag ? '1':'0')).join(';');
    const gA = document.createElementNS(svgNS, 'animate');
    gA.setAttribute('attributeName','opacity'); gA.setAttribute('dur', `${dur}s`); gA.setAttribute('values', gridOp); gA.setAttribute('keyTimes', keyTimes); gA.setAttribute('repeatCount','indefinite'); gA.setAttribute('calcMode','discrete');
    gridGroup.appendChild(gA);

    const dbgOp = frames.map(f => (f.debugFlag ? '1' : '0')).concat((frames[0].debugFlag ? '1':'0')).join(';');
    const dA = document.createElementNS(svgNS, 'animate');
    dA.setAttribute('attributeName','opacity'); dA.setAttribute('dur', `${dur}s`); dA.setAttribute('values', dbgOp); dA.setAttribute('keyTimes', keyTimes); dA.setAttribute('repeatCount','indefinite'); dA.setAttribute('calcMode','discrete');
    debugGroup.appendChild(dA);
  } catch(e) { console.warn('grid/debug animate failed', e); }

  // serialize and download
  const s = new XMLSerializer();
  const svgString = s.serializeToString(svgEl);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename || 'animation.svg');
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

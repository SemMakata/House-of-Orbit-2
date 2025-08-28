// Simple Express server that converts uploaded WebM to MP4 using ffmpeg
// Usage: node server.js

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

// Allow reasonably large recordings and store in uploads/; default 2 GB but overridable via FFMPEG_UPLOAD_MAX
const UPLOAD_MAX = Number(process.env.FFMPEG_UPLOAD_MAX || (2 * 1024 * 1024 * 1024));
console.log('Server upload max bytes:', UPLOAD_MAX);
const upload = multer({ dest: 'uploads/', limits: { fileSize: UPLOAD_MAX } });
const app = express();
const os = require('os');
const PORT = process.env.PORT || 3333;
// By default bind to the machine's primary LAN IPv4 so the service is reachable on the LAN
// but not exposed via 0.0.0.0 which sometimes encourages accidental public tunnels.
const detectHost = () => {
  if (process.env.HOST) return process.env.HOST;
  try {
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch (e) {}
  // Fallback to localhost if nothing found
  return '127.0.0.1';
};
// Determine a readable LAN host for logging, but bind to 0.0.0.0 by default so the service
// is reachable from other machines and so startup logs are always printed when run via npm.
const LOG_HOST = detectHost();
const BIND_HOST = process.env.BIND || process.env.HOST || '0.0.0.0';

// Basic CORS middleware so the browser can POST from a different origin
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  // Allow Authorization header so the browser can include Basic auth without CORS blocking
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve the client files. Prefer `dist/` if present (build output), otherwise fall back to repo root.
const staticRoot = fs.existsSync(path.join(__dirname, 'dist')) ? path.join(__dirname, 'dist') : path.join(__dirname);
app.use(express.static(staticRoot));
// Ensure root serves index.html explicitly
app.get('/', (req, res) => {
  res.sendFile(path.join(staticRoot, 'index.html'));
});

// Simple GET handler to provide info for browsers visiting the endpoint
// Human-friendly info at the conversion endpoint base (/ffmpeg)
app.get('/ffmpeg', (req, res) => {
  res.send('<h3>Conversion endpoint</h3><p>POST a multipart/form-data with field <code>file</code> to this URL to convert a WebM to MP4. Use a POST request from your app to <code>/ffmpeg</code>.</p>');
});

// Keep a backwards-compatible alias at /convert for clients that expect the older path
app.get('/convert', (req, res) => {
  res.send('<h3>Conversion endpoint</h3><p>POST a multipart/form-data with field <code>file</code> to this URL to convert a WebM to MP4. Use a POST request from your app to <code>/convert</code> or <code>/ffmpeg</code>.</p>');
});

// Debug endpoint: return the effective ffmpeg configuration for troubleshooting
app.get('/ffmpeg-config', (req, res) => {
  const cfg = {
    FFMPEG_PRESET: process.env.FFMPEG_PRESET || 'medium',
    FFMPEG_CRF: process.env.FFMPEG_CRF || '18',
    FFMPEG_PROFILE: process.env.FFMPEG_PROFILE || 'high',
    FFMPEG_LEVEL: process.env.FFMPEG_LEVEL || '4.0',
    FFMPEG_AUDIO_BITRATE: process.env.FFMPEG_AUDIO_BITRATE || '192k',
    FFMPEG_TUNE: process.env.FFMPEG_TUNE || 'animation',
    FFMPEG_PIX_FMT: process.env.FFMPEG_PIX_FMT || 'yuv420p',
    FFMPEG_X264_PARAMS: process.env.FFMPEG_X264_PARAMS || 'aq-mode=3:aq-strength=1.0:deblock=0:trellis=2'
  };
  res.json({ ok: true, config: cfg });
});

// Basic auth configuration (optional). If both env vars are set, the server
// will require HTTP Basic auth for /convert.
const TUNNEL_USER = process.env.TUNNEL_USER || '';
const TUNNEL_PASS = process.env.TUNNEL_PASS || '';

function requireAuth(req, res, next) {
  if (!TUNNEL_USER || !TUNNEL_PASS) return next(); // auth not configured
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Conversion"');
    return res.status(401).send('Authentication required');
  }
  const creds = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
  const [user, pass] = creds.split(':');
  if (user === TUNNEL_USER && pass === TUNNEL_PASS) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Conversion"');
  return res.status(403).send('Forbidden');
}

// Primary conversion endpoint mounted at /ffmpeg so you can proxy it to
// https://houseofarts.semmakata.com/ffmpeg
// Accept uploads on both /ffmpeg and /convert for compatibility. Both paths route to the same handler.
app.post(['/ffmpeg', '/convert'], requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  // Log file metadata to help diagnose upload problems (size, mime)
  try {
    console.log('Received upload:', { originalname: req.file.originalname, path: req.file.path, mimetype: req.file.mimetype, size: req.file.size });
    // Log any text fields sent with the multipart request (for diagnostics)
    try { console.log('Multipart fields:', req.body); } catch(e) {}
  } catch(e){}
  const inputPath = req.file.path;
  // If client sent a 'client_sig' header hex, log it for correlation
  try {
    if (req.body && req.body.client_sig) {
      console.log('Client reported first-bytes hex:', String(req.body.client_sig).slice(0,128));
    }
  } catch (e) {}
  // Also read and log the first bytes of the uploaded file for comparison
  try {
    const fd = fs.openSync(inputPath, 'r');
    const sig = Buffer.alloc(32);
    fs.readSync(fd, sig, 0, sig.length, 0);
    fs.closeSync(fd);
    console.log('Server-side uploaded file header hex:', sig.toString('hex'));
  } catch (e) { console.warn('Could not read server-side uploaded file header for diagnostic:', e && e.message ? e.message : e); }
  // Quick sanity check: read the first bytes of the uploaded file and ensure it looks
  // like a media container we expect (WebM/EBML, MP4/ftyp, RIFF, etc.). If not,
  // fail fast with a helpful diagnostic so client-side uploads that were
  // accidentally truncated or mis-specified are easier to debug.
  try {
    const fd = fs.openSync(inputPath, 'r');
    const sig = Buffer.alloc(64);
    fs.readSync(fd, sig, 0, sig.length, 0);
    fs.closeSync(fd);
    const hex = sig.slice(0, 32).toString('hex');
    const ascii = sig.toString('ascii', 0, 16);
    const isEBML = sig.slice(0,4).equals(Buffer.from([0x1A,0x45,0xDF,0xA3])); // WebM/Matroska EBML header
    const hasFtyp = sig.toString('ascii').includes('ftyp'); // MP4-ish
    const hasRIFF = sig.toString('ascii', 0, 4) === 'RIFF';
    if (!isEBML && !hasFtyp && !hasRIFF) {
      // Delete the uploaded file and return a useful error for the client
      try { fs.unlinkSync(inputPath); } catch (e) {}
      console.warn('Uploaded file signature not recognized; first bytes (hex):', hex, 'ascii:', ascii);
      return res.status(400).send(`Uploaded file not recognized as WebM/MP4/RIFF. First bytes hex=${hex} ascii=${ascii}`);
    }
  } catch (sigErr) {
    console.warn('Could not read uploaded file signature for diagnostic:', sigErr && sigErr.message ? sigErr.message : sigErr);
    // Don't block processing on this; continue and let ffmpeg produce the canonical error if present
  }
  // If this is a test-only upload (helpful for client diagnostics), skip ffmpeg and return success
  try {
    const isTest = (req.body && (req.body.test === '1' || req.body.test === 'true' || req.body.testOnly === '1' || req.body.testOnly === 'true')) || req.headers['x-test-upload'];
    if (isTest) {
      const size = req.file.size || 0;
      // remove the uploaded file immediately
      fs.unlink(inputPath, () => {});
      return res.status(200).send(`TEST OK: received ${size} bytes`);
    }
  } catch (e) {}
  const outputName = `converted-${Date.now()}.mp4`;
  const outputPath = path.join('uploads', outputName);
  const logName = `converted-${Date.now()}.log`;
  const logPath = path.join('uploads', logName);

  // Always transcode to H.264 MP4 (libx264 + aac) to ensure compatibility
    // Quality tuning: allow environment overrides for CRF/preset/profile. Defaults favor higher visual quality
    // Default env-driven options (can be overridden per-quality below)
    const ENV_PRESET = process.env.FFMPEG_PRESET || 'medium'; // slower->better compression
    const ENV_CRF = process.env.FFMPEG_CRF || '18'; // lower -> higher quality (18 is visually lossless-ish)
    const ENV_PROFILE = process.env.FFMPEG_PROFILE || 'high';
    const ENV_LEVEL = process.env.FFMPEG_LEVEL || '4.0';
    const ENV_AUDIO_BITRATE = process.env.FFMPEG_AUDIO_BITRATE || '192k';
    const ENV_TUNE = process.env.FFMPEG_TUNE || 'animation';
  const ENV_PIX_FMT = process.env.FFMPEG_PIX_FMT || 'yuv420p';
  // Cap the encoded width to avoid huge frames that exceed H.264 level limits
  // Set FFMPEG_MAX_WIDTH to a number (e.g. 1920) to limit the output width. Use '0' or omit to disable (default = no clamp).
  const ENV_MAX_WIDTH = process.env.FFMPEG_MAX_WIDTH || '0';
    const ENV_X264_PARAMS = process.env.FFMPEG_X264_PARAMS || 'aq-mode=3:aq-strength=1.0:deblock=0:trellis=2';

    // Allow per-upload 'quality' hint: 'fast' | 'high' | 'best'. If not provided, use 'high'.
    const quality = (req.body && req.body.quality) ? String(req.body.quality).toLowerCase() : 'high';
    console.log('Requested quality:', quality);

    // Map quality presets to ffmpeg parameter sets
    let FFMPEG_PRESET = ENV_PRESET;
    let FFMPEG_CRF = ENV_CRF;
    let FFMPEG_PROFILE = ENV_PROFILE;
    let FFMPEG_LEVEL = ENV_LEVEL;
    let FFMPEG_AUDIO_BITRATE = ENV_AUDIO_BITRATE;
    let FFMPEG_TUNE = ENV_TUNE;
    let FFMPEG_PIX_FMT = ENV_PIX_FMT;
    let FFMPEG_X264_PARAMS = ENV_X264_PARAMS;

    if (quality === 'fast') {
      // Faster encode for quick previews or small files. Lower visual quality but faster runtime.
      FFMPEG_PRESET = process.env.FFMPEG_PRESET_FAST || 'fast';
      FFMPEG_CRF = process.env.FFMPEG_CRF_FAST || '24';
      FFMPEG_TUNE = process.env.FFMPEG_TUNE_FAST || 'fastdecode';
      FFMPEG_PIX_FMT = process.env.FFMPEG_PIX_FMT_FAST || 'yuv420p';
      FFMPEG_X264_PARAMS = process.env.FFMPEG_X264_PARAMS_FAST || 'aq-mode=1';
    } else if (quality === 'best') {
      // 'best' prioritizes archival visual fidelity. Use a very slow preset and low CRF.
      // These settings are intentionally heavy and produce large files for highest quality.
      FFMPEG_PRESET = process.env.FFMPEG_PRESET_BEST || 'veryslow';
      FFMPEG_CRF = process.env.FFMPEG_CRF_BEST || '14';
      FFMPEG_TUNE = process.env.FFMPEG_TUNE_BEST || 'animation';
      // Keep default pix_fmt as yuv420p for broad compatibility unless explicitly overridden.
      FFMPEG_PIX_FMT = process.env.FFMPEG_PIX_FMT_BEST || 'yuv420p';
      // Stronger x264 params tuned for animation/line-art to preserve fine edges.
      FFMPEG_X264_PARAMS = process.env.FFMPEG_X264_PARAMS_BEST || 'aq-mode=3:aq-strength=1.6:trellis=2:psy=1:psy-rd=1.0';
      FFMPEG_PROFILE = process.env.FFMPEG_PROFILE_BEST || 'high';
      FFMPEG_LEVEL = process.env.FFMPEG_LEVEL_BEST || '5.1';
    } else {
      // 'high' is the recommended general-purpose default: better than medium but faster than archive.
      FFMPEG_PRESET = process.env.FFMPEG_PRESET || 'slow';
      FFMPEG_CRF = process.env.FFMPEG_CRF || '16';
      FFMPEG_TUNE = process.env.FFMPEG_TUNE || ENV_TUNE;
      FFMPEG_PIX_FMT = process.env.FFMPEG_PIX_FMT || ENV_PIX_FMT;
      // Sensible defaults that improve perceived quality for line art without extreme file sizes
      FFMPEG_X264_PARAMS = process.env.FFMPEG_X264_PARAMS || 'aq-mode=3:aq-strength=1.0:trellis=2:psy=1:psy-rd=0.8';
    }

    // Per-upload codec choice: 'h264' or 'h265' (default h264)
    const requestedCodec = (req.body && req.body.codec) ? String(req.body.codec).toLowerCase() : 'h264';
    console.log('Requested codec:', requestedCodec);
    // Map well-known presets (sent by client) to concrete server-side hints
    // so uploads like 'youtube_hd' and 'youtube_4k' use tuned CRF/preset/bitrate.
    try {
      const preset = req.body && req.body.preset ? String(req.body.preset).toLowerCase() : '';
      if (preset) console.log('Requested preset:', preset);
      if (preset === 'youtube_hd') {
        // 1080p target, VBR with moderate bitrate; prefer CRF 'high' profile
        req.body.resolution = req.body.resolution || '1920x1080';
        req.body.target_bitrate = req.body.target_bitrate || process.env.FFMPEG_TARGET_BITRATE_HD || '25000000';
        req.body.format = req.body.format || 'mp4';
        req.body.codec = req.body.codec || 'h264';
        req.body.quality = req.body.quality || 'high';
      } else if (preset === 'youtube_4k') {
        req.body.resolution = req.body.resolution || '3840x2160';
        req.body.target_bitrate = req.body.target_bitrate || process.env.FFMPEG_TARGET_BITRATE_4K || '70000000';
        req.body.format = req.body.format || 'mp4';
        req.body.codec = req.body.codec || 'h264';
        req.body.quality = req.body.quality || 'high';
      } else if (preset === 'archive_hd') {
        req.body.resolution = req.body.resolution || '1920x1080';
        req.body.format = req.body.format || 'mov';
        req.body.codec = req.body.codec || 'prores';
        req.body.quality = req.body.quality || 'best';
      } else if (preset === 'archive_4k') {
        req.body.resolution = req.body.resolution || '3840x2160';
        req.body.format = req.body.format || 'mov';
        req.body.codec = req.body.codec || 'prores';
        req.body.quality = req.body.quality || 'best';
      }
    } catch (e) { console.warn('Preset mapping failed', e); }
    // Default command pieces for video/audio codec
    // Prefer H.264 by default and try to use a hardware encoder when available (macOS: videortoolbox, NVIDIA: nvenc, Intel: qsv)
    let videoCodec = 'libx264';
    let codecExtraArgs = [];
    // Helper: inspect ffmpeg encoders to decide hardware availability
    function ffmpegHasEncoder(name) {
      try {
        const list = execSync('ffmpeg -hide_banner -encoders', { encoding: 'utf8' });
        return list.toLowerCase().includes(name.toLowerCase());
      } catch (e) {
        return false;
      }
    }

    // Decide whether to use hardware H.264 encoders when available
    const preferHW = true;
    const platform = process.platform; // 'darwin', 'linux', 'win32'
    if (requestedCodec === 'h265' || requestedCodec === 'hevc' || requestedCodec === 'x265') {
      // HEVC requested explicitly: keep libx265 unless a hw hevc encoder is available and preferred
      if (preferHW && ffmpegHasEncoder('hevc_videotoolbox')) {
        videoCodec = 'hevc_videotoolbox';
      } else if (preferHW && ffmpegHasEncoder('hevc_nvenc')) {
        videoCodec = 'hevc_nvenc';
      } else {
        videoCodec = 'libx265';
        if (process.env.FFMPEG_X265_PARAMS) FFMPEG_X264_PARAMS = process.env.FFMPEG_X265_PARAMS;
      }
      if (quality === 'best') {
        FFMPEG_PRESET = process.env.FFMPEG_PRESET_BEST || 'veryslow';
        FFMPEG_CRF = process.env.FFMPEG_CRF_BEST || '18';
      }
      // For MP4 container compatibility with HEVC, set codec tag hvc1 so QuickTime can play on some platforms
      codecExtraArgs.push('-tag:v', 'hvc1');
      console.log('Using video codec:', videoCodec, 'preset:', FFMPEG_PRESET, 'crf:', FFMPEG_CRF);
    } else {
      // Default to H.264. Try platform-specific HW encoders first when present.
      if (preferHW && platform === 'darwin' && ffmpegHasEncoder('h264_videotoolbox')) {
        videoCodec = 'h264_videotoolbox';
      } else if (preferHW && ffmpegHasEncoder('h264_nvenc')) {
        videoCodec = 'h264_nvenc';
      } else if (preferHW && ffmpegHasEncoder('h264_qsv')) {
        videoCodec = 'h264_qsv';
      } else {
        videoCodec = 'libx264';
      }
      console.log('Using video codec:', videoCodec, 'preset:', FFMPEG_PRESET, 'crf:', FFMPEG_CRF);
    }

    // Only enable 4:4:4 encoding when explicitly requested via env or exact pix_fmt.
    // QuickTime (and many players) expect H.264 in yuv420p with a mainstream profile/level.
    const FORCE_444 = (process.env.FFMPEG_FORCE_444 === '1' || process.env.FFMPEG_FORCE_444 === 'true');
    // Allow per-upload override of pix_fmt (e.g. 'yuv444p') by including a multipart field 'pix_fmt'
    if (req.body && req.body.pix_fmt) {
      console.log('Per-upload pix_fmt requested:', req.body.pix_fmt);
      FFMPEG_PIX_FMT = String(req.body.pix_fmt).toLowerCase();
    }
    const pixLower = (FFMPEG_PIX_FMT || '').toLowerCase();
    const wantExplicit444 = pixLower === 'yuv444p' || FORCE_444;
    if (wantExplicit444) {
      FFMPEG_PROFILE = process.env.FFMPEG_PROFILE_444 || 'high444';
      FFMPEG_LEVEL = process.env.FFMPEG_LEVEL_444 || '5.1';
      console.log('Using explicit 4:4:4 profile/level for pix_fmt', FFMPEG_PIX_FMT, FFMPEG_PROFILE, FFMPEG_LEVEL);
    } else {
      // If an accidental '444' string exists in the env, override it to yuv420p for compatibility
      if (pixLower.includes('444')) {
        console.log('FFMPEG_PIX_FMT contained 4:4:4 but FFMPEG_FORCE_444 is not set; overriding to yuv420p for QuickTime compatibility');
        FFMPEG_PIX_FMT = 'yuv420p';
      }
    }

    // Ensure width/height are even (some encoders require even dimensions)
    // and use libx264 with yuv420p for broad compatibility. These defaults prioritize quality over speed.
  // Use a scale filter that downsizes very large inputs to a sane width while preserving aspect ratio
  // If ENV_MAX_WIDTH is '0' or empty, we keep the original size (but still make dimensions even).
  const maxW = Number(ENV_MAX_WIDTH) || 0;
  // Use proper ffmpeg scale filter syntax: scale=width:height:flags=lanczos
  // When using expressions, avoid extra quotes and separate options with ':'
  // Keep scale filter simple; use sws_flags for Lanczos resampling separately
  // Determine input width via ffprobe and only add a simple scale filter when needed.
  // This avoids complex expressions with commas that ffmpeg's filter parser misinterprets.
  let scaleFilter = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  // Allow per-upload request to skip automatic downscaling to ENV_MAX_WIDTH.
  // We still ensure even dimensions for encoder compatibility (libx264 requires even height/width).
  const noScale = req.body && (req.body.no_scale === '1' || req.body.no_scale === 'true');
  if (noScale) {
    console.log('Per-upload no_scale requested: preserving input resolution where possible; will ensure even dimensions for encoder');
    // Ensure width/height are even by using a trivial scale to nearest even values
    scaleFilter = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  } else if (maxW > 0) {
    try {
      // Use ffprobe to get the input video's width (safe, quick)
      const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 ${inputPath}`;
      const out = execSync(probeCmd, { encoding: 'utf8' }).trim();
      const inW = Number(out) || 0;
      console.log('ffprobe reported input width:', inW);
      if (inW > maxW) {
        // Simple, comma-free scale filter: scale=MAX:-2
        scaleFilter = `scale=${maxW}:-2`;
      }
    } catch (e) {
      console.warn('ffprobe failed or not available, falling back to safe scale filter:', String(e));
      // keep the safe even-dimensions expression
      scaleFilter = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    }
  }

  console.log('FFmpeg scale filter:', scaleFilter, ' (ENV_MAX_WIDTH=', ENV_MAX_WIDTH, ')');
  // Decide bitrate targets and profile/level based on final output resolution (HD vs 4K)
  // By default match frame rate of source (do not set -r).
  let targetIs4k = false;
  try {
    const probeW = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 ${inputPath}`, { encoding: 'utf8' }).trim();
    const inW = Number(probeW) || 0;
    if (inW >= 3840) targetIs4k = true;
  } catch (e) {
    // ignore probe failure; fall back to ENV_MAX_WIDTH/parity-preserving scale
  }

  // Allow per-upload resolution override (e.g. 'hd' or '4k')
  if (req.body && req.body.resolution) {
    const r = String(req.body.resolution).toLowerCase();
    if (r === '4k' || r === '3840' || r.includes('2160')) targetIs4k = true;
    if (r === 'hd' || r === '1080' || r.includes('1920')) targetIs4k = false;
  }

  // Bitrate targets (VBR 1-pass target bitrate)
  const targetBitrateEnv = targetIs4k ? (process.env.FFMPEG_TARGET_BITRATE_4K || '70000000') : (process.env.FFMPEG_TARGET_BITRATE_HD || '25000000');
  // Allow per-upload override of target bitrate (client sends bps as 'target_bitrate')
  let targetBitrate = Number(targetBitrateEnv) || 0;
  if (req.body && req.body.target_bitrate) {
    const tb = Number(String(req.body.target_bitrate).trim());
    if (!isNaN(tb) && tb > 0) targetBitrate = tb;
  }
  const clientForceBitrate = !!(req.body && (req.body.force_bitrate === '1' || req.body.force_bitrate === 'true'));
  // Use profile/level per user request
  const outProfile = targetIs4k ? (process.env.FFMPEG_PROFILE_4K || 'high') : (process.env.FFMPEG_PROFILE || 'high');
  const outLevel = targetIs4k ? (process.env.FFMPEG_LEVEL_4K || '5.2') : (process.env.FFMPEG_LEVEL || '4.2');

  // Build ffmpeg args conditionally: hardware encoders use bitrate; software libx264/libx265 keep CRF unless a bitrate override is requested
  const ffmpegArgs = ['-y', '-i', inputPath];
  if (scaleFilter) ffmpegArgs.push('-vf', scaleFilter, '-sws_flags', 'lanczos');
  ffmpegArgs.push('-c:v', videoCodec);

  const usingHW = !videoCodec.startsWith('libx');
  if (usingHW) {
    // Hardware encoders: use target bitrate (VBR 1pass) and set profile/level where supported
    ffmpegArgs.push('-b:v', String(targetBitrate));
    ffmpegArgs.push('-maxrate', String(Math.floor(Number(targetBitrate) * 1.5)));
    ffmpegArgs.push('-bufsize', String(Math.floor(Number(targetBitrate) * 2)));
    ffmpegArgs.push('-profile:v', outProfile);
    ffmpegArgs.push('-level', outLevel);
  } else {
    // Software encoders: keep CRF-based mode for visual quality unless an explicit bitrate env is set
    if (process.env.FFMPEG_FORCE_BITRATE === '1' || clientForceBitrate || (targetBitrate && targetBitrate > 0)) {
      // honor client or env-supplied bitrate
      ffmpegArgs.push('-b:v', String(targetBitrate));
      // Provide reasonable maxrate/bufsize for 1-pass VBR
      ffmpegArgs.push('-maxrate', String(Math.floor(Number(targetBitrate) * 1.5)));
      ffmpegArgs.push('-bufsize', String(Math.floor(Number(targetBitrate) * 2)));
    } else {
      ffmpegArgs.push('-preset', FFMPEG_PRESET);
      ffmpegArgs.push('-crf', FFMPEG_CRF);
    }
    ffmpegArgs.push('-pix_fmt', FFMPEG_PIX_FMT);
    ffmpegArgs.push('-tune', FFMPEG_TUNE);
    // x264 uses -x264-params, x265 uses -x265-params; pass the appropriate env param
    if (videoCodec === 'libx264') ffmpegArgs.push('-x264-params', FFMPEG_X264_PARAMS);
    else ffmpegArgs.push('-x265-params', (process.env.FFMPEG_X265_PARAMS || FFMPEG_X264_PARAMS));
    if (videoCodec === 'libx264') ffmpegArgs.push('-profile:v', outProfile, '-level', outLevel);
  }

  // include any codec extra args (e.g., -tag:v hvc1 for HEVC in mp4)
  ffmpegArgs.push(...codecExtraArgs);
  // Set color metadata to avoid flicker caused by color space/transfer inference
  ffmpegArgs.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
  ffmpegArgs.push('-c:a', 'aac', '-b:a', FFMPEG_AUDIO_BITRATE, '-movflags', '+faststart', outputPath);

  // Support two-pass VBR when requested by client (only for H.264 MP4 path)
  const vbrPass = req.body && (req.body.vbr_pass === '2' || req.body.vbr_pass === '1') ? String(req.body.vbr_pass) : null;
  const requestedFormat = req.body && req.body.format ? String(req.body.format).toLowerCase() : 'mp4';

  // If client requested ProRes (mov) output, adjust args accordingly
  if (requestedFormat === 'mov' && (req.body && (req.body.codec === 'prores' || req.body.codec === 'prores4444'))) {
    // Use prores_ks for good compatibility; prores_ks supports profile selection
    const proresCodec = req.body.codec === 'prores4444' ? 'prores_ks' : 'prores_ks';
    // Rebuild args for ProRes MOV output
    // Ensure output uses .mov extension so muxer is correct
    const proresOutputName = `converted-${Date.now()}.mov`;
    const proresOutputPath = path.join('uploads', proresOutputName);
    const proresArgs = ['-y', '-i', inputPath, '-c:v', proresCodec, '-profile:v', (req.body.codec === 'prores4444' ? '4' : '3'), '-pix_fmt', (req.body.codec === 'prores4444' ? 'yuv444p10le' : 'yuv422p10le'), '-c:a', 'pcm_s16le', '-f', 'mov', proresOutputPath];
    console.log('Using ProRes output args:', proresArgs.join(' '));
    // Spawn ffmpeg for ProRes output
    const ffP = spawn('ffmpeg', proresArgs);
    let proresStderr = '';
    ffP.stderr.on('data', d => { proresStderr += d.toString(); d.toString().split(/\r?\n/).forEach(l => { if (l.trim()) console.log('ffmpeg:', l); }); });
    ffP.on('close', (code) => {
      try { fs.writeFileSync(logPath, proresStderr || ''); console.log('Wrote ffmpeg log to', logPath); } catch (e) {}
      if (code !== 0) {
        fs.unlink(inputPath, () => {});
        // Attempt to surface a helpful ffmpeg snippet
        const snippet = proresStderr ? proresStderr.slice(0, 8 * 1024) : '';
        return res.status(500).send(`ProRes conversion failed (exit ${code}). ffmpeg log: ${logName}\n\n${snippet}`);
      }
      // stream result back
      res.setHeader('Content-Type', 'video/quicktime');
      res.setHeader('Content-Disposition', `attachment; filename="${proresOutputName}"`);
      const s = fs.createReadStream(proresOutputPath);
      s.on('end', () => { fs.unlink(inputPath, () => {}); fs.unlink(proresOutputPath, () => {}); });
      s.pipe(res);
    });
    return;
  }

  // Handle 2-pass VBR when requested and when using libx264/MP4
  if (vbrPass === '2' && videoCodec === 'libx264' && requestedCodec === 'h264') {
    try {
      const passLog = path.join('uploads', `ffmpeg-passlog-${Date.now()}`);
      // First pass: write stats
      const pass1 = ['-y', '-i', inputPath, ...(scaleFilter ? ['-vf', scaleFilter] : []), '-c:v', 'libx264', '-b:v', String(targetBitrate), '-maxrate', String(Math.floor(Number(targetBitrate) * 1.5)), '-bufsize', String(Math.floor(Number(targetBitrate) * 2)), '-pass', '1', '-an', '-f', 'mp4', '/dev/null'];
      console.log('Running 2-pass first pass:', pass1.join(' '));
      execSync(['ffmpeg', ...pass1].join(' '), { stdio: 'inherit' });
      // Second pass: produce file
      const pass2 = ['-y', '-i', inputPath, ...(scaleFilter ? ['-vf', scaleFilter] : []), '-c:v', 'libx264', '-b:v', String(targetBitrate), '-maxrate', String(Math.floor(Number(targetBitrate) * 1.5)), '-bufsize', String(Math.floor(Number(targetBitrate) * 2)), '-pass', '2', '-c:a', 'aac', '-b:a', FFMPEG_AUDIO_BITRATE, outputPath];
      console.log('Running 2-pass second pass:', pass2.join(' '));
      execSync(['ffmpeg', ...pass2].join(' '), { stdio: 'inherit' });
      // Write a simple log (ffmpeg prints to console)
      fs.writeFileSync(logPath, `2-pass conversion completed`);
    } catch (e) {
      console.error('2-pass conversion failed:', e);
      fs.unlink(inputPath, () => {});
      return res.status(500).send('2-pass conversion failed: ' + String(e));
    }
  }

  // Basic sanity-check: ensure uploaded file exists and is non-empty before running ffmpeg
  try {
    const st = fs.statSync(inputPath);
    if (!st || !st.size || st.size < 32) {
      console.error('Uploaded file is empty or too small:', inputPath, st && st.size);
      fs.unlink(inputPath, () => {});
      return res.status(400).send('Uploaded file is empty or too small');
    }
  } catch (e) {
    console.error('Could not stat uploaded file:', e);
    fs.unlink(inputPath, () => {});
    return res.status(500).send('Uploaded file missing');
  }

  console.log('Spawning ffmpeg with args:', ffmpegArgs.join(' '));
  // Helper to run ffmpeg and capture stderr; returns a Promise that resolves {code, stderr}
  const runFfmpeg = (args) => new Promise((resolve, reject) => {
    console.log('Running ffmpeg:', ['ffmpeg', ...args].join(' '));
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', d => { const s = d.toString(); stderr += s; s.split(/\r?\n/).forEach(l => { if (l.trim()) console.log('ffmpeg:', l); }); });
    proc.on('error', (err) => { console.error('Failed to start ffmpeg:', err); resolve({ code: 127, stderr: String(err) }); });
    proc.on('close', (code) => { resolve({ code: Number(code), stderr }); });
  });

  (async () => {
    let attemptArgs = ffmpegArgs.slice();
    // First try: prefer hardware encoder when available (constructed earlier)
    let first = await runFfmpeg(attemptArgs);
    // If first attempt failed due to hardware encoder init error, try software libx264 fallback
    const hwErrorPatterns = ['cannot prepare encoder', 'Error while opening encoder', 'Could not open encoder', 'Error: cannot prepare encoder', 'Task finished with error code', 'Invalid argument'];
    const firstFailed = first.code !== 0;
    const firstStderr = first.stderr || '';
    if (firstFailed) {
      // persist initial attempt stderr for diagnostics
      try { fs.writeFileSync(logPath + '.attempt1', firstStderr || ''); } catch (e) {}
    }
    const shouldFallbackToSoftware = firstFailed && hwErrorPatterns.some(p => firstStderr.includes(p) || firstStderr.toLowerCase().includes(p.toLowerCase())) && videoCodec && !videoCodec.startsWith('libx');
    if (shouldFallbackToSoftware) {
      console.warn('Hardware encoder failed; falling back to software libx264 for robustness. See', logPath + '.attempt1');
      // Build software args from original but force libx264 software path
      const swArgs = ['-y', '-i', inputPath];
      if (scaleFilter) swArgs.push('-vf', scaleFilter, '-sws_flags', 'lanczos');
      swArgs.push('-c:v', 'libx264');
      // Prefer CRF mode for software encoding for quality
      if (process.env.FFMPEG_FORCE_BITRATE === '1' || clientForceBitrate || (targetBitrate && targetBitrate > 0)) {
        swArgs.push('-b:v', String(targetBitrate));
        swArgs.push('-maxrate', String(Math.floor(Number(targetBitrate) * 1.5)));
        swArgs.push('-bufsize', String(Math.floor(Number(targetBitrate) * 2)));
      } else {
        swArgs.push('-preset', FFMPEG_PRESET);
        swArgs.push('-crf', FFMPEG_CRF);
      }
      swArgs.push('-pix_fmt', FFMPEG_PIX_FMT);
      swArgs.push('-tune', FFMPEG_TUNE);
      if (videoCodec === 'libx264') swArgs.push('-x264-params', FFMPEG_X264_PARAMS);
      swArgs.push('-profile:v', outProfile, '-level', outLevel);
      swArgs.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
      swArgs.push('-c:a', 'aac', '-b:a', FFMPEG_AUDIO_BITRATE, '-movflags', '+faststart', outputPath);

      const second = await runFfmpeg(swArgs);
      // Write combined logs
      try { fs.writeFileSync(logPath, (firstStderr || '') + '\n---- FALLBACK to software ----\n' + (second.stderr || '')); console.log('Wrote ffmpeg log to', logPath); } catch (e) { console.error('Failed to write ffmpeg log:', e); }

      if (second.code !== 0) {
        // cleanup input
        try { fs.unlinkSync(inputPath); } catch (e) {}
        const snippet = second.stderr ? second.stderr.slice(0, 8 * 1024) : '';
        return res.status(500).send(`Conversion failed (ffmpeg exit ${second.code}). ffmpeg log: ${logName}\n\n${snippet}`);
      }

      // success with software fallback: stream result
      try { const stream = fs.createReadStream(outputPath); res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
        stream.on('end', () => { try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch (e) {} });
        stream.pipe(res);
        return;
      } catch (e) {
        try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch (err) {}
        return res.status(500).send('Error streaming converted file: ' + String(e));
      }
    }

    // If first attempt succeeded, write log and stream output
    if (first.code === 0) {
      try { fs.writeFileSync(logPath, firstStderr || ''); console.log('Wrote ffmpeg log to', logPath); } catch (e) { console.error('Failed to write ffmpeg log:', e); }
      try {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
        const stream = fs.createReadStream(outputPath);
        stream.on('error', (err) => {
          console.error('Error reading output file:', err);
          const snippet = firstStderr ? firstStderr.slice(0, 8 * 1024) : '';
          res.status(500).send('Error reading converted file: ' + (err.message || String(err)) + '\n' + snippet);
          try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch (e) {}
        });
        stream.on('end', () => { try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch (e) {} });
        stream.pipe(res);
        return;
      } catch (e) {
        try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch (err) {}
        return res.status(500).send('Streaming error: ' + String(e));
      }
    }

    // Otherwise, first attempt failed and did not match hw failure patterns: report initial failure
    try { fs.writeFileSync(logPath, firstStderr || ''); console.log('Wrote ffmpeg log to', logPath); } catch (e) { console.error('Failed to write ffmpeg log:', e); }
    try { fs.unlinkSync(inputPath); } catch (e) {}
    const snippet = firstStderr ? firstStderr.slice(0, 8 * 1024) : 'No ffmpeg stderr captured';
    return res.status(500).send(`Conversion failed (ffmpeg exit ${first.code}). ffmpeg log: ${logName}\n\n${snippet}`);
  })();
});

// Simple diagnostic: list recent files in uploads/ (safe for LAN-only use)
app.get('/uploads-list', (req, res) => {
  try {
    const files = fs.readdirSync(path.join(__dirname, 'uploads'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(__dirname,'uploads',f)).mtimeMs }))
      .sort((a,b) => b.mtime - a.mtime)
      .slice(0, 40);
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, BIND_HOST, () => {
  // Print helpful addresses so you can use the server from other devices and from the local machine.
  console.log(`Conversion server listening (bound) on ${BIND_HOST}:${PORT}`);
  // Helpful quick links
  console.log(` - http://localhost:${PORT}`);
  if (BIND_HOST !== '127.0.0.1' && BIND_HOST !== 'localhost') {
    console.log(` - http://${BIND_HOST}:${PORT}  (bind)`);
  }
  try {
    const nets = os.networkInterfaces();
    Object.keys(nets).forEach((name) => {
      for (const net of nets[name]) {
        // Show IPv4 non-internal addresses
        if (net.family === 'IPv4' && !net.internal) {
          console.log(` - http://${net.address}:${PORT}`);
        }
      }
    });
  } catch (e) {}
  console.log('Requires ffmpeg installed and available on PATH');
});

House of Orbit — local conversion server and UI

What's in this folder
- `index.html` — main UI + p5 canvas. This is the page you should open in the browser.
- `sketch.js` — main p5.js application, recording/export and server upload logic.
- `style.css` — UI styles used by `index.html`.
- `server.js` — small Express server that accepts uploaded WebM and converts to MP4 using system `ffmpeg`.
- `uploads/` — temporary upload directory (created by multer at runtime).
- `libraries/` — p5 and other libraries used by the client.

Quick start — server (LAN-only converter)
1. Install Node.js (v16+ recommended) and ffmpeg available on PATH. On macOS you can use Homebrew:

```bash
brew install node ffmpeg
```

2. From this project folder, install dependencies:

```bash
npm install express multer
```

3. Start the conversion server (binds to localhost by default):

```bash
node server.js
```

The server will log its listening address (typically http://localhost:3333 when run locally). If you deploy behind a reverse proxy set the client `convert URL` to the public domain, for example `https://houseoforbit.semmakata.com/convert`.

Notes & troubleshooting
- The server expects a multipart POST with field `file`. The client already handles this automatically.
- For quick testing there's an "Upload Test Blob" button in the UI which uploads a synthetic test file and will not run ffmpeg.
- If conversion fails, check `server.log` for ffmpeg stderr and the browser's on-page `clientLog` element for client-side diagnostics.

Security
- This server binds to localhost by default to avoid accidental public exposure. If you expose it publicly, add authentication, rate-limits, and TLS.

If you want me to also remove the `uploads/` directory after tests or add a simple npm script to start the server, tell me and I'll add it.

Confirmed: npm start
- Running `npm start` (or `npm run start-server`) will launch the conversion server (same as `node server.js`). If you saw a port-in-use error (EADDRINUSE), either run the convenience restart helper below or free the port manually (see troubleshooting).

Port conflict quick fixes
- Use the restart helper which kills any previous local server instance and starts a fresh one (macOS friendly):

```bash
npm run restart
```

- Or free the port manually (example for macOS / zsh):

```bash
lsof -nP -iTCP:3333 -sTCP:LISTEN
# note the PID from the output, then:
kill <PID>
npm start
```

NPM helper scripts
- Start server:

```bash
npm run start-server
```

- Start server and open the UI (macOS only):

```bash
npm run start-and-open
```

- Clean uploads older than 60 minutes:

```bash
npm run clean-uploads
```

You can override the default age (minutes) when cleaning:

```bash
AGE_MINUTES=30 npm run clean-uploads
```

Convenience restart (macOS)
- Restart the server and open the UI in one command:

```bash
npm run restart
```

This runs `scripts/restart-server.sh` which kills any running `node server.js` processes in this folder, starts the server, opens `index.html` (macOS only), and tails `server.log`.

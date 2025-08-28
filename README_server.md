Server conversion helper

This small Node.js server receives a WebM upload and converts it to an MP4 using ffmpeg, then returns the MP4 file.

Prerequisites
- Node.js (14+)
- ffmpeg available on PATH

Install and run

```bash
npm install
node server.js
```

The server binds to localhost (127.0.0.1) by default for safety; to expose it to your LAN set HOST or BIND to 0.0.0.0 when starting the server.

Endpoint
- POST /convert
  - Form field name: file
  - Returns: MP4 file as response download

Usage
- If running locally and you want the client to upload to the local converter, point the client to `http://localhost:3333/convert`.
- For a deployed site behind a reverse proxy, set `SERVER_CONVERT_URL` in `sketch.js` to `https://houseoforbit.semmakata.com/convert`.
Note about network exposure
- By default this server binds to `127.0.0.1` to avoid accidental public exposure. To make it listen on all interfaces use:

```bash
HOST=0.0.0.0 node server.js
```

If you run the server behind a reverse proxy (recommended for public hosting) configure your proxy to route `/convert` or `/ffmpeg` to `http://127.0.0.1:3333/convert`.
- If you want the server to be strictly localhost-only (not accessible from other devices), start it with:

```bash
HOST=127.0.0.1 node server.js
```

- Do not run tunnels (ngrok, localtunnel) if you want to avoid exposing the service to the public internet.
- After recording ends, the client will upload the WebM blob and will download the converted MP4.

Optional: Basic auth for the tunnel
- You can protect the endpoint with simple HTTP Basic auth by exporting env vars before starting the server:

```bash
export TUNNEL_USER=myuser
export TUNNEL_PASS=mypassword
node server.js
```

- In `sketch.js`, set `SERVER_CONVERT_AUTH` to the base64-encoded credentials or set `SERVER_CONVERT_USER`/`SERVER_CONVERT_PASS` and the client will include the Authorization header automatically.

Quick curl test example:

```bash
curl -v -F file=@/path/to/recording.webm http://localhost:3333/convert -o output.mp4
file output.mp4
```

Security note
- This server is a simple helper for local use. For public use, add authentication, rate-limits, and input validation.

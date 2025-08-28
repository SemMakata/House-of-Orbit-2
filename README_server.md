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

The server binds to all interfaces (0.0.0.0) by default so you can access it from other devices on your LAN.

Endpoint
- POST /convert
  - Form field name: file
  - Returns: MP4 file as response download

Usage
- Find your machine's LAN IP address. When you run `node server.js` it will print addresses like `http://192.168.1.45:3333`.
 - Find your machine's LAN IP address. When you run `node server.js` it will print addresses like `http://192.168.2.5:3333`.
 - Set `SERVER_CONVERT_URL` in `sketch.js` to point to the server using your machine IP, e.g.: `http://192.168.2.5:3333/convert`.
Note about network exposure
- By default this server now binds to your machine's primary LAN IPv4 address so it will be reachable by other devices on the same local network (for example `http://192.168.2.5:3333`). This is intended for LAN-only use.
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
curl -v -F file=@/path/to/recording.webm http://192.168.2.5:3333/convert -o output.mp4
file output.mp4
```

Security note
- This server is a simple helper for local use. For public use, add authentication, rate-limits, and input validation.

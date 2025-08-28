How to prepare this project for upload to a static web host

This repo is a small client-side p5.js sketch with an optional small server for converting WebM→MP4.
If you only want to host the client (the sketch and assets) on a web server (GitHub Pages, nginx, Apache, plain hosting), you can produce a `dist/` folder that contains everything needed.

Steps

1. From the project root, run:

```bash
npm run build
```

2. After the script finishes, a `dist/` folder will be created. Upload the entire contents of `dist/` to your webserver.

Notes

- The build script is intentionally simple: it copies `index.html`, `sketch.js`, `style.css`, `libraries/`, and a few config files into `dist/`.
- You don't need to run `npm start` on the hosting server — the `dist/` upload is static. If you want the server-side WebM→MP4 conversion endpoint, keep `server.js` and use `npm start` on a server running Node.
- If you want the exported SVG/PNG/MP4 features to POST to the conversion endpoint, you'll need to deploy `server.js` separately where Node/ffmpeg are available.

If you'd like, I can also:
- Minify/concatenate `sketch.js` and `style.css` for a smaller bundle.
- Add a simple index rewrite or 404 fallback if your host needs it.
- Add a GitHub Actions workflow that builds and deploys to GitHub Pages automatically.

## Deploying the static site + conversion endpoint to houseofarts.semmakata.com

If you want a single server to host both the static site and the ffmpeg conversion endpoint at `https://houseofarts.semmakata.com` (with the conversion API available at `https://houseofarts.semmakata.com/ffmpeg`), here is a simple approach using nginx as a reverse proxy and systemd to manage the Node process.

1) Build the static bundle locally and upload `dist/` to the server's web root (e.g. `/var/www/houseofarts`):

```bash
npm run build
# upload the contents of dist/ to /var/www/houseofarts on your server (scp/rsync)
```

2) Copy `server.js`, `uploads/` folder, and `node_modules` (or install deps there) to a directory on the server, e.g. `/opt/ho-converter`.

3) Example nginx site config (Ubuntu/Debian: `/etc/nginx/sites-available/houseofarts`):

```nginx
server {
  listen 80;
  server_name houseofarts.semmakata.com;

  # Serve static files directly from the uploaded dist/ folder
  root /var/www/houseofarts;
  index index.html;

  location / {
    try_files $uri $uri/ =404;
  }

  # Proxy /ffmpeg to the Node conversion service
  location /ffmpeg/ {
    proxy_pass http://127.0.0.1:3333/ffmpeg/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 4G; # allow large uploads
    proxy_connect_timeout 300;
    proxy_send_timeout 3600;
    proxy_read_timeout 3600;
  }

  # Optionally: HSTS, redirect HTTP->HTTPS if you configure TLS
}
```

Enable and test nginx config, then reload nginx.

4) Example `systemd` service for the converter (`/etc/systemd/system/ho-converter.service`):

```ini
[Unit]
Description=House of Orbit ffmpeg converter
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ho-converter
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=3333
Environment=HOST=127.0.0.1

[Install]
WantedBy=multi-user.target
```

After creating the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ho-converter
sudo journalctl -u ho-converter -f
```

5) DNS & TLS

- Point `houseofarts.semmakata.com` A record to your server's public IP.
- For TLS/HTTPS, use Certbot to obtain a Let's Encrypt certificate and enable HTTPS in nginx. If you enable HTTPS, update nginx to listen on 443 and redirect 80 to 443.

Security notes

- The `/ffmpeg` endpoint can accept large uploads and will consume CPU and disk while ffmpeg runs. Consider restricting access with HTTP Basic auth (set `TUNNEL_USER` and `TUNNEL_PASS` environment variables for the Node service), or restrict by IP when possible.
- Ensure the server has enough disk space under `uploads/` and that regular cleanup is scheduled (there is a `scripts/clean-uploads.js` placeholder script).

If you'd like, I can:
- Add a ready-to-use `systemd` unit file and an example nginx config in the repo.
- Add an optional basic-auth wrapper for the `/ffmpeg` endpoint using environment variables (already supported by the server via `TUNNEL_USER`/`TUNNEL_PASS`).

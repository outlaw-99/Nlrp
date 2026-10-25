# NAIJALIFE NLRP - Live Server Status Website

Shows live players, ping, who's online, a 24h player graph and join buttons.
No packages to install. Needs Node.js 16 or newer.

## Run it
    SAMP_HOST=YOUR.SERVER.IP SAMP_PORT=7777 PORT=3000 node server.js

Then open http://localhost:3000

Windows (PowerShell):
    $env:SAMP_HOST="YOUR.SERVER.IP"; $env:SAMP_PORT="7777"; node server.js

## Settings (environment variables)
- SAMP_HOST   game server IP (required, use the real IP, not a domain)
- SAMP_PORT   game server port (default 7777)
- PORT        website port (default 3000)
- DISCORD     Discord invite link (default https://discord.gg/Ytz73CtpRq)
- SERVER_NAME name shown in the API (default NAIJALIFE NLRP)

## Keep it running (VPS)
    npm i -g pm2
    SAMP_HOST=YOUR.SERVER.IP pm2 start server.js --name nlrp-site
    pm2 save && pm2 startup

Put it behind nginx/Caddy or a Cloudflare Tunnel for a domain and HTTPS.

## Notes
- The website must run on a machine that can reach the game server's UDP query port
  (the same port players connect on). Most hosts allow this by default.
- The "Players, last 24 hours" graph fills up from when the site starts (kept in memory).
- If the game server hides its player list (some servers do when 100+ are online),
  the player count still shows but the table will say the list is hidden.
- JSON feed for other tools (Discord bots etc.): /api/status
- Test without a real server:  node mock-samp.js   (fake server on UDP 7777)

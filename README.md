# NAIJA LIFE ROLEPLAY (`NL:RP`) — Suggestions & Live Players Website

A clean, standalone Node.js + Express website that lets players submit update suggestions, view live connected players in-game (via the standard SA-MP UDP query protocol — **zero gamemode edits required**), and includes a **Hidden Admin Panel** for server staff.

## How to Deploy on GitHub & Render.com

1. **Push to GitHub**:
   - Create a new GitHub repository (e.g. `nlrp-suggestions`).
   - Upload all files from this folder (`server.js`, `package.json`, `render.yaml`, `.gitignore`, `public/`) and push to `main`.
2. **Deploy on Render**:
   - Go to [Render Dashboard](https://dashboard.render.com) -> **New +** -> **Web Service** (or **Blueprint**).
   - Connect your GitHub repository.
   - Set **Build Command** to `npm install` and **Start Command** to `npm start`.
   - Under **Environment Variables**, set:
     - `ADMIN_PASSWORD`: Your secret password to unlock the Hidden Admin Panel.
     - `SAMP_SERVER_IP`: `naijalifev1.cowdie.com` (or your server IP).
     - `SAMP_SERVER_PORT`: `17509` (or your server port).
     - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`: Your MySQL database details (automatically creates the `nlrp_web_suggestions` table on startup).

## Pages
- `/` suggestions, voting, staff replies
- `/players.html` live player list from the game server query
- `/admin` staff moderation. Not linked anywhere; type it after your site URL. The panel is only sent after a correct `ADMIN_PASSWORD`.

## Environment
Set `ADMIN_PASSWORD` (required for staff login). MySQL variables are optional: without them suggestions are stored in `suggestions_data.json`, which Render's free plan wipes on every deploy, so use MySQL for anything permanent.

## Game tools (on /admin)
Give or take money, set admin level, ban or unban, and give or remove vehicles. `gameconfig.json` is already mapped to the AKRPV5 schema (users, bans, vehicles). Press **Check config** on the admin page. Actions are refused until every configured column exists. Players who are online are blocked unless you tick "Apply even if online", because the game can overwrite changes made behind its back. Every action is saved to `nlrp_web_audit`.
## In-game control (on /admin)
Kick a player or broadcast a message through RCON. Set `RCON_PASSWORD` on Render to the `rcon_password` from your server.cfg. Only kick and say can be sent. Anyone who gets into the panel can then kick players and broadcast, so keep `ADMIN_PASSWORD` long and private.

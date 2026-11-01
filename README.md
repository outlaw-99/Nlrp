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
     - `SAMP_SERVER_IP`: `51.83.49.125` (or your server IP).
     - `SAMP_SERVER_PORT`: `17509` (or your server port).
     - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`: Your MySQL database details (automatically creates the `nlrp_web_suggestions` table on startup).

## Pages
- `/` suggestions, voting, staff replies
- `/players.html` live player list from the game server query
- `/admin.html` staff moderation (not linked in the nav; lock icon in the footer)

## Environment
Set `ADMIN_PASSWORD` (required for staff login). MySQL variables are optional: without them suggestions are stored in `suggestions_data.json`, which Render's free plan wipes on every deploy, so use MySQL for anything permanent.

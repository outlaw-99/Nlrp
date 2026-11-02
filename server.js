/**
 * NAIJA LIFE ROLEPLAY (NL:RP) — Standalone Suggestions & Live Players Web Server
 * Designed for 1-click deployment on Render.com from GitHub.
 *
 * Features:
 *  1. Zero Gamemode Changes Required: Queries your SA-MP / open.mp server
 *     (51.83.49.125:17509) directly using the standard SA-MP UDP Query Protocol
 *     ('i' for server info, 'd' and 'c' for live connected players).
 *  2. Real Database Storage: Connects to MySQL (via DATABASE_URL or DB_HOST/DB_USER/DB_PASS/DB_NAME)
 *     and auto-creates `nlrp_web_suggestions` on startup (with automatic JSON file
 *     fallback if MySQL env vars are not set yet).
 *  3. Hidden Admin Panel: Protected by ADMIN_PASSWORD environment variable.
 */

const express = require('express');
const dgram = require('dgram');
const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');

let mysql = null;
try {
  mysql = require('mysql2/promise');
} catch (_) {
  mysql = null;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configuration via Render Environment Variables
const PORT = Number(process.env.PORT || 3000);
let SAMP_IP = process.env.SAMP_SERVER_IP || 'naijalifev1.cowdie.com';
let SAMP_PORT = Number(process.env.SAMP_SERVER_PORT || 17509);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
app.set('trust proxy', 1);
const voteLog = new Map(); // suggestion id -> Set of voter IPs

// Active admin tokens in memory
const adminTokens = new Set();

// Database Setup (MySQL primary, local file fallback if DB is not configured)
let pool = null;
const DATA_FILE = path.join(__dirname, 'suggestions_data.json');

async function initDatabase() {
  const dbHost = process.env.DB_HOST;
  const dbUser = process.env.DB_USER;
  const dbPass = process.env.DB_PASS;
  const dbName = process.env.DB_NAME;
  const dbPort = Number(process.env.DB_PORT || 3306);

  if (!mysql || !(process.env.DATABASE_URL || (dbHost && dbUser && dbName))) {
    console.warn('[NL:RP] No database configured. Using local file store.');
    return;
  }

  try {
    pool = process.env.DATABASE_URL
      ? mysql.createPool(process.env.DATABASE_URL)
      : mysql.createPool({
          host: dbHost,
          user: dbUser,
          password: dbPass,
          database: dbName,
          port: dbPort,
          waitForConnections: true,
          connectionLimit: 8,
          connectTimeout: 5000
        });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS nlrp_web_suggestions (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        player_name VARCHAR(32) NOT NULL,
        category VARCHAR(32) NOT NULL DEFAULT 'General',
        title VARCHAR(120) NOT NULL,
        description TEXT NOT NULL,
        status ENUM('pending', 'approved', 'implemented', 'rejected') NOT NULL DEFAULT 'pending',
        upvotes INT UNSIGNED NOT NULL DEFAULT 1,
        admin_note TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[NL:RP] Connected to MySQL database and verified nlrp_web_suggestions table.');
  } catch (err) {
    console.warn('[NL:RP] MySQL connection unavailable (' + err.message + '). Using persistent file store.');
    pool = null;
  }
}

function readLocalStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function writeLocalStore(items) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (_) {}
}

// ============================================================================
// NATIVE SA-MP / open.mp UDP QUERY PROTOCOL CLIENT (NO GAMEMODE CODE NEEDED)
// ============================================================================
function buildSampPacket(ip, port, opcodeChar) {
  const parts = ip.split('.').map(Number);
  const buf = Buffer.alloc(11);
  buf.write('SAMP', 0, 4, 'ascii');
  buf[4] = parts[0] || 127;
  buf[5] = parts[1] || 0;
  buf[6] = parts[2] || 0;
  buf[7] = parts[3] || 1;
  buf.writeUInt16LE(port, 8);
  buf.write(opcodeChar, 10, 1, 'ascii');
  return buf;
}

async function resolveIPv4(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  return (await dns.lookup(host, { family: 4 })).address;
}

function querySampOpcode(host, port, opcodeChar, timeoutMs = 2500) {
  return resolveIPv4(host).then((addr) => queryResolved(addr, port, opcodeChar, timeoutMs));
}

function queryResolved(ip, port, opcodeChar, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = buildSampPacket(ip, port, opcodeChar);
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        socket.close();
        reject(new Error('UDP query timeout'));
      }
    }, timeoutMs);

    socket.on('error', (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });

    socket.on('message', (msg) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        socket.close();
        resolve(msg);
      }
    });

    socket.send(packet, 0, packet.length, port, ip);
  });
}

function parseSampInfo(buf) {
  // Header is 11 bytes: "SAMP" + 4-byte IP + 2-byte port + 'i'
  let offset = 11;
  const passworded = buf.readUInt8(offset) !== 0;
  offset += 1;
  const players = buf.readUInt16LE(offset);
  offset += 2;
  const maxPlayers = buf.readUInt16LE(offset);
  offset += 2;

  const readLenStr = () => {
    const len = buf.readUInt32LE(offset);
    offset += 4;
    const str = buf.slice(offset, offset + len).toString('utf8');
    offset += len;
    return str;
  };

  const hostname = readLenStr();
  const gamemode = readLenStr();
  const language = readLenStr();

  return { passworded, players, maxPlayers, hostname, gamemode, language };
}

function parseSampPlayersDetailed(buf) {
  // 'd' opcode response: 11-byte header + uint16 playerCount + [uint8 id, uint8 nameLen, name, int32 score, uint32 ping]
  let offset = 11;
  const count = buf.readUInt16LE(offset);
  offset += 2;
  const list = [];
  for (let i = 0; i < count && offset < buf.length; i++) {
    const id = buf.readUInt8(offset);
    offset += 1;
    const nameLen = buf.readUInt8(offset);
    offset += 1;
    const name = buf.slice(offset, offset + nameLen).toString('utf8');
    offset += nameLen;
    const score = buf.readInt32LE(offset);
    offset += 4;
    const ping = buf.readUInt32LE(offset);
    offset += 4;
    list.push({ id, name, score, ping });
  }
  return list;
}

function parseSampPlayersClients(buf) {
  // 'c' opcode response: 11-byte header + uint16 playerCount + [uint8 nameLen, name, int32 score]
  let offset = 11;
  const count = buf.readUInt16LE(offset);
  offset += 2;
  const list = [];
  for (let i = 0; i < count && offset < buf.length; i++) {
    const nameLen = buf.readUInt8(offset);
    offset += 1;
    const name = buf.slice(offset, offset + nameLen).toString('utf8');
    offset += nameLen;
    const score = buf.readInt32LE(offset);
    offset += 4;
    list.push({ id: i, name, score, ping: null });
  }
  return list;
}

// ============================================================================
// REST API ENDPOINTS
// ============================================================================

// 1. Live Server Status & Connected Players In-Game
app.get('/api/status', async (req, res) => {
  try {
    const infoBuf = await querySampOpcode(SAMP_IP, SAMP_PORT, 'i');
    const info = parseSampInfo(infoBuf);

    let playersList = [];
    if (info.players > 0 && info.players <= 100) {
      try {
        const dBuf = await querySampOpcode(SAMP_IP, SAMP_PORT, 'd', 2000);
        playersList = parseSampPlayersDetailed(dBuf);
      } catch (_) {
        try {
          const cBuf = await querySampOpcode(SAMP_IP, SAMP_PORT, 'c', 2000);
          playersList = parseSampPlayersClients(cBuf);
        } catch (__) {}
      }
    }

    return res.json({
      ok: true,
      online: true,
      ip: `${SAMP_IP}:${SAMP_PORT}`,
      hostname: info.hostname,
      gamemode: info.gamemode,
      language: info.language,
      playersCount: info.players,
      maxPlayers: info.maxPlayers,
      players: playersList
    });
  } catch (err) {
    return res.json({
      ok: true,
      online: false,
      ip: `${SAMP_IP}:${SAMP_PORT}`,
      hostname: null,
      gamemode: null,
      playersCount: null,
      maxPlayers: null,
      players: [],
      error: err.message
    });
  }
});

// 2. Get All Suggestions
app.get('/api/suggestions', async (req, res) => {
  try {
    if (pool) {
      const [rows] = await pool.query('SELECT * FROM nlrp_web_suggestions ORDER BY upvotes DESC, id DESC LIMIT 200');
      return res.json({ ok: true, suggestions: rows });
    }
    const items = readLocalStore().sort((a, b) => (b.upvotes - a.upvotes) || (b.id - a.id));
    return res.json({ ok: true, suggestions: items });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Submit a Suggestion
app.post('/api/suggestions', async (req, res) => {
  try {
    const playerName = String(req.body.player_name || '').trim();
    const category = String(req.body.category || 'General').trim();
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();

    if (playerName.length < 2 || playerName.length > 32) {
      return res.status(400).json({ ok: false, error: 'Please enter your in-game name (2-32 characters).' });
    }
    if (title.length < 4 || title.length > 120) {
      return res.status(400).json({ ok: false, error: 'Title must be between 4 and 120 characters.' });
    }
    if (description.length < 10 || description.length > 3000) {
      return res.status(400).json({ ok: false, error: 'Suggestion details must be between 10 and 3,000 characters.' });
    }

    if (pool) {
      const [result] = await pool.execute(
        'INSERT INTO nlrp_web_suggestions (player_name, category, title, description, status, upvotes) VALUES (?, ?, ?, ?, "pending", 1)',
        [playerName, category, title, description]
      );
      return res.json({ ok: true, id: result.insertId });
    }

    const items = readLocalStore();
    const newId = items.reduce((m, x) => Math.max(m, Number(x.id || 0)), 0) + 1;
    const newEntry = {
      id: newId,
      player_name: playerName,
      category,
      title,
      description,
      status: 'pending',
      upvotes: 1,
      admin_note: null,
      created_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
    };
    items.unshift(newEntry);
    writeLocalStore(items);
    return res.json({ ok: true, id: newId });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Upvote a Suggestion
app.post('/api/suggestions/:id/upvote', async (req, res) => {
  const id = Number(req.params.id || 0);
  const voters = voteLog.get(id) || new Set();
  if (voters.has(req.ip)) return res.status(409).json({ ok: false, error: 'You have already upvoted this suggestion.' });
  voters.add(req.ip);
  voteLog.set(id, voters);
  try {
    if (pool) {
      await pool.execute('UPDATE nlrp_web_suggestions SET upvotes = upvotes + 1 WHERE id = ?', [id]);
      const [rows] = await pool.execute('SELECT upvotes FROM nlrp_web_suggestions WHERE id = ?', [id]);
      return res.json({ ok: true, upvotes: rows[0] ? rows[0].upvotes : 1 });
    }
    const items = readLocalStore();
    const item = items.find((x) => Number(x.id) === id);
    if (!item) return res.status(404).json({ ok: false, error: 'Suggestion not found.' });
    item.upvotes = Number(item.upvotes || 0) + 1;
    writeLocalStore(items);
    return res.json({ ok: true, upvotes: item.upvotes });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Hidden Admin Panel Login
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ ok: false, error: 'ADMIN_PASSWORD is not set on the server.' });
  const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
  if (!crypto.timingSafeEqual(sha(req.body.password || ''), sha(ADMIN_PASSWORD))) {
    return res.status(401).json({ ok: false, error: 'Invalid admin password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  return res.json({ ok: true, token });
});

function requireAdmin(req, res, next) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !adminTokens.has(token)) {
    return res.status(403).json({ ok: false, error: 'Unauthorized. Unlock the Admin Panel first.' });
  }
  next();
}

// Admin page: the login shell is public at /admin, the panel itself is only sent to a signed-in admin.
const PRIVATE_DIR = path.join(__dirname, 'private');
app.get('/admin', (req, res) => res.sendFile(path.join(PRIVATE_DIR, 'admin-login.html')));
app.get('/api/admin/panel', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    html: fs.readFileSync(path.join(PRIVATE_DIR, 'admin_panel.html'), 'utf8'),
    js: fs.readFileSync(path.join(PRIVATE_DIR, 'admin_panel.js'), 'utf8')
  });
});

// 6. Admin: Update Status / Note
app.patch('/api/admin/suggestions/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id || 0);
  const status = String(req.body.status || 'pending');
  const adminNote = String(req.body.admin_note || '').trim() || null;

  if (!['pending', 'approved', 'implemented', 'rejected'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'Invalid status.' });
  }

  try {
    if (pool) {
      await pool.execute('UPDATE nlrp_web_suggestions SET status = ?, admin_note = ? WHERE id = ?', [status, adminNote, id]);
      return res.json({ ok: true });
    }
    const items = readLocalStore();
    const item = items.find((x) => Number(x.id) === id);
    if (!item) return res.status(404).json({ ok: false, error: 'Not found.' });
    item.status = status;
    item.admin_note = adminNote;
    writeLocalStore(items);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 7. Admin: Delete Suggestion
app.delete('/api/admin/suggestions/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id || 0);
  try {
    if (pool) {
      await pool.execute('DELETE FROM nlrp_web_suggestions WHERE id = ?', [id]);
      return res.json({ ok: true });
    }
    let items = readLocalStore();
    items = items.filter((x) => Number(x.id) !== id);
    writeLocalStore(items);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});


// 8. Admin: Update SA-MP Server IP & Port dynamically
app.post('/api/admin/server-ip', requireAdmin, (req, res) => {
  const raw = String(req.body.server_address || '').trim();
  const parts = raw.split(':');
  if (!parts[0]) return res.status(400).json({ ok: false, error: 'Invalid IP:Port format.' });
  SAMP_IP = parts[0].trim();
  if (parts[1] && !isNaN(Number(parts[1]))) {
    SAMP_PORT = Number(parts[1]);
  }
  return res.json({ ok: true, ip: `${SAMP_IP}:${SAMP_PORT}` });
});

async function onlineNames() {
  try {
    const info = parseSampInfo(await querySampOpcode(SAMP_IP, SAMP_PORT, 'i'));
    if (!info.players) return [];
    return parseSampPlayersDetailed(await querySampOpcode(SAMP_IP, SAMP_PORT, 'd', 2000)).map((p) => p.name.toLowerCase());
  } catch (_) {
    throw new Error('Could not check who is online (game server not answering). Try again.');
  }
}
require('./gametools')(app, { pool: () => pool, requireAdmin, onlineNames });
try {
  require('./rcon')(app, {
    requireAdmin,
    target: async () => ({ ip: await resolveIPv4(SAMP_IP), port: SAMP_PORT }),
    listPlayers: async () => {
      const info = parseSampInfo(await querySampOpcode(SAMP_IP, SAMP_PORT, 'i'));
      if (!info.players) return [];
      return parseSampPlayersDetailed(await querySampOpcode(SAMP_IP, SAMP_PORT, 'd', 2000));
    }
  });
} catch (e) { console.error('[NL:RP] RCON tools disabled:', e.message); }

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`[NL:RP] Web server running on port ${PORT} (Querying SA-MP ${SAMP_IP}:${SAMP_PORT})`);
  });
});

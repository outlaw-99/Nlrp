// NAIJALIFE NLRP - live server status site (no dependencies, Node 16+)
// Queries the SA-MP / open.mp server over UDP and serves JSON + the website.
const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CFG = {
  host: process.env.SAMP_HOST || '127.0.0.1',     // <-- your game server IP
  port: parseInt(process.env.SAMP_PORT || '7777', 10), // <-- your game server port
  web:  parseInt(process.env.PORT || '3000', 10),
  discord: process.env.DISCORD || 'https://discord.gg/Ytz73CtpRq',
  name: process.env.SERVER_NAME || 'NAIJALIFE NLRP',
  cacheMs: parseInt(process.env.CACHE_MS || '4000', 10),
  historyEvery: parseInt(process.env.HISTORY_MS || '60000', 10), // one history sample per minute
  historyMax: 24 * 60,          // keep 24 hours
};

function buildPacket(opcode, extra) {
  const ip = CFG.host.split('.').map(Number);
  const head = Buffer.from([0x53, 0x41, 0x4d, 0x50, ip[0], ip[1], ip[2], ip[3], CFG.port & 0xff, (CFG.port >> 8) & 0xff, opcode.charCodeAt(0)]);
  return extra ? Buffer.concat([head, extra]) : head;
}

function query(opcode, extra, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const t0 = Date.now();
    const timer = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, timeout);
    sock.once('message', (msg) => { clearTimeout(timer); sock.close(); resolve({ msg, ms: Date.now() - t0 }); });
    sock.once('error', (e) => { clearTimeout(timer); try { sock.close(); } catch (_) {} reject(e); });
    sock.send(buildPacket(opcode, extra), CFG.port, CFG.host, (e) => { if (e) { clearTimeout(timer); sock.close(); reject(e); } });
  });
}

const str32 = (b, o) => { const n = b.readUInt32LE(o); return [b.toString('latin1', o + 4, o + 4 + n), o + 4 + n]; };

async function getInfo() {
  const { msg, ms } = await query('i');
  let o = 11;
  const password = !!msg.readUInt8(o++);
  const players = msg.readUInt16LE(o); o += 2;
  const maxPlayers = msg.readUInt16LE(o); o += 2;
  let hostname, gamemode, language;
  [hostname, o] = str32(msg, o);
  [gamemode, o] = str32(msg, o);
  [language, o] = str32(msg, o);
  return { password, players, maxPlayers, hostname, gamemode, language, ping: ms };
}

async function getPlayers() {
  const { msg } = await query('d');
  let o = 11;
  const n = msg.readUInt16LE(o); o += 2;
  const list = [];
  for (let i = 0; i < n && o < msg.length; i++) {
    const id = msg.readUInt8(o++);
    const len = msg.readUInt8(o++);
    const name = msg.toString('latin1', o, o + len); o += len;
    const score = msg.readInt32LE(o); o += 4;
    const ping = msg.readUInt32LE(o); o += 4;
    list.push({ id, name, score, ping });
  }
  return list;
}

async function getRules() {
  const { msg } = await query('r');
  let o = 11;
  const n = msg.readUInt16LE(o); o += 2;
  const rules = {};
  for (let i = 0; i < n && o < msg.length; i++) {
    const kl = msg.readUInt8(o++); const k = msg.toString('latin1', o, o + kl); o += kl;
    const vl = msg.readUInt8(o++); const v = msg.toString('latin1', o, o + vl); o += vl;
    rules[k] = v;
  }
  return rules;
}

let cache = { at: 0, data: null };
const history = [];
let startedAt = Date.now(), lastOnline = null, peakToday = { day: new Date().toDateString(), value: 0 };

async function refresh() {
  const now = Date.now();
  if (cache.data && now - cache.at < CFG.cacheMs) return cache.data;
  let data;
  try {
    const info = await getInfo();
    let players = [], rules = {};
    try { players = await getPlayers(); } catch (_) {}
    try { rules = await getRules(); } catch (_) {}
    players.sort((a, b) => b.score - a.score);
    const day = new Date().toDateString();
    if (peakToday.day !== day) peakToday = { day, value: 0 };
    peakToday.value = Math.max(peakToday.value, info.players);
    lastOnline = now;
    data = { online: true, name: CFG.name, address: `${CFG.host}:${CFG.port}`, discord: CFG.discord,
      ...info, playerList: players, rules, peakToday: peakToday.value, updated: now };
  } catch (e) {
    data = { online: false, name: CFG.name, address: `${CFG.host}:${CFG.port}`, discord: CFG.discord,
      players: 0, maxPlayers: 0, playerList: [], rules: {}, peakToday: peakToday.value,
      lastOnline, updated: now, error: e.message };
  }
  cache = { at: now, data };
  return data;
}

setInterval(async () => {
  const d = await refresh();
  history.push({ t: Date.now(), p: d.online ? d.players : null });
  if (history.length > CFG.historyMax) history.shift();
}, CFG.historyEvery).unref();
refresh().then((d) => history.push({ t: Date.now(), p: d.online ? d.players : null }));

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const PUB = path.join(__dirname, 'public');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') {
    const d = await refresh();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ...d, history, uptimeSite: Date.now() - startedAt }));
  }
  let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(CFG.web, () => console.log(`${CFG.name} site on http://localhost:${CFG.web}  (game server ${CFG.host}:${CFG.port})`));

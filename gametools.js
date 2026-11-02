// In-game admin tools. Table/column names come from gameconfig.json (edit it to match your database).
const fs = require('fs'), path = require('path');
const DEF = {
  accounts: { table: 'users', id: 'uid', name: 'username', ip: 'ip', money: 'cash', admin: 'adminlevel' },
  bans: { table: 'bans', username: 'username', ip: 'ip', columns: 7 },
  vehicles: { table: 'vehicles', ownerId: 'ownerid', owner: 'owner', model: 'modelid', extra: {} }
};
let user = {};
try { user = JSON.parse(fs.readFileSync(path.join(__dirname, 'gameconfig.json'), 'utf8')); } catch (_) {}
const A = { ...DEF.accounts, ...(user.accounts || {}) };
const V = { ...DEF.vehicles, ...(user.vehicles || {}) };
const B = { ...DEF.bans, ...(user.bans || {}) };
const q = (v) => { if (!/^[A-Za-z0-9_]+$/.test(String(v))) throw new Error('Bad identifier in gameconfig.json: ' + v); return '`' + v + '`'; };

module.exports = (app, { pool, requireAdmin, onlineNames }) => {
  let ready = false;
  const need = () => { const p = pool(); if (!p) throw new Error('Game tools need the MySQL connection, which is not active.'); return p; };

  async function ensure(p) {
    if (ready) return;
    await p.query('CREATE TABLE IF NOT EXISTS nlrp_web_audit (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, action VARCHAR(32) NOT NULL, target VARCHAR(64) NOT NULL, detail VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const problems = [];
    for (const [t, cols] of [[A.table, [A.id, A.name, A.ip, A.money, A.admin]], [B.table, [B.username, B.ip]], [V.table, [V.ownerId, V.owner, V.model, ...Object.keys(V.extra || {})]]]) {
      let have;
      try { [have] = await p.query('SHOW COLUMNS FROM ' + q(t)); } catch (_) { problems.push('table ' + t + ' not found'); continue; }
      const names = have.map((r) => r.Field);
      cols.filter(Boolean).forEach((c) => { if (!names.includes(c)) problems.push(t + '.' + c + ' missing'); });
      if (t === B.table && names.length !== Number(B.columns)) problems.push(t + ' has ' + names.length + ' columns, expected ' + B.columns);
    }
    if (problems.length) throw new Error('gameconfig.json does not match your database: ' + problems.join('; '));
    ready = true;
  }

  const log = (p, action, target, detail) => p.execute('INSERT INTO nlrp_web_audit (action, target, detail) VALUES (?,?,?)', [action, target, String(detail).slice(0, 250)]);

  async function account(p, name, force) {
    name = String(name || '').trim();
    if (!name) throw new Error('Enter a player name.');
    const [rows] = await p.execute(`SELECT * FROM ${q(A.table)} WHERE ${q(A.name)} = ? LIMIT 1`, [name]);
    if (!rows[0]) throw new Error('No account named ' + name + '.');
    return rows[0];
  }

  async function guardOnline(name, force) {
    let names = [];
    try { names = await onlineNames(); } catch (e) { if (!force) throw e; }
    if (names.includes(String(name).trim().toLowerCase()) && !force) {
      throw new Error(name + ' is online now, so the game may overwrite this change. Tick "Apply even if online" to continue anyway.');
    }
  }

  const route = (method, url, fn, write) => app[method]('/api/admin/game/' + url, requireAdmin, async (req, res) => {
    try {
      const p = need(); await ensure(p);
      const b = method === 'get' ? req.query : req.body;
      if (write) await guardOnline(b.name, b.force === true || b.force === 'true');
      res.json({ ok: true, ...(await fn(p, b)) });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  route('get', 'schema', async () => ({ message: 'gameconfig.json matches your database.' }));

  route('get', 'player', async (p, b) => {
    const row = await account(p, b.name);
    const safe = Object.fromEntries(Object.entries(row).filter(([k]) => !/pass|hash|salt|token|key/i.test(k)));
    const [cars] = await p.execute(`SELECT ${q(V.model)} AS model FROM ${q(V.table)} WHERE ${q(V.ownerId)} = ? LIMIT 50`, [row[A.id]]);
    return { message: JSON.stringify({ account: safe, vehicles: cars.map((c) => c.model) }, null, 2) };
  });

  route('post', 'money', async (p, b) => {
    const amt = Number(b.amount);
    if (!Number.isInteger(amt) || amt < 0 || amt > 1e9) throw new Error('Amount must be a whole number from 0 to 1,000,000,000.');
    await account(p, b.name);
    const m = q(A.money);
    const sql = { give: `${m} = ${m} + ?`, take: `${m} = GREATEST(${m} - ?, 0)`, set: `${m} = ?` }[b.mode];
    if (!sql) throw new Error('Mode must be give, take or set.');
    await p.execute(`UPDATE ${q(A.table)} SET ${sql} WHERE ${q(A.name)} = ?`, [amt, b.name.trim()]);
    await log(p, 'money_' + b.mode, b.name, amt);
    return { message: `Money ${b.mode} ${amt} for ${b.name.trim()} done.` };
  }, true);

  route('post', 'adminlevel', async (p, b) => {
    const lvl = Number(b.level);
    if (!Number.isInteger(lvl) || lvl < 0 || lvl > 99) throw new Error('Level must be a whole number from 0 to 99.');
    await account(p, b.name);
    await p.execute(`UPDATE ${q(A.table)} SET ${q(A.admin)} = ? WHERE ${q(A.name)} = ?`, [lvl, b.name.trim()]);
    await log(p, 'adminlevel', b.name, lvl);
    return { message: `Admin level for ${b.name.trim()} set to ${lvl}.` };
  }, true);

  route('post', 'ban', async (p, b) => {
    const row = await account(p, b.name), user = row[A.name];
    if (b.unban) {
      const [r] = await p.execute(`DELETE FROM ${q(B.table)} WHERE ${q(B.username)} = ?`, [user]);
      await log(p, 'unban', user, r.affectedRows + ' removed');
      return { message: r.affectedRows ? `${user} unbanned.` : `${user} had no ban entry.` };
    }
    const reason = String(b.reason || 'Banned via website by staff').slice(0, 120);
    // Same positional row the game writes: (id, hwid, ip, username, date, reason, permanent)
    await p.execute(`INSERT INTO ${q(B.table)} VALUES (NULL, 'n/a', ?, ?, NOW(), ?, 0)`, [row[A.ip] || '', user, reason]);
    await log(p, 'ban', user, reason);
    return { message: `${user} banned.` };
  }, true);

  route('post', 'vehicle', async (p, b) => {
    const row = await account(p, b.name), user = row[A.name];
    const model = Number(b.model);
    if (!Number.isInteger(model) || model < 400 || model > 611) throw new Error('Vehicle model must be a number from 400 to 611.');
    if (b.remove) {
      const [r] = await p.execute(`DELETE FROM ${q(V.table)} WHERE ${q(V.ownerId)} = ? AND ${q(V.model)} = ? LIMIT 1`, [row[A.id], model]);
      if (!r.affectedRows) throw new Error('That player does not own model ' + model + '.');
      await log(p, 'vehicle_remove', user, model);
      return { message: `Removed model ${model} from ${user}.` };
    }
    const extra = V.extra || {};
    const cols = [V.ownerId, V.owner, V.model, ...Object.keys(extra)];
    await p.execute(`INSERT INTO ${q(V.table)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [row[A.id], user, model, ...Object.values(extra)]);
    await log(p, 'vehicle_give', user, model);
    return { message: `Gave model ${model} to ${user}. They spawn it with /vstorage.` };
  }, true);

  route('get', 'audit', async (p) => {
    const [rows] = await p.query('SELECT * FROM nlrp_web_audit ORDER BY id DESC LIMIT 20');
    return { rows };
  });

  app.locals.audit = async (action, target, detail) => { try { const p = need(); await ensure(p); await log(p, action, target, detail); } catch (_) {} };
};

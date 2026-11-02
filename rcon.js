// In-game control through the SA-MP RCON query. Only "kick" and "say" can be sent.
const dgram = require('dgram');

module.exports = (app, { requireAdmin, target, listPlayers }) => {
  let last = 0;

  const packet = (ip, port, pass, cmd) => {
    const head = Buffer.alloc(11);
    head.write('SAMP', 0, 4, 'ascii');
    ip.split('.').forEach((n, i) => { head[4 + i] = Number(n); });
    head.writeUInt16LE(port, 8);
    head.write('x', 10, 1, 'ascii');
    const p = Buffer.from(pass, 'utf8'), c = Buffer.from(cmd, 'utf8');
    const lp = Buffer.alloc(2), lc = Buffer.alloc(2);
    lp.writeUInt16LE(p.length);
    lc.writeUInt16LE(c.length);
    return Buffer.concat([head, lp, p, lc, c]);
  };

  const readReply = (buf) => {
    const n = buf.length > 13 ? buf.readUInt16LE(11) : 0;
    const body = n && 13 + n <= buf.length ? buf.slice(13, 13 + n) : buf.slice(11);
    return body.toString('utf8').replace(/[^\x20-\x7e\n]/g, '').trim();
  };

  // Many commands print nothing, so silence for one second counts as sent.
  const send = (ip, port, pass, cmd) => new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const end = (err, out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.close();
      err ? reject(err) : resolve(out);
    };
    const timer = setTimeout(() => end(null, ''), 1000);
    sock.on('error', end);
    sock.on('message', (m) => {
      const out = readReply(m);
      /invalid rcon password/i.test(out) ? end(new Error('Wrong RCON password. Check RCON_PASSWORD on Render.')) : end(null, out);
    });
    sock.send(packet(ip, port, pass, cmd), port, ip, (e) => { if (e) end(e); });
  });

  const online = async () => {
    try { return await listPlayers(); } catch (_) { throw new Error('Game server not answering. Try again.'); }
  };

  // A working RCON answers "cmdlist". Silence means wrong password, RCON switched off, or blocked.
  const probe = async (t, pass) => {
    const out = await send(t.ip, t.port, pass, 'cmdlist');
    if (!out) throw new Error('The server did not answer RCON. Check that RCON_PASSWORD on Render matches rcon_password in your server settings, that RCON is switched on there (rcon 1 in server.cfg, or rcon enable in config.json), and that your host allows it.');
    return out;
  };

  const guard = async (res, fn) => {
    try {
      const pass = process.env.RCON_PASSWORD;
      if (!pass) throw new Error('Set RCON_PASSWORD on Render (the rcon_password from server.cfg) to use these tools.');
      if (Date.now() - last < 800) throw new Error('Slow down, wait a second.');
      last = Date.now();
      res.json({ ok: true, ...(await fn(pass)) });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  };

  app.get('/api/admin/rcon/players', requireAdmin, async (req, res) => {
    try { res.json({ ok: true, players: await online() }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/admin/rcon/say', requireAdmin, (req, res) => guard(res, async (pass) => {
    const msg = String(req.body.message || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 120);
    if (!msg) throw new Error('Type a message first.');
    const t = await target();
    await send(t.ip, t.port, pass, 'say ' + msg);
    let warn = '';
    try { await probe(t, pass); } catch (e) { warn = e.message; }
    if (app.locals.audit) app.locals.audit('broadcast', 'all', msg);
    return warn ? { warn: true, message: 'Sent, but it probably did not show up. ' + warn } : { message: 'Broadcast sent: ' + msg };
  }));

  app.post('/api/admin/rcon/kick', requireAdmin, (req, res) => guard(res, async (pass) => {
    const id = Number(req.body.id), name = String(req.body.name || '').trim();
    if (!Number.isInteger(id) || id < 0 || id > 999 || !name) throw new Error('Pick a player from the list.');
    const same = (p) => p.id === id && p.name.toLowerCase() === name.toLowerCase();
    if (!(await online()).some(same)) throw new Error(name + ' is no longer on ID ' + id + '. Refresh the list.');
    const t = await target();
    await send(t.ip, t.port, pass, 'kick ' + id);
    await new Promise((r) => setTimeout(r, 600));
    if ((await listPlayers().catch(() => [])).some(same)) {
      throw new Error(name + ' is still online, so the server did not accept the command. Check RCON_PASSWORD on Render.');
    }
    if (app.locals.audit) app.locals.audit('kick', name, 'id ' + id);
    return { message: 'Kicked ' + name + '.' };
  }));

  app.post('/api/admin/rcon/test', requireAdmin, (req, res) => guard(res, async (pass) => {
    const out = await probe(await target(), pass);
    return { message: 'RCON works. The server answered: ' + out.slice(0, 60) };
  }));
};

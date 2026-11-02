(function(){
$('#out').innerHTML=icon('out')+'Sign out';$('#sipb').innerHTML=icon('save')+'Save';
let all=[];
function lost(e){if(/Unauthorized/.test(e.message)){toast('Session expired. Sign in again.',1);signOut()}else toast(e.message,1)}
function draw(){const fs=$('#fs').value,v=all.filter(s=>fs=='all'||s.status==fs);$('#cnt').textContent=v.length+' of '+all.length;
 $('#list').innerHTML=v.length?v.map(s=>`<article class="item" style="grid-template-columns:1fr"><div><div class="meta"><span>#${s.id}</span><span class="tag">${esc(s.category)}</span><span>${esc(s.player_name)}</span><span>${s.upvotes} votes</span></div><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p><div class="adm"><div class="l"><select data-s="${s.id}" aria-label="Status"><option value="pending">Pending</option><option value="approved">Approved</option><option value="implemented">Implemented</option><option value="rejected">Rejected</option></select><input data-n="${s.id}" value="${esc(s.admin_note||'')}" placeholder="Staff note shown publicly" maxlength="1000"><button class="btn pri" data-save="${s.id}">${icon('save')}Save</button><button class="btn del" data-del="${s.id}">${icon('trash')}Delete</button></div></div></div></article>`).join(''):'<div class="empty">No suggestions in this view.</div>';
 v.forEach(s=>$(`[data-s="${s.id}"]`).value=s.status)}
async function load(){try{all=(await api('suggestions')).suggestions;draw()}catch(e){toast(e.message,1)}}
$('#out').onclick=signOut;$('#fs').onchange=draw;
$('#list').onclick=async e=>{const sv=e.target.closest('[data-save]'),dl=e.target.closest('[data-del]');
 try{if(sv){const id=sv.dataset.save;await api('admin/suggestions/'+id,{method:'PATCH',body:{status:$(`[data-s="${id}"]`).value,admin_note:$(`[data-n="${id}"]`).value.trim()}});toast('Saved #'+id);load()}
 else if(dl){const id=dl.dataset.del;if(!confirm('Delete suggestion #'+id+'? This cannot be undone.'))return;await api('admin/suggestions/'+id,{method:'DELETE'});toast('Deleted #'+id);load()}}catch(x){lost(x)}};
$('#sipb').onclick=async()=>{try{const r=await api('admin/server-ip',{method:'POST',body:{server_address:$('#sip').value.trim()}});toast('Now querying '+r.ip)}catch(x){lost(x)}};
async function gcall(method,path,body){try{const r=await api('admin/game/'+path,{method,body});$('#gout').textContent=r.message||'';toast('Done');audit();return r}catch(x){$('#gout').textContent=x.message;lost(x)}}
async function audit(){try{const r=await api('admin/game/audit');$('#aud').innerHTML=r.rows.map(a=>`<tr><td>${esc(a.action)}</td><td>${esc(a.target)}</td><td>${esc(a.detail)}</td><td class="r mono">${esc(new Date(a.created_at).toLocaleString())}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No actions yet.</td></tr>'}catch(x){$('#aud').innerHTML='<tr><td colspan="4" class="empty">'+esc(x.message)+'</td></tr>'}}
$('#gn').closest('.box').onclick=e=>{const b=e.target.closest('button');if(!b)return;const name=$('#gn').value.trim(),force=$('#gf').checked,g=b.dataset.g;
 if(b.dataset.m)return gcall('POST','money',{name,force,mode:b.dataset.m,amount:$('#gm').value});
 if(g=='lookup')return gcall('GET','player?name='+encodeURIComponent(name));
 if(g=='schema')return gcall('GET','schema');
 if(g=='level')return gcall('POST','adminlevel',{name,force,level:$('#gl').value});
 if(g=='ban'||g=='unban')return gcall('POST','ban',{name,force,unban:g=='unban',reason:$('#gr').value.trim()});
 if(g=='vgive'||g=='vremove')return gcall('POST','vehicle',{name,force,model:$('#gv').value,remove:g=='vremove'})};
async function players(){try{const r=await api('admin/rcon/players');$('#rpl').innerHTML=r.players.map(p=>`<tr><td class="mono">${p.id}</td><td>${esc(p.name)}</td><td class="r"><button class="btn sm del" data-id="${p.id}" data-nm="${esc(p.name)}">Kick</button></td></tr>`).join('')||'<tr><td colspan="3" class="empty">Nobody online.</td></tr>'}catch(x){$('#rpl').innerHTML='<tr><td colspan="3" class="empty">'+esc(x.message)+'</td></tr>'}}
async function rcall(path,body){try{const r=await api('admin/rcon/'+path,{method:'POST',body});$('#rout').textContent=r.message||'';toast(r.warn?'Sent, but check the note':'Done',r.warn?1:0);audit();players();return r}catch(x){$('#rout').textContent=x.message;lost(x);players()}}
$('#rsay').onclick=async()=>{const m=$('#rm').value.trim();if(m&&await rcall('say',{message:m}))$('#rm').value=''};
$('#rref').onclick=players;$('#rtest').onclick=()=>rcall('test',{});
$('#rpl').onclick=e=>{const b=e.target.closest('[data-id]');if(!b||!confirm('Kick '+b.dataset.nm+'?'))return;rcall('kick',{id:Number(b.dataset.id),name:b.dataset.nm})};
players();
loadStatus().then(s=>{if(s)$('#sip').value=s.ip});
load();audit();
})();

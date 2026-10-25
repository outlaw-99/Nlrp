// Fake SA-MP server for testing the site:  node mock-samp.js  (listens on UDP 7777)
const dgram = require('dgram');
const s = dgram.createSocket('udp4');
const names = ['Emeka_Obi','Tunde_Bakare','Ngozi_Eze','Chidi_Okafor','Ade_Williams','Amara_Nwosu','Bayo_Lawal','Zainab_Musa','Kunle_Ajayi','Ifeanyi_Uche','Funke_Alade','Sola_Martins','Dayo_Coker','Ibrahim_Sani'];
const L=(str)=>{const b=Buffer.alloc(4+str.length);b.writeUInt32LE(str.length,0);b.write(str,4,'latin1');return b;};
s.on('message',(m,r)=>{
  const op=String.fromCharCode(m[10]); const head=m.slice(0,11);
  let body;
  if(op==='i'){const b=Buffer.alloc(5);b.writeUInt8(0,0);b.writeUInt16LE(names.length,1);b.writeUInt16LE(200,3);body=Buffer.concat([b,L('NAIJALIFE NLRP [2XP!]'),L('NL:RP: V5[<3]'),L('English')]);}
  else if(op==='d'){const parts=[Buffer.from([names.length,0])];names.forEach((n,i)=>{const b=Buffer.alloc(2+n.length+8);b.writeUInt8(i,0);b.writeUInt8(n.length,1);b.write(n,2,'latin1');b.writeInt32LE(Math.floor(Math.random()*400),2+n.length);b.writeUInt32LE(30+Math.floor(Math.random()*120),6+n.length);parts.push(b);});body=Buffer.concat(parts);}
  else if(op==='r'){const rules={version:'0.3.7-R2',weather:'10',worldtime:'12:00',weburl:'discord.gg/Ytz73CtpRq',lagcomp:'On'};const parts=[Buffer.from([Object.keys(rules).length,0])];for(const[k,v]of Object.entries(rules))parts.push(Buffer.from([k.length]),Buffer.from(k),Buffer.from([v.length]),Buffer.from(v));body=Buffer.concat(parts);}
  else return;
  s.send(Buffer.concat([head,body]),r.port,r.address);
});
s.bind(7777,()=>console.log('mock SA-MP on udp 7777'));

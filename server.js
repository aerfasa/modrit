const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ===================== ساخت پوشه public =====================
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// ===================== محتوای HTML =====================
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PUG62 Panel</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Exo+2:wght@300;400;600&display=swap" rel="stylesheet">
<style>
:root{--p:#00e5ff;--pd:#0097a7;--s:#7b1fa2;--ok:#00e676;--no:#ff4081;--w:#ff9100;--gr:#8b9bb5;--lt:#e3f2fd}
*{margin:0;padding:0;box-sizing:border-box}
body{background:linear-gradient(135deg,#0a1929,#0c1b2e 50%,#0d1f36);color:var(--lt);font-family:'Exo 2',sans-serif;min-height:100vh}
.grid{position:fixed;inset:0;background-image:linear-gradient(rgba(0,229,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.03) 1px,transparent 1px);background-size:40px;z-index:-1;pointer-events:none}
.login{display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.login-box{background:rgba(10,25,41,.95);border-radius:20px;border:1px solid rgba(0,229,255,.2);width:100%;max-width:420px;padding:40px 30px;text-align:center;box-shadow:0 15px 35px rgba(0,0,0,.5);position:relative;overflow:hidden}
.login-box::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--p),var(--s))}
.logo{font-family:'Orbitron';font-size:2.5rem;font-weight:900;background:linear-gradient(90deg,var(--p),var(--s));-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:10px}
.tag{color:var(--gr);margin-bottom:30px;font-size:.9rem}
.ig{margin-bottom:18px;text-align:left}
.ig label{display:block;margin-bottom:6px;color:var(--gr);font-size:.85rem}
.ig input{width:100%;padding:13px;background:rgba(14,32,52,.8);border:1px solid rgba(0,229,255,.3);border-radius:8px;color:var(--lt);font-size:1rem;font-family:'Exo 2';transition:.3s}
.ig input:focus{outline:none;border-color:var(--p);box-shadow:0 0 10px rgba(0,229,255,.3)}
.btn{padding:12px 20px;background:linear-gradient(90deg,var(--p),var(--pd));border:none;border-radius:8px;color:white;font-family:'Exo 2';font-weight:600;cursor:pointer;transition:.3s;display:inline-flex;align-items:center;gap:8px;justify-content:center}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,229,255,.3)}
.btn-full{width:100%;margin-top:10px}
.btn-sm{padding:8px 14px;font-size:.85rem}
.btn-danger{background:linear-gradient(90deg,var(--no),#c2185b)}
.btn-warn{background:linear-gradient(90deg,var(--w),#e65100)}
.btn-ok{background:linear-gradient(90deg,var(--ok),#2e7d32);color:#000}
.panel{display:none;min-height:100vh;padding:20px}
.header{display:flex;justify-content:space-between;align-items:center;padding:15px 20px;background:rgba(10,25,41,.8);backdrop-filter:blur(10px);border-radius:15px;border:1px solid rgba(0,229,255,.2);margin-bottom:30px;flex-wrap:wrap;gap:15px}
.header h1{font-family:'Orbitron';font-size:1.5rem;background:linear-gradient(90deg,var(--p),var(--s));-webkit-background-clip:text;background-clip:text;color:transparent}
.hright{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ubox{display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(14,32,52,.8);border-radius:8px;border:1px solid rgba(0,229,255,.2);flex-wrap:wrap}
.badge{padding:3px 8px;background:rgba(0,229,255,.2);border:1px solid var(--p);border-radius:12px;font-size:.7rem;color:var(--p);font-weight:700;text-transform:uppercase}
.days-left{padding:3px 8px;background:rgba(255,145,0,.2);border:1px solid var(--w);border-radius:12px;font-size:.75rem;color:var(--w);font-weight:600}
.days-left.expired{background:rgba(255,64,129,.2);border-color:var(--no);color:var(--no)}
.dash{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;margin-bottom:30px}
.card{background:rgba(10,25,41,.8);backdrop-filter:blur(10px);border-radius:15px;border:1px solid rgba(0,229,255,.2);padding:18px;transition:.3s;position:relative}
.card:hover{transform:translateY(-3px);border-color:var(--p);box-shadow:0 10px 25px rgba(0,0,0,.4)}
.card-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(0,229,255,.1)}
.card-t{font-family:'Orbitron';font-size:1.15rem}
.mbtn{background:none;border:none;color:var(--gr);font-size:1.1rem;cursor:pointer;padding:5px;border-radius:5px}
.mbtn:hover{color:var(--p);background:rgba(0,229,255,.1)}
.dd{position:absolute;top:100%;right:0;background:rgba(10,25,41,.95);border:1px solid rgba(0,229,255,.3);border-radius:10px;min-width:180px;z-index:100;display:none;box-shadow:0 10px 25px rgba(0,0,0,.4)}
.dd.show{display:block}
.dd a{display:flex;align-items:center;gap:10px;padding:10px 14px;color:var(--lt);text-decoration:none;cursor:pointer;transition:.2s;border-bottom:1px solid rgba(0,229,255,.1);font-size:.9rem}
.dd a:last-child{border-bottom:none}
.dd a:hover{background:rgba(0,229,255,.1);color:var(--p)}
.dd a i{width:16px;text-align:center}
.cstat{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.sdot{width:10px;height:10px;border-radius:50%;background:var(--ok)}
.sdot.off{background:var(--no)}
.stxt{font-size:.85rem;color:var(--gr)}
.tog{position:relative;display:inline-block;width:44px;height:22px;margin-left:auto}
.tog input{opacity:0;width:0;height:0}
.tog .sl{position:absolute;cursor:pointer;inset:0;background:rgba(255,64,129,.5);transition:.4s;border-radius:22px}
.tog .sl:before{position:absolute;content:"";height:16px;width:16px;left:3px;bottom:3px;background:white;transition:.4s;border-radius:50%}
input:checked+.sl{background:rgba(0,230,118,.5)}
input:checked+.sl:before{transform:translateX(22px)}
.cdet{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.di{background:rgba(14,32,52,.5);border-radius:8px;padding:10px;border-left:3px solid var(--p)}
.dl{font-size:.75rem;color:var(--gr);margin-bottom:3px}
.dv{font-size:1rem;font-weight:600}
.pbar{height:6px;background:rgba(14,32,52,.5);border-radius:3px;overflow:hidden;margin-bottom:10px}
.pfill{height:100%;background:linear-gradient(90deg,var(--p),var(--ok));transition:width .5s}
.cact{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.cact .btn{flex:1;min-width:80px;font-size:.8rem;padding:8px}
.modal{display:none;position:fixed;inset:0;background:rgba(6,18,31,.95);backdrop-filter:blur(5px);z-index:1000;justify-content:center;align-items:center;padding:20px}
.modal.show{display:flex}
.mbox{background:rgba(10,25,41,.95);border-radius:15px;border:1px solid rgba(0,229,255,.3);width:100%;max-width:500px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,.5)}
.mbox.wide{max-width:750px}
.mh{padding:18px;border-bottom:1px solid rgba(0,229,255,.2);display:flex;justify-content:space-between;align-items:center}
.mt{font-family:'Orbitron';font-size:1.2rem}
.mx{background:none;border:none;color:var(--gr);font-size:1.5rem;cursor:pointer}
.mx:hover{color:var(--no)}
.mb{padding:18px}
.mf{padding:18px;border-top:1px solid rgba(0,229,255,.2);display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.fg{margin-bottom:15px}
.fg label{display:block;margin-bottom:6px;color:var(--gr);font-size:.85rem}
select,input[type=text],input[type=password],input[type=number]{width:100%;padding:12px;background:rgba(14,32,52,.8);border:1px solid rgba(0,229,255,.3);border-radius:8px;color:var(--lt);font-family:'Exo 2';font-size:.95rem}
select:focus,input:focus{outline:none;border-color:var(--p);box-shadow:0 0 10px rgba(0,229,255,.3)}
.fr{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tabs{display:flex;gap:8px;margin-bottom:20px;border-bottom:1px solid rgba(0,229,255,.2);padding-bottom:12px;flex-wrap:wrap}
.tab{padding:8px 16px;background:rgba(14,32,52,.5);border:1px solid rgba(0,229,255,.2);border-radius:8px;color:var(--gr);cursor:pointer;transition:.3s;font-family:'Orbitron';font-size:.8rem;font-weight:600}
.tab.active{background:linear-gradient(90deg,var(--p),var(--pd));color:white;border-color:var(--p)}
.tc{display:none}
.tc.active{display:block}
.ucard{background:rgba(14,32,52,.5);border:1px solid rgba(0,229,255,.2);border-radius:10px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;transition:.3s}
.ucard:hover{border-color:var(--p)}
.uinfo h4{font-family:'Orbitron';font-size:1rem;margin-bottom:6px}
.umeta{display:flex;flex-wrap:wrap;gap:10px;font-size:.8rem;color:var(--gr)}
.umeta span{display:flex;align-items:center;gap:4px}
.umeta i{color:var(--p)}
.uact{display:flex;gap:6px;flex-wrap:wrap}
.uact .btn{padding:6px 10px;font-size:.75rem}
.abadge{display:inline-block;padding:2px 7px;background:linear-gradient(90deg,var(--s),#4a148c);border-radius:10px;font-size:.65rem;color:white;font-weight:700;margin-left:6px}
.toast{position:fixed;bottom:20px;right:20px;background:rgba(10,25,41,.95);border:1px solid var(--p);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 25px rgba(0,0,0,.4);z-index:2000;transform:translateY(100px);opacity:0;transition:.4s}
.toast.show{transform:translateY(0);opacity:1}
.toast i{font-size:1.3rem;color:var(--p)}
.toast h4{color:var(--lt);margin-bottom:3px;font-size:.95rem}
.toast p{color:var(--gr);font-size:.85rem}
.empty{text-align:center;padding:50px 20px;grid-column:1/-1}
.empty i{font-size:3.5rem;color:rgba(0,229,255,.2);margin-bottom:15px}
.empty h3{font-size:1.3rem;margin-bottom:8px}
.empty p{color:var(--gr);margin-bottom:20px}
.footer{text-align:center;padding:20px;color:var(--gr);font-size:.85rem;border-top:1px solid rgba(0,229,255,.1);margin-top:20px}
.footer a{color:var(--p);text-decoration:none}
@keyframes shake{0%,100%{transform:translateX(0)}10%,30%,50%,70%,90%{transform:translateX(-5px)}20%,40%,60%,80%{transform:translateX(5px)}}
@media(max-width:768px){.dash{grid-template-columns:1fr}.header{flex-direction:column;text-align:center}.fr{grid-template-columns:1fr}.cdet{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="grid"></div>

<div class="login" id="loginScr">
<div class="login-box">
<div class="logo">PUG62</div>
<p class="tag">WireGuard Management Panel</p>
<div class="ig"><label><i class="fas fa-user"></i> USERNAME</label><input type="text" id="lu" placeholder="Username" autocomplete="username"></div>
<div class="ig"><label><i class="fas fa-key"></i> PASSWORD</label><input type="password" id="lp" placeholder="Password" autocomplete="current-password"></div>
<button class="btn btn-full" id="lbtn"><i class="fas fa-sign-in-alt"></i> ACCESS PANEL</button>
<div style="margin-top:25px;color:var(--gr);font-size:.85rem">
<p>By <a href="https://t.me/PUG62" target="_blank" style="color:var(--p);text-decoration:none">PUG62</a></p>
</div>
</div>
</div>

<div class="panel" id="mainPanel">
<div class="header">
<div><h1><i class="fas fa-shield-alt"></i> PUG62</h1></div>
<div class="hright">
<button class="btn btn-sm" id="setBtn" style="display:none" onclick="openSet()"><i class="fas fa-cog"></i> SETTINGS</button>
<button class="btn btn-sm" onclick="openM('createM')"><i class="fas fa-plus"></i> CREATE</button>
<div class="ubox">
<i class="fas fa-user-secret" style="color:var(--p)"></i>
<span id="hUser">USER</span>
<span class="badge" id="hRole">ADMIN</span>
<span class="days-left" id="hDays" style="display:none"></span>
</div>
<button class="btn btn-sm btn-danger" onclick="logout()"><i class="fas fa-sign-out-alt"></i></button>
</div>
</div>
<div class="dash" id="dash"></div>
<div class="footer">
<p>© 2024 PUG62 WireGuard Panel</p>
<a href="https://t.me/PUG62" target="_blank"><i class="fab fa-telegram"></i> @PUG62</a>
</div>
</div>

<div class="modal" id="createM">
<div class="mbox">
<div class="mh"><h2 class="mt"><i class="fas fa-plus-circle"></i> CREATE CONFIG</h2><button class="mx" onclick="closeM('createM')">&times;</button></div>
<div class="mb">
<div class="fg"><label>NAME</label><input type="text" id="cName" placeholder="Config name"></div>
<div class="fr">
<div class="fg"><label>SERVER</label><select id="cSrv"><option value="UAE">🇦🇪 UAE</option><option value="TR">🇹🇷 Turkey</option><option value="IR">🇮🇷 Iran</option></select></div>
<div class="fg"><label>VOLUME (GB)</label><select id="cVol"><option value="50">50</option><option value="100" selected>100</option><option value="200">200</option><option value="500">500</option><option value="unlimited">Unlimited</option></select></div>
</div>
<div class="fr">
<div class="fg"><label>DAYS</label><select id="cDays"><option value="7">7</option><option value="30" selected>30</option><option value="90">90</option><option value="180">180</option><option value="365">365</option></select></div>
<div class="fg"><label>DAILY (GB)</label><select id="cDaily"><option value="5">5</option><option value="10" selected>10</option><option value="20">20</option><option value="50">50</option><option value="unlimited">Unlimited</option></select></div>
</div>
</div>
<div class="mf"><button class="btn btn-sm" onclick="closeM('createM')">CANCEL</button><button class="btn btn-sm" onclick="createCfg()">CREATE</button></div>
</div>
</div>

<div class="modal" id="detM">
<div class="mbox">
<div class="mh"><h2 class="mt"><i class="fas fa-info-circle"></i> DETAILS</h2><button class="mx" onclick="closeM('detM')">&times;</button></div>
<div class="mb" id="detBody"></div>
<div class="mf"><button class="btn btn-sm" onclick="dlCur()">DOWNLOAD</button><button class="btn btn-sm" onclick="closeM('detM')">CLOSE</button></div>
</div>
</div>

<div class="modal" id="setM">
<div class="mbox wide">
<div class="mh"><h2 class="mt"><i class="fas fa-cog"></i> SETTINGS</h2><button class="mx" onclick="closeM('setM')">&times;</button></div>
<div class="mb">
<div class="tabs">
<button class="tab active" onclick="showTab('uTab',this)"><i class="fas fa-users"></i> USERS</button>
<button class="tab" onclick="showTab('cTab',this)"><i class="fas fa-user-plus"></i> CREATE USER</button>
</div>
<div id="uTab" class="tc active"><div id="uList"></div></div>
<div id="cTab" class="tc">
<div class="fg"><label>USERNAME</label><input type="text" id="nUser" placeholder="Username"></div>
<div class="fg"><label>PASSWORD</label><input type="password" id="nPass" placeholder="Password"></div>
<div class="fg"><label>DAYS</label><input type="number" id="nDays" value="10" min="1" max="3650"></div>
<button class="btn btn-full" onclick="createUser()"><i class="fas fa-user-plus"></i> CREATE USER</button>
</div>
</div>
</div>
</div>

<div class="modal" id="extM">
<div class="mbox">
<div class="mh"><h2 class="mt"><i class="fas fa-calendar-plus"></i> EDIT USER</h2><button class="mx" onclick="closeM('extM')">&times;</button></div>
<div class="mb">
<p style="color:var(--gr);margin-bottom:15px">User: <strong id="extU" style="color:var(--p)"></strong></p>
<div class="fg"><label>EXTEND DAYS</label><input type="number" id="extD" value="30" min="1"></div>
<div class="fg"><label>NEW PASSWORD (leave empty to keep)</label><input type="password" id="extP" placeholder="New password"></div>
</div>
<div class="mf"><button class="btn btn-sm" onclick="closeM('extM')">CANCEL</button><button class="btn btn-sm" onclick="saveExt()">SAVE</button></div>
</div>
</div>

<div class="modal" id="subM">
<div class="mbox">
<div class="mh"><h2 class="mt"><i class="fas fa-link"></i> SUB LINK</h2><button class="mx" onclick="closeM('subM')">&times;</button></div>
<div class="mb">
<p style="color:var(--gr);margin-bottom:12px;font-size:.85rem">Copy this link for subscription:</p>
<input type="text" id="subIn" readonly style="font-size:.8rem">
</div>
<div class="mf"><button class="btn btn-sm" onclick="closeM('subM')">CLOSE</button><button class="btn btn-sm" onclick="copySub()">COPY</button></div>
</div>
</div>

<div class="toast" id="toast"><i class="fas fa-check-circle"></i><div><h4 id="tT">OK</h4><p id="tM">Done</p></div></div>

<script>
const API='/api';
let token=localStorage.getItem('pug_t');
let me=null,configs=[],curCfg=null,curUser=null;

const TMPL={
UAE:'[Interface]\\nPrivateKey = aDi30cQATlyFXRlOmLzjK68vQxBe7kDYPisjB8Jg51A=\\nAddress = 10.109.77.164/32\\nDNS = 1.1.1.1, 1.181.121.10\\n\\n[Peer]\\nPublicKey = 3ArEYLg6wR6NYXrg4RTlI4kQmi5iX0z1ERpfKyxSxhk=\\nAllowedIPs = ::/0\\nEndpoint = 0.0.0.0:51820\\nPersistentKeepalive = 25',
TR:'[Interface]\\nPrivateKey = iKhR4GJ5wBstKxjkwUDHkMVUoMUL8lxTmql0iW2JTUE=\\nAddress = 10.49.101.173/32\\nDNS = 1.1.1.1, 1.180.197.251\\n\\n[Peer]\\nPublicKey = 8H3ovcm3xmFxfhmq5jV7aiza4itoynGgOu1tpL7jJEg=\\nAllowedIPs = ::/0\\nEndpoint = 0.0.0.0:51820\\nPersistentKeepalive = 25',
IR:'[Interface]\\nPrivateKey = kNvr1/n8GbdzCdQxqlBeWQUur2XP5wbB0fjmHnwFZUQ=\\nAddress = 10.39.89.26/32\\nDNS = 1.1.1.1, 1.182.102.115\\n\\n[Peer]\\nPublicKey = aFP5M1M2VUEByYqLt29xyUCmNT2vYXsVGiUG+DSl2Uo=\\nAllowedIPs = ::/0\\nEndpoint = 0.0.0.0:51820\\nPersistentKeepalive = 25'
};

function api(p,o={}){o.headers=o.headers||{};if(token)o.headers['x-auth-token']=token;if(o.body){o.headers['Content-Type']='application/json';o.body=JSON.stringify(o.body)}return fetch(API+p,o).then(r=>r.json())}
function toast(t,m,type='ok'){const el=document.getElementById('toast');el.querySelector('i').className='fas fa-'+(type==='err'?'exclamation-circle':type==='warn'?'exclamation-triangle':'check-circle');el.style.borderColor=type==='err'?'var(--no)':type==='warn'?'var(--w)':'var(--p)';document.getElementById('tT').textContent=t;document.getElementById('tM').textContent=m;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3500)}
function openM(id){document.getElementById(id).classList.add('show')}
function closeM(id){document.getElementById(id).classList.remove('show')}
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeM(m.id)}));

async function login(){
const u=document.getElementById('lu').value.trim();
const p=document.getElementById('lp').value;
if(!u||!p){toast('Error','Enter credentials','err');return}
const d=await api('/login',{method:'POST',body:{username:u,password:p}});
if(!d.token){toast('Error',d.error||'Failed','err');document.querySelector('.login-box').style.animation='shake .5s';setTimeout(()=>document.querySelector('.login-box').style.animation='',500);return}
token=d.token;localStorage.setItem('pug_t',token);me=d;showPanel()}

async function checkMe(){
if(!token)return showLogin();
const d=await api('/me');
if(!d.username){localStorage.removeItem('pug_t');token=null;showLogin();return}
me=d;showPanel()}

function showLogin(){document.getElementById('loginScr').style.display='flex';document.getElementById('mainPanel').style.display='none'}
function showPanel(){
document.getElementById('loginScr').style.display='none';
document.getElementById('mainPanel').style.display='block';
document.getElementById('hUser').textContent=me.username;
document.getElementById('hRole').textContent=me.role.toUpperCase();
const hd=document.getElementById('hDays');
if(me.daysRemaining!==null){hd.style.display='inline-block';hd.textContent=me.daysRemaining+'d left';if(me.daysRemaining===0){hd.classList.add('expired');hd.textContent='EXPIRED'}}else hd.style.display='none';
document.getElementById('setBtn').style.display=me.role==='admin'?'inline-flex':'none';
loadCfgs()}

function logout(){localStorage.removeItem('pug_t');token=null;me=null;showLogin()}

async function loadCfgs(){
const d=await api('/configs');
configs=Array.isArray(d)?d:[];
if(!Array.isArray(d)&&d.error){toast('Error',d.error,'err');if(d.error==='Expired')logout();return}
renderCfgs()}

function renderCfgs(){
const el=document.getElementById('dash');
if(!configs.length){el.innerHTML='<div class="empty"><i class="fas fa-shield-alt"></i><h3>No Configs</h3><p>Create your first config</p><button class="btn" onclick="openM(\\'createM\\')"><i class="fas fa-plus"></i> CREATE</button></div>';return}
el.innerHTML=configs.sort((a,b)=>String(b.id).localeCompare(String(a.id))).map(c=>{
const dr=Math.max(0,Math.ceil((new Date(c.expireDate)-new Date())/864e5));
const vp=c.volume===-1?0:Math.min(100,(c.volumeUsed/c.volume)*100);
const ob=me.role==='admin'&&c.owner&&c.owner!==me.username?'<span style="color:var(--w);font-size:.75rem"> 👤'+c.owner+'</span>':'';
return '<div class="card"><div class="card-h"><h3 class="card-t">'+c.name+ob+'</h3><div style="position:relative"><button class="mbtn" onclick="togMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="dd"><a onclick="togCfg(\\''+c.id+'\\')"><i class="fas fa-power-off"></i> '+(c.isActive?'Disable':'Enable')+'</a><a onclick="showDet(\\''+c.id+'\\')"><i class="fas fa-info-circle"></i> Details</a><a onclick="openAD(\\''+c.id+'\\')"><i class="fas fa-database"></i> Add Data</a><a onclick="openADy(\\''+c.id+'\\')"><i class="fas fa-calendar-plus"></i> Add Days</a><a onclick="dlCfg(\\''+c.id+'\\')"><i class="fas fa-download"></i> Download</a><a onclick="copySubL(\\''+c.id+'\\')"><i class="fas fa-link"></i> Sub Link</a><a onclick="delCfg(\\''+c.id+'\\')" style="color:var(--no)"><i class="fas fa-trash"></i> Delete</a></div></div></div><div class="cstat"><div class="sdot '+(c.isActive?'':'off')+'"></div><span class="stxt">'+(c.isActive?'Active':'Inactive')+'</span><label class="tog"><input type="checkbox" '+(c.isActive?'checked':'')+' onchange="togCfg(\\''+c.id+'\\')"><span class="sl"></span></label></div><div class="cdet"><div class="di"><div class="dl">SERVER</div><div class="dv">'+c.country+'</div></div><div class="di"><div class="dl">DAYS LEFT</div><div class="dv">'+dr+'</div></div><div class="di"><div class="dl">TOTAL</div><div class="dv">'+(c.volume===-1?'∞':c.volume+' GB')+'</div></div><div class="di"><div class="dl">USED</div><div class="dv">'+c.volumeUsed.toFixed(1)+' GB</div></div></div><div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.8rem;color:var(--gr);margin-bottom:4px"><span>Data</span><span>'+c.volumeUsed.toFixed(1)+'/'+(c.volume===-1?'∞':c.volume)+' GB</span></div><div class="pbar"><div class="pfill" style="width:'+vp+'%"></div></div></div><div class="cact"><button class="btn btn-sm" onclick="showDet(\\''+c.id+'\\')"><i class="fas fa-info-circle"></i></button><button class="btn btn-sm" onclick="dlCfg(\\''+c.id+'\\')"><i class="fas fa-download"></i></button><button class="btn btn-sm" onclick="copySubL(\\''+c.id+'\\')"><i class="fas fa-link"></i></button></div></div>'}).join('')}

function togMenu(b){document.querySelectorAll('.dd').forEach(d=>{if(d!==b.nextElementSibling)d.classList.remove('show')});b.nextElementSibling.classList.toggle('show')}
document.addEventListener('click',e=>{if(!e.target.closest('.mbtn'))document.querySelectorAll('.dd').forEach(d=>d.classList.remove('show'))});

function getCfg(id){return configs.find(c=>c.id===id)}

async function createCfg(){
const name=document.getElementById('cName').value.trim();
if(!name){toast('Error','Enter name','err');return}
const body={name,country:document.getElementById('cSrv').value,volume:document.getElementById('cVol').value,days:document.getElementById('cDays').value,dailyLimit:document.getElementById('cDaily').value};
const d=await api('/configs',{method:'POST',body});
if(!d.ok){toast('Error',d.error,'err');return}
closeM('createM');document.getElementById('cName').value='';
toast('Created','Config "'+name+'" created');
dlDirect(d.config);loadCfgs()}

async function togCfg(id){
const c=getCfg(id);if(!c)return;
await api('/configs/'+id,{method:'PUT',body:{isActive:!c.isActive}});
loadCfgs()}

function showDet(id){
const c=getCfg(id);if(!c)return;curCfg=c;
const dr=Math.max(0,Math.ceil((new Date(c.expireDate)-new Date())/864e5));
const vp=c.volume===-1?0:Math.min(100,(c.volumeUsed/c.volume)*100);
document.getElementById('detBody').innerHTML='<div class="cdet" style="grid-template-columns:1fr"><div class="di"><div class="dl">NAME</div><div class="dv">'+c.name+'</div></div></div><div class="fr"><div class="di"><div class="dl">SERVER</div><div class="dv">'+c.country+'</div></div><div class="di"><div class="dl">CREATED</div><div class="dv">'+new Date(c.createdDate).toLocaleDateString()+'</div></div></div><div class="fr"><div class="di"><div class="dl">EXPIRE</div><div class="dv">'+new Date(c.expireDate).toLocaleDateString()+' ('+dr+'d)</div></div><div class="di"><div class="dl">STATUS</div><div class="dv" style="color:'+(c.isActive?'var(--ok)':'var(--no)')+'">'+(c.isActive?'ACTIVE':'INACTIVE')+'</div></div></div><div class="fr"><div class="di"><div class="dl">TOTAL</div><div class="dv">'+(c.volume===-1?'Unlimited':c.volume+' GB')+'</div></div><div class="di"><div class="dl">USED</div><div class="dv">'+c.volumeUsed.toFixed(1)+' GB ('+vp.toFixed(1)+'%)</div></div></div><div style="margin-top:15px"><div style="display:flex;justify-content:space-between;font-size:.85rem;color:var(--gr);margin-bottom:4px"><span>Usage</span><span>'+c.volumeUsed.toFixed(1)+'/'+(c.volume===-1?'∞':c.volume)+' GB</span></div><div class="pbar"><div class="pfill" style="width:'+vp+'%"></div></div></div>';
openM('detM')}

function dlCfg(id){const c=getCfg(id);if(c)dlDirect(c)}
function dlDirect(c){
const txt=(TMPL[c.country]||TMPL.UAE).replace(/\\\\n/g,'\\n');
const b=new Blob([txt],{type:'application/octet-stream'});
const a=document.createElement('a');a.href=URL.createObjectURL(b);
let n=c.name;if(!n.endsWith('.conf'))n+='.conf';
a.download=n;a.click();URL.revokeObjectURL(a.href);
toast('Downloaded',c.name+' downloaded')}
function dlCur(){if(curCfg){dlCfg(curCfg.id);closeM('detM')}}

async function delCfg(id){
if(!confirm('Delete this config?'))return;
await api('/configs/'+id,{method:'DELETE'});
toast('Deleted','Config deleted');loadCfgs()}

function copySubL(id){
const c=getCfg(id);if(!c)return;
const link=location.origin+'/sub?sub='+c.subId;
document.getElementById('subIn').value=link;
openM('subM');
navigator.clipboard.writeText(link).then(()=>toast('Copied','Link copied')).catch(()=>toast('Manual','Copy from input','warn'))}
function copySub(){const i=document.getElementById('subIn');i.select();document.execCommand('copy');toast('Copied','Link copied')}

// Settings
function openSet(){loadUsers();openM('setM')}
function showTab(id,btn){document.querySelectorAll('.tc').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.getElementById(id).classList.add('active');btn.classList.add('active')}

async function loadUsers(){
const d=await api('/users');
const el=document.getElementById('uList');
if(!Array.isArray(d)||!d.length){el.innerHTML='<p style="text-align:center;color:var(--gr)">No users</p>';return}
el.innerHTML=d.map(u=>'<div class="ucard"><div class="uinfo"><h4>'+u.username+(u.role==='admin'?'<span class="abadge">ADMIN</span>':'')+'</h4><div class="umeta"><span><i class="fas fa-calendar"></i> '+(u.daysRemaining!==null?u.daysRemaining+'d':'∞')+'</span><span><i class="fas fa-'+(u.isActive?'check-circle':'times-circle')+'"></i> '+(u.isActive?'Active':'Disabled')+'</span>'+(u.expiresAt?'<span><i class="fas fa-clock"></i> '+new Date(u.expiresAt).toLocaleDateString()+'</span>':'')+'</div></div><div class="uact">'+(u.role!=='admin'?'<button class="btn btn-sm" onclick="openExt(\\''+u.username+'\\')"><i class="fas fa-edit"></i></button><button class="btn btn-sm btn-danger" onclick="delUser(\\''+u.username+'\\')"><i class="fas fa-trash"></i></button>':'')+'</div></div>').join('')}

async function createUser(){
const u=document.getElementById('nUser').value.trim();
const p=document.getElementById('nPass').value;
const d=parseInt(document.getElementById('nDays').value);
if(!u||!p){toast('Error','Fill all fields','err');return}
const r=await api('/users',{method:'POST',body:{username:u,password:p,days:d}});
if(!r.ok){toast('Error',r.error,'err');return}
document.getElementById('nUser').value='';document.getElementById('nPass').value='';
toast('Created','User "'+u+'" created ('+d+'d)');loadUsers()}

function openExt(u){curUser=u;document.getElementById('extU').textContent=u;document.getElementById('extP').value='';openM('extM')}
async function saveExt(){
const d=parseInt(document.getElementById('extD').value);
const p=document.getElementById('extP').value;
const body={};if(d>0)body.extendDays=d;if(p)body.newPassword=p;
await api('/users/'+curUser,{method:'PUT',body});
closeM('extM');toast('Updated','User updated');loadUsers()}

async function delUser(u){
if(!confirm('Delete "'+u+'"?'))return;
await api('/users/'+u,{method:'DELETE'});
toast('Deleted','User deleted');loadUsers()}

// Add Data/Days modals (inline)
async function openAD(id){
const amt=prompt('Amount (GB):','10');
if(!amt||isNaN(amt)||amt<=0)return;
const c=getCfg(id);if(!c)return;
const nv=c.volume===-1?-1:c.volume+parseInt(amt);
await api('/configs/'+id,{method:'PUT',body:{volume:nv}});
toast('Added',amt+' GB added');loadCfgs()}

async function openADy(id){
const d=prompt('Days to add:','30');
if(!d||isNaN(d)||d<=0)return;
const c=getCfg(id);if(!c)return;
const ne=new Date(c.expireDate);ne.setDate(ne.getDate()+parseInt(d));
await api('/configs/'+id,{method:'PUT',body:{expireDate:ne.toISOString(),days:c.days+parseInt(d)}});
toast('Extended',d+' days added');loadCfgs()}

document.getElementById('lbtn').addEventListener('click',login);
document.getElementById('lp').addEventListener('keypress',e=>{if(e.key==='Enter')login()});
document.getElementById('lu').addEventListener('keypress',e=>{if(e.key==='Enter')login()});

checkMe();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), HTML);
console.log('✅ HTML created');

// ===================== Express =====================
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ===================== Database =====================
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { users: [], sessions: {}, configs: {} };
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { return { users: [], sessions: {}, configs: {} }; }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

let db = loadData();

if (!db.users.find(u => u.username === 'arian')) {
    db.users.push({
        username: 'arian', password: 'arian@11USER', role: 'admin',
        createdAt: new Date().toISOString(), expiresAt: null, isActive: true
    });
    saveData();
    console.log('✅ Admin: arian / arian@11USER');
}

const genToken = () => crypto.randomBytes(32).toString('hex');
const daysLeft = (exp) => exp ? Math.max(0, Math.ceil((new Date(exp) - new Date()) / 864e5)) : null;

// ===================== Middleware =====================
function auth(req, res, next) {
    const token = req.headers['x-auth-token'];
    const sess = db.sessions[token];
    if (!sess) return res.status(401).json({ error: 'Unauthorized' });
    const user = db.users.find(u => u.username === sess.username);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (!user.isActive) return res.status(403).json({ error: 'Disabled' });
    if (user.expiresAt && new Date(user.expiresAt) < new Date())
        return res.status(403).json({ error: 'Expired' });
    req.user = user;
    req.token = token;
    next();
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
}

// ===================== Auth API =====================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.isActive) return res.status(403).json({ error: 'Disabled' });
    if (user.expiresAt && new Date(user.expiresAt) < new Date())
        return res.status(403).json({ error: 'Expired' });

    const token = genToken();
    db.sessions[token] = { username, at: new Date().toISOString() };
    saveData();

    res.json({
        token, username: user.username, role: user.role,
        expiresAt: user.expiresAt, daysRemaining: daysLeft(user.expiresAt)
    });
});

app.get('/api/me', auth, (req, res) => {
    res.json({
        username: req.user.username, role: req.user.role,
        expiresAt: req.user.expiresAt, isActive: req.user.isActive,
        daysRemaining: daysLeft(req.user.expiresAt)
    });
});

app.post('/api/logout', auth, (req, res) => {
    delete db.sessions[req.token];
    saveData();
    res.json({ ok: true });
});

// ===================== Users API =====================
app.get('/api/users', auth, adminOnly, (req, res) => {
    res.json(db.users.map(u => ({
        username: u.username, role: u.role, createdAt: u.createdAt,
        expiresAt: u.expiresAt, isActive: u.isActive, daysRemaining: daysLeft(u.expiresAt)
    })));
});

app.post('/api/users', auth, adminOnly, (req, res) => {
    const { username, password, days } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Required' });
    if (db.users.find(u => u.username === username))
        return res.status(400).json({ error: 'Exists' });

    const expiresAt = days ? new Date(Date.now() + days * 864e5).toISOString() : null;
    db.users.push({
        username, password, role: 'user',
        createdAt: new Date().toISOString(), expiresAt, isActive: true
    });
    saveData();
    res.json({ ok: true });
});

app.put('/api/users/:username', auth, adminOnly, (req, res) => {
    const user = db.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Cannot modify admin' });

    const { isActive, extendDays, newPassword } = req.body;
    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (extendDays > 0) {
        const base = user.expiresAt && new Date(user.expiresAt) > new Date()
            ? new Date(user.expiresAt) : new Date();
        user.expiresAt = new Date(base.getTime() + extendDays * 864e5).toISOString();
    }
    if (newPassword) user.password = newPassword;

    saveData();
    res.json({ ok: true, daysRemaining: daysLeft(user.expiresAt) });
});

app.delete('/api/users/:username', auth, adminOnly, (req, res) => {
    const user = db.users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin' });

    db.users = db.users.filter(u => u.username !== req.params.username);
    delete db.configs[req.params.username];
    saveData();
    res.json({ ok: true });
});

// ===================== Configs API =====================
app.get('/api/configs', auth, (req, res) => {
    if (req.user.role === 'admin') {
        const all = [];
        for (const u in db.configs) {
            db.configs[u].forEach(c => all.push({ ...c, owner: u }));
        }
        return res.json(all);
    }
    res.json((db.configs[req.user.username] || []).map(c => ({ ...c, owner: req.user.username })));
});

app.post('/api/configs', auth, (req, res) => {
    const { name, country, volume, days, dailyLimit } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const config = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        subId: 'sub_' + crypto.randomBytes(8).toString('hex'),
        name, country,
        volume: volume === 'unlimited' ? -1 : parseInt(volume),
        volumeUsed: 0,
        dailyLimit: dailyLimit === 'unlimited' ? -1 : parseInt(dailyLimit),
        dailyUsed: 0,
        days: parseInt(days), daysUsed: 0,
        createdDate: new Date().toISOString(),
        expireDate: new Date(Date.now() + parseInt(days) * 864e5).toISOString(),
        isActive: true,
        usageHistory: []
    };

    if (!db.configs[req.user.username]) db.configs[req.user.username] = [];
    db.configs[req.user.username].push(config);
    saveData();
    res.json({ ok: true, config });
});

app.put('/api/configs/:id', auth, (req, res) => {
    const owner = req.user.role === 'admin'
        ? Object.keys(db.configs).find(u => db.configs[u].some(c => c.id === req.params.id))
        : req.user.username;
    const list = db.configs[owner];
    if (!list) return res.status(404).json({ error: 'Not found' });
    const cfg = list.find(c => c.id === req.params.id);
    if (!cfg) return res.status(404).json({ error: 'Not found' });

    Object.assign(cfg, req.body);
    saveData();
    res.json({ ok: true, config: cfg });
});

app.delete('/api/configs/:id', auth, (req, res) => {
    const owner = req.user.role === 'admin'
        ? Object.keys(db.configs).find(u => db.configs[u].some(c => c.id === req.params.id))
        : req.user.username;
    if (!owner || !db.configs[owner]) return res.status(404).json({ error: 'Not found' });

    db.configs[owner] = db.configs[owner].filter(c => c.id !== req.params.id);
    saveData();
    res.json({ ok: true });
});

// ===================== Sub Page =====================
app.get('/sub', (req, res) => {
    const subId = req.query.sub;
    if (!subId) return res.status(400).send('Missing sub id');

    let found = null;
    for (const u in db.configs) {
        const c = db.configs[u].find(c => c.subId === subId);
        if (c) { found = { ...c, owner: u }; break; }
    }
    if (!found) return res.status(404).send('Not found');

    const daysR = Math.max(0, Math.ceil((new Date(found.expireDate) - new Date()) / 864e5));
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${found.name}</title>
<style>body{margin:0;padding:20px;background:#0a1929;color:#e3f2fd;font-family:Arial,sans-serif;text-align:center}
.card{background:rgba(10,25,41,.9);border:1px solid rgba(0,229,255,.3);border-radius:15px;padding:30px;max-width:500px;margin:50px auto}
h1{color:#00e5ff;margin-bottom:20px}
.info{margin:15px 0;padding:15px;background:rgba(14,32,52,.5);border-radius:10px;text-align:left}
.info div{margin:8px 0;display:flex;justify-content:space-between}
.status{display:inline-block;padding:5px 15px;border-radius:20px;font-weight:bold;margin:10px 0}
.active{background:rgba(0,230,118,.2);color:#00e676;border:1px solid #00e676}
.inactive{background:rgba(255,64,129,.2);color:#ff4081;border:1px solid #ff4081}
</style></head><body>
<div class="card">
<h1>🛡️ ${found.name}</h1>
<div class="status ${found.isActive?'active':'inactive'}">${found.isActive?'✅ Active':'❌ Inactive'}</div>
<div class="info">
<div><span>Server:</span><span>${found.country}</span></div>
<div><span>Volume:</span><span>${found.volume===-1?'Unlimited':found.volume+' GB'}</span></div>
<div><span>Used:</span><span>${found.volumeUsed.toFixed(1)} GB</span></div>
<div><span>Days Left:</span><span>${daysR}</span></div>
<div><span>Owner:</span><span>${found.owner}</span></div>
</div>
</div></body></html>`);
});

// ===================== Fallback =====================
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ===================== Start =====================
app.listen(PORT, () => {
    console.log(`✅ PUG62 Panel on port ${PORT}`);
    console.log(`👤 Admin: arian / arian@11USER`);
});

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ===================== Create HTML File =====================
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PUG62 Panel</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700&family=Exo+2:wght@300;400;600&display=swap" rel="stylesheet">
<style>
:root{--p:#00e5ff;--pd:#0097a7;--s:#7b1fa2;--ok:#00e676;--no:#ff4081;--w:#ff9100;--gr:#8b9bb5;--lt:#e3f2fd}
*{margin:0;padding:0;box-sizing:border-box}
body{background:linear-gradient(135deg,#0a1929 0%,#0c1b2e 50%,#0d1f36 100%);color:var(--lt);font-family:'Exo 2',sans-serif;min-height:100vh;overflow-x:hidden}
.grid{position:fixed;inset:0;background-image:linear-gradient(rgba(0,229,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.03) 1px,transparent 1px);background-size:40px;z-index:-1}
.login-screen{display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.login-box{background:rgba(10,25,41,.95);border-radius:20px;border:1px solid rgba(0,229,255,.2);width:100%;max-width:450px;padding:40px;text-align:center;box-shadow:0 15px 35px rgba(0,0,0,.5)}
.logo{font-family:'Orbitron';font-size:2.5rem;font-weight:900;background:linear-gradient(90deg,var(--p),var(--s));-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:20px}
.input-group{margin-bottom:20px;text-align:left}
.input-group label{display:block;margin-bottom:8px;color:var(--gr);font-size:.9rem}
input[type="text"],input[type="password"]{width:100%;padding:12px;background:rgba(14,32,52,.8);border:1px solid rgba(0,229,255,.3);border-radius:8px;color:var(--lt);font-family:'Exo 2';font-size:1rem;transition:.3s}
input:focus{outline:none;border-color:var(--p);box-shadow:0 0 10px rgba(0,229,255,.3)}
.btn{padding:12px 24px;background:linear-gradient(90deg,var(--p),var(--pd));border:none;border-radius:8px;color:white;font-family:'Exo 2';font-weight:600;cursor:pointer;transition:.3s;display:flex;align-items:center;gap:8px;width:100%;justify-content:center;margin-top:10px}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,229,255,.3)}
.btn-sm{width:auto;padding:8px 16px;font-size:.9rem}
.btn-danger{background:linear-gradient(90deg,var(--no),#c2185b)}
.btn-warning{background:linear-gradient(90deg,var(--w),#e65100)}
.main-panel{display:none;min-height:100vh;padding:20px}
.header{display:flex;justify-content:space-between;align-items:center;padding:15px 20px;background:rgba(10,25,41,.8);border-radius:15px;border:1px solid rgba(0,229,255,.2);margin-bottom:30px;flex-wrap:wrap;gap:10px}
.header h1{font-family:'Orbitron';font-size:1.5rem;background:linear-gradient(90deg,var(--p),var(--s));-webkit-background-clip:text;background-clip:text;color:transparent}
.user-box{display:flex;align-items:center;gap:8px;padding:10px 15px;background:rgba(14,32,52,.8);border-radius:8px}
.badge{display:inline-block;padding:4px 10px;background:rgba(0,229,255,.2);border-radius:12px;font-size:.75rem;color:var(--p);font-weight:600}
.modal{display:none;position:fixed;inset:0;background:rgba(6,18,31,.95);z-index:1000;justify-content:center;align-items:center;padding:20px}
.modal.show{display:flex}
.modal-box{background:rgba(10,25,41,.95);border-radius:15px;border:1px solid rgba(0,229,255,.3);width:100%;max-width:500px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,.5)}
.modal-header{padding:20px;border-bottom:1px solid rgba(0,229,255,.2);display:flex;justify-content:space-between;align-items:center}
.modal-title{font-family:'Orbitron';font-size:1.2rem}
.close{background:none;border:none;color:var(--gr);font-size:1.5rem;cursor:pointer}
.modal-body{padding:20px}
.modal-footer{padding:20px;border-top:1px solid rgba(0,229,255,.2);display:flex;gap:10px;justify-content:flex-end}
.form-group{margin-bottom:15px}
.form-group label{display:block;margin-bottom:6px;color:var(--gr);font-size:.9rem}
select{width:100%;padding:10px;background:rgba(14,32,52,.8);border:1px solid rgba(0,229,255,.3);border-radius:8px;color:var(--lt);font-family:'Exo 2'}
select:focus{outline:none;border-color:var(--p)}
.dashboard{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;margin-bottom:30px}
.card{background:rgba(10,25,41,.8);border-radius:12px;border:1px solid rgba(0,229,255,.2);padding:15px;transition:.3s}
.card:hover{transform:translateY(-3px);border-color:var(--p)}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding-bottom:10px;border-bottom:1px solid rgba(0,229,255,.1)}
.card-title{font-family:'Orbitron';font-size:1.2rem}
.menu-btn{background:none;border:none;color:var(--gr);cursor:pointer;font-size:1rem}
.menu{position:absolute;background:rgba(10,25,41,.9);border:1px solid rgba(0,229,255,.3);border-radius:8px;min-width:150px;display:none;z-index:100}
.menu.show{display:block}
.menu-item{padding:10px 15px;color:var(--lt);cursor:pointer;text-decoration:none;display:block;transition:.2s;border-bottom:1px solid rgba(0,229,255,.1)}
.menu-item:hover{background:rgba(0,229,255,.1);color:var(--p)}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:15px}
.info-item{background:rgba(14,32,52,.5);padding:10px;border-radius:8px;border-left:3px solid var(--p)}
.info-label{font-size:.8rem;color:var(--gr)}
.info-value{font-size:1rem;font-weight:600;color:var(--lt);margin-top:4px}
.empty{text-align:center;padding:40px;color:var(--gr)}
.empty i{font-size:3rem;margin-bottom:15px;color:rgba(0,229,255,.2)}
.user-list{display:grid;gap:10px}
.user-item{background:rgba(14,32,52,.5);padding:15px;border-radius:8px;border:1px solid rgba(0,229,255,.2);display:flex;justify-content:space-between;align-items:center}
.user-info h4{font-family:'Orbitron';color:var(--lt);margin-bottom:5px;font-size:1rem}
.user-meta{font-size:.85rem;color:var(--gr);display:flex;gap:15px;flex-wrap:wrap}
.user-meta span{display:flex;align-items:center;gap:5px}
.user-actions{display:flex;gap:5px}
.toast{position:fixed;bottom:20px;right:20px;background:rgba(10,25,41,.95);border:1px solid var(--p);border-radius:8px;padding:15px 20px;display:none;gap:15px;align-items:center;z-index:2000;animation:slideIn .3s}
.toast.show{display:flex}
@keyframes slideIn{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}
.toast-icon{font-size:1.5rem;color:var(--p)}
.toast-text h4{color:var(--lt);margin-bottom:4px}
.toast-text p{color:var(--gr);font-size:.9rem}
@media(max-width:768px){.dashboard{grid-template-columns:1fr}.header{flex-direction:column;text-align:center}.info-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="grid"></div>

<!-- Login Screen -->
<div class="login-screen" id="loginScreen">
<div class="login-box">
<div class="logo">PUG62</div>
<p style="color:var(--gr);margin-bottom:30px">WireGuard Management Panel</p>
<div class="input-group">
<label>USERNAME</label>
<input type="text" id="loginUser" placeholder="Enter username" autocomplete="username">
</div>
<div class="input-group">
<label>PASSWORD</label>
<input type="password" id="loginPass" placeholder="Enter password" autocomplete="current-password">
</div>
<button class="btn" id="loginBtn"><i class="fas fa-sign-in-alt"></i> ACCESS</button>
</div>
</div>

<!-- Main Panel -->
<div class="main-panel" id="mainPanel">
<div class="header">
<div><h1><i class="fas fa-shield-alt"></i> PUG62</h1></div>
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
<button class="btn btn-sm" id="settingsBtn" style="display:none;width:auto" onclick="openModal('settingsModal')"><i class="fas fa-cog"></i> SETTINGS</button>
<button class="btn btn-sm" onclick="openModal('createModal')"><i class="fas fa-plus"></i> CREATE</button>
<div class="user-box">
<span id="userName">USER</span>
<span class="badge" id="userRole">ADMIN</span>
<span id="userDays" style="color:var(--w);font-size:.85rem"></span>
</div>
<button class="btn btn-sm" onclick="logout()" style="background:linear-gradient(90deg,var(--no),#c2185b)"><i class="fas fa-sign-out-alt"></i> LOGOUT</button>
</div>
</div>

<div class="dashboard" id="dashboard"></div>
</div>

<!-- Create Config Modal -->
<div class="modal" id="createModal">
<div class="modal-box">
<div class="modal-header">
<h2 class="modal-title"><i class="fas fa-plus-circle"></i> CREATE CONFIG</h2>
<button class="close" onclick="closeModal('createModal')">&times;</button>
</div>
<div class="modal-body">
<div class="form-group">
<label>CONFIG NAME</label>
<input type="text" id="cfgName" placeholder="Config name">
</div>
<div class="form-group">
<label>SERVER</label>
<select id="cfgServer">
<option value="UAE">🇦🇪 UAE</option>
<option value="TR">🇹🇷 Turkey</option>
<option value="IR">🇮🇷 Iran</option>
</select>
</div>
<div class="form-group">
<label>VOLUME (GB)</label>
<select id="cfgVolume">
<option value="50">50</option>
<option value="100" selected>100</option>
<option value="200">200</option>
<option value="unlimited">Unlimited</option>
</select>
</div>
<div class="form-group">
<label>DAYS</label>
<select id="cfgDays">
<option value="7">7</option>
<option value="30" selected>30</option>
<option value="90">90</option>
<option value="180">180</option>
</select>
</div>
</div>
<div class="modal-footer">
<button class="btn btn-sm" onclick="closeModal('createModal')">CANCEL</button>
<button class="btn btn-sm" onclick="createConfig()">CREATE</button>
</div>
</div>
</div>

<!-- Config Details Modal -->
<div class="modal" id="detailsModal">
<div class="modal-box">
<div class="modal-header">
<h2 class="modal-title"><i class="fas fa-info-circle"></i> DETAILS</h2>
<button class="close" onclick="closeModal('detailsModal')">&times;</button>
</div>
<div class="modal-body" id="detailsBody"></div>
<div class="modal-footer">
<button class="btn btn-sm" onclick="downloadConfig()">DOWNLOAD</button>
<button class="btn btn-sm" onclick="closeModal('detailsModal')">CLOSE</button>
</div>
</div>
</div>

<!-- Settings Modal -->
<div class="modal" id="settingsModal">
<div class="modal-box" style="max-width:600px">
<div class="modal-header">
<h2 class="modal-title"><i class="fas fa-cog"></i> SETTINGS</h2>
<button class="close" onclick="closeModal('settingsModal')">&times;</button>
</div>
<div class="modal-body">
<div style="display:flex;gap:10px;margin-bottom:20px;border-bottom:1px solid rgba(0,229,255,.2);padding-bottom:15px">
<button class="btn btn-sm active-tab" data-tab="users"><i class="fas fa-users"></i> USERS</button>
<button class="btn btn-sm" data-tab="create"><i class="fas fa-user-plus"></i> CREATE</button>
</div>
<div id="usersTab" class="tab-content" style="display:block">
<div id="usersList" class="user-list"></div>
</div>
<div id="createTab" class="tab-content" style="display:none">
<div class="form-group">
<label>USERNAME</label>
<input type="text" id="newUser" placeholder="Username">
</div>
<div class="form-group">
<label>PASSWORD</label>
<input type="password" id="newPass" placeholder="Password">
</div>
<div class="form-group">
<label>DAYS</label>
<input type="number" id="newDays" value="10" min="1">
</div>
<button class="btn" onclick="createUser()"><i class="fas fa-user-plus"></i> CREATE USER</button>
</div>
</div>
</div>
</div>

<!-- Edit User Modal -->
<div class="modal" id="editUserModal">
<div class="modal-box">
<div class="modal-header">
<h2 class="modal-title"><i class="fas fa-edit"></i> EDIT USER</h2>
<button class="close" onclick="closeModal('editUserModal')">&times;</button>
</div>
<div class="modal-body">
<p style="color:var(--gr);margin-bottom:20px">User: <strong id="editUserName" style="color:var(--p)"></strong></p>
<div class="form-group">
<label>EXTEND DAYS</label>
<input type="number" id="extendDays" value="30" min="1">
</div>
<div class="form-group">
<label>NEW PASSWORD</label>
<input type="password" id="editPass" placeholder="Leave empty to keep">
</div>
</div>
<div class="modal-footer">
<button class="btn btn-sm" onclick="closeModal('editUserModal')">CANCEL</button>
<button class="btn btn-sm" onclick="saveUserEdit()">SAVE</button>
</div>
</div>
</div>

<!-- Toast -->
<div class="toast" id="toast">
<div class="toast-icon"><i class="fas fa-check-circle"></i></div>
<div class="toast-text">
<h4 id="toastTitle">Success</h4>
<p id="toastMsg">Done</p>
</div>
</div>

<script>
const API='/api';
let token=localStorage.getItem('pug_token');
let me=null;
let configs=[];
let curUser=null;
let curCfg=null;

const templates={
UAE:\`[Interface]
PrivateKey = aDi30cQATlyFXRlOmLzjK68vQxBe7kDYPisjB8Jg51A=
Address = 10.109.77.164/32
DNS = 1.1.1.1, 1.181.121.10

[Peer]
PublicKey = 3ArEYLg6wR6NYXrg4RTlI4kQmi5iX0z1ERpfKyxSxhk=
AllowedIPs = ::/0
Endpoint = 0.0.0.0:51820
PersistentKeepalive = 25\`,
TR:\`[Interface]
PrivateKey = iKhR4GJ5wBstKxjkwUDHkMVUoMUL8lxTmql0iW2JTUE=
Address = 10.49.101.173/32
DNS = 1.1.1.1, 1.180.197.251

[Peer]
PublicKey = 8H3ovcm3xmFxfhmq5jV7aiza4itoynGgOu1tpL7jJEg=
AllowedIPs = ::/0
Endpoint = 0.0.0.0:51820
PersistentKeepalive = 25\`,
IR:\`[Interface]
PrivateKey = kNvr1/n8GbdzCdQxqlBeWQUur2XP5wbB0fjmHnwFZUQ=
Address = 10.39.89.26/32
DNS = 1.1.1.1, 1.182.102.115

[Peer]
PublicKey = aFP5M1M2VUEByYqLt29xyUCmNT2vYXsVGiUG+DSl2Uo=
AllowedIPs = ::/0
Endpoint = 0.0.0.0:51820
PersistentKeepalive = 25\`
};

function api(path,opt={}){opt.headers=opt.headers||{};if(token)opt.headers['x-auth-token']=token;if(opt.body){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(opt.body)}return fetch(API+path,opt).then(r=>r.json())}

function toast(t,m){document.getElementById('toastTitle').textContent=t;document.getElementById('toastMsg').textContent=m;const el=document.getElementById('toast');el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3000)}

function openModal(id){document.getElementById(id).classList.add('show')}
function closeModal(id){document.getElementById(id).classList.remove('show')}

document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show')}));

document.querySelectorAll('[data-tab]').forEach(btn=>{btn.addEventListener('click',e=>{document.querySelectorAll('.tab-content').forEach(t=>t.style.display='none');document.querySelectorAll('[data-tab]').forEach(b=>b.classList.remove('active-tab'));document.getElementById(btn.dataset.tab+'Tab').style.display='block';btn.classList.add('active-tab')})});

async function doLogin(){
const u=document.getElementById('loginUser').value.trim();
const p=document.getElementById('loginPass').value;
if(!u||!p){toast('Error','Enter username and password');return}
const d=await api('/login',{method:'POST',body:{username:u,password:p}});
if(!d.token){toast('Error',d.error||'Login failed');return}
token=d.token;localStorage.setItem('pug_token',token);me=d;showPanel()}

async function checkLogin(){
if(!token)return showLogin();
const d=await api('/me');
if(!d.username){localStorage.removeItem('pug_token');token=null;showLogin();return}
me=d;showPanel()}

function showLogin(){document.getElementById('loginScreen').style.display='flex';document.getElementById('mainPanel').style.display='none'}
function showPanel(){
document.getElementById('loginScreen').style.display='none';
document.getElementById('mainPanel').style.display='block';
document.getElementById('userName').textContent=me.username;
document.getElementById('userRole').textContent=me.role.toUpperCase();
if(me.daysRemaining!==null){document.getElementById('userDays').textContent=me.daysRemaining+' days'}
document.getElementById('settingsBtn').style.display=me.role==='admin'?'flex':'none';
loadConfigs()}

function logout(){localStorage.removeItem('pug_token');token=null;showLogin()}

async function loadConfigs(){
const d=await api('/configs');
configs=Array.isArray(d)?d:[];
renderConfigs()}

function renderConfigs(){
const el=document.getElementById('dashboard');
if(!configs.length){el.innerHTML='<div class="empty"><i class="fas fa-shield-alt"></i><p>No configs yet</p></div>';return}
el.innerHTML=configs.map(c=>{
const daysR=Math.max(0,Math.ceil((new Date(c.expireDate)-new Date())/864e5));
return '<div class="card" style="position:relative"><div class="card-header"><h3 class="card-title">'+c.name+'</h3><div style="position:relative"><button class="menu-btn" onclick="toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="menu"><a class="menu-item" onclick="showDetails(\\''+c.id+'\\')"><i class="fas fa-eye"></i> View</a><a class="menu-item" onclick="downloadConfig2(\\''+c.id+'\\')"><i class="fas fa-download"></i> Download</a><a class="menu-item" onclick="toggleConfig(\\''+c.id+'\\')"><i class="fas fa-power-off"></i> '+(c.isActive?'Disable':'Enable')+'</a><a class="menu-item" onclick="deleteConfig(\\''+c.id+'\\')" style="color:var(--no)"><i class="fas fa-trash"></i> Delete</a></div></div></div><div class="info-grid"><div class="info-item"><div class="info-label">SERVER</div><div class="info-value">'+c.country+'</div></div><div class="info-item"><div class="info-label">DAYS LEFT</div><div class="info-value">'+daysR+'</div></div><div class="info-item"><div class="info-label">VOLUME</div><div class="info-value">'+(c.volume===-1?'∞':c.volume)+' GB</div></div><div class="info-item"><div class="info-label">USED</div><div class="info-value">'+c.volumeUsed.toFixed(1)+' GB</div></div></div></div>'}).join('')}

function toggleMenu(btn){btn.nextElementSibling.classList.toggle('show')}
document.addEventListener('click',e=>{if(!e.target.closest('.menu-btn'))document.querySelectorAll('.menu').forEach(m=>m.classList.remove('show'))});

async function createConfig(){
const name=document.getElementById('cfgName').value.trim();
if(!name){toast('Error','Enter name');return}
const body={name,country:document.getElementById('cfgServer').value,volume:document.getElementById('cfgVolume').value,days:document.getElementById('cfgDays').value,dailyLimit:'10'};
const d=await api('/configs',{method:'POST',body});
if(!d.ok){toast('Error',d.error);return}
closeModal('createModal');document.getElementById('cfgName').value='';toast('Created','Config created');loadConfigs()}

function getCfg(id){return configs.find(c=>c.id===id)}

function showDetails(id){
curCfg=getCfg(id);if(!curCfg)return;
const daysR=Math.max(0,Math.ceil((new Date(curCfg.expireDate)-new Date())/864e5));
document.getElementById('detailsBody').innerHTML='<div class="info-grid"><div class="info-item"><div class="info-label">NAME</div><div class="info-value">'+curCfg.name+'</div></div><div class="info-item"><div class="info-label">SERVER</div><div class="info-value">'+curCfg.country+'</div></div><div class="info-item"><div class="info-label">CREATED</div><div class="info-value">'+new Date(curCfg.createdDate).toLocaleDateString()+'</div></div><div class="info-item"><div class="info-label">EXPIRE</div><div class="info-value">'+new Date(curCfg.expireDate).toLocaleDateString()+'</div></div><div class="info-item"><div class="info-label">DAYS LEFT</div><div class="info-value">'+daysR+'</div></div><div class="info-item"><div class="info-label">VOLUME</div><div class="info-value">'+(curCfg.volume===-1?'Unlimited':curCfg.volume+' GB')+'</div></div><div class="info-item"><div class="info-label">USED</div><div class="info-value">'+curCfg.volumeUsed.toFixed(1)+' GB</div></div><div class="info-item"><div class="info-label">STATUS</div><div class="info-value" style="color:'+(curCfg.isActive?'var(--ok)':'var(--no)')+'">'+(curCfg.isActive?'ACTIVE':'INACTIVE')+'</div></div></div>';
openModal('detailsModal')}

function downloadConfig(){
if(!curCfg)return;
const cfg=templates[curCfg.country]||templates.UAE;
const blob=new Blob([cfg],{type:'text/plain'});
const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=curCfg.name+'.conf';a.click();URL.revokeObjectURL(a.href);
closeModal('detailsModal');toast('Downloaded','Config downloaded')}

async function downloadConfig2(id){
curCfg=getCfg(id);if(curCfg)downloadConfig()}

async function toggleConfig(id){
const c=getCfg(id);if(!c)return;
await api('/configs/'+id,{method:'PUT',body:{isActive:!c.isActive}});
loadConfigs();toast('Updated','Config updated')}

async function deleteConfig(id){
if(!confirm('Delete this config?'))return;
await api('/configs/'+id,{method:'DELETE'});
loadConfigs();toast('Deleted','Config deleted')}

async function loadUsers(){
const d=await api('/users');
const list=document.getElementById('usersList');
if(!Array.isArray(d)||!d.length){list.innerHTML='<p style="color:var(--gr);text-align:center">No users</p>';return}
list.innerHTML=d.map(u=>'<div class="user-item"><div><div class="user-info"><h4>'+u.username+(u.role==='admin'?'<span class="badge">ADMIN</span>':'')+'</h4><div class="user-meta"><span><i class="fas fa-calendar"></i> '+(u.daysRemaining!==null?u.daysRemaining+' days':'∞')+'</span><span><i class="fas fa-'+(u.isActive?'check':'times')+'"></i> '+(u.isActive?'Active':'Disabled')+'</span></div></div></div><div style="display:flex;gap:5px">'+(u.role!=='admin'?'<button class="btn btn-sm" onclick="editUser(\\''+u.username+'\\')"><i class="fas fa-edit"></i></button><button class="btn btn-sm btn-danger" onclick="deleteUser(\\''+u.username+'\\')"><i class="fas fa-trash"></i></button>':'')+'</div></div>').join('')}

async function createUser(){
const u=document.getElementById('newUser').value.trim();
const p=document.getElementById('newPass').value;
const d=parseInt(document.getElementById('newDays').value);
if(!u||!p){toast('Error','Fill all fields');return}
const res=await api('/users',{method:'POST',body:{username:u,password:p,days:d}});
if(!res.ok){toast('Error',res.error);return}
document.getElementById('newUser').value='';document.getElementById('newPass').value='';toast('Created','User created');loadUsers()}

function editUser(u){
curUser=u;document.getElementById('editUserName').textContent=u;openModal('editUserModal')}

async function saveUserEdit(){
const ext=parseInt(document.getElementById('extendDays').value);
const pass=document.getElementById('editPass').value;
const body={};if(ext>0)body.extendDays=ext;if(pass)body.newPassword=pass;
await api('/users/'+curUser,{method:'PUT',body});
closeModal('editUserModal');toast('Updated','User updated');loadUsers()}

async function deleteUser(u){
if(!confirm('Delete '+u+'?'))return;
await api('/users/'+u,{method:'DELETE'});
toast('Deleted','User deleted');loadUsers()}

document.getElementById('loginBtn').addEventListener('click',doLogin);
document.getElementById('loginPass').addEventListener('keypress',e=>{if(e.key==='Enter')doLogin()});
document.getElementById('loginUser').addEventListener('keypress',e=>{if(e.key==='Enter')doLogin()});

// Show/hide settings button when tab changed
document.querySelectorAll('[data-tab]').forEach(btn=>{btn.addEventListener('click',e=>{
if(btn.dataset.tab==='users'&&!document.getElementById('usersList').innerHTML)loadUsers()})});

checkLogin();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), HTML_CONTENT);
console.log('✅ HTML File Created');

// ===================== Express Setup =====================
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
    console.log('✅ Default Admin Created: arian / arian@11USER');
}

const genToken = () => crypto.randomBytes(32).toString('hex');
const daysLeft = (exp) => exp ? Math.max(0, Math.ceil((new Date(exp) - new Date()) / 864e5)) : null;

// ===================== Middleware =====================
function auth(req, res, next) {
    const token = req.headers['x-auth-token'];
    const sess = db.sessions[token];
    if (!sess) return res.status(401).json({ error: 'Unauthorized' });
    const user = db.users.find(u => u.username === sess.username);
    if (!user || !user.isActive) return res.status(403).json({ error: 'Invalid' });
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

// ===================== API: Auth =====================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid' });
    if (!user.isActive) return res.status(403).json({ error: 'Disabled' });
    if (user.expiresAt && new Date(user.expiresAt) < new Date())
        return res.status(403).json({ error: 'Expired' });

    const token = genToken();
    db.sessions[token] = { username, at: new Date().toISOString() };
    saveData();
    res.json({ token, username: user.username, role: user.role, expiresAt: user.expiresAt, daysRemaining: daysLeft(user.expiresAt) });
});

app.get('/api/me', auth, (req, res) => {
    res.json({ username: req.user.username, role: req.user.role, expiresAt: req.user.expiresAt, isActive: req.user.isActive, daysRemaining: daysLeft(req.user.expiresAt) });
});

app.post('/api/logout', auth, (req, res) => {
    delete db.sessions[req.token];
    saveData();
    res.json({ ok: true });
});

// ===================== API: Users (Admin) =====================
app.get('/api/users', auth, adminOnly, (req, res) => {
    res.json(db.users.map(u => ({
        username: u.username, role: u.role, createdAt: u.createdAt,
        expiresAt: u.expiresAt, isActive: u.isActive, daysRemaining: daysLeft(u.expiresAt)
    })));
});

app.post('/api/users', auth, adminOnly, (req, res) => {
    const { username, password, days } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Required' });
    if (db.users.find(u => u.username === username)) return res.status(400).json({ error: 'Exists' });

    const expiresAt = days ? new Date(Date.now() + days * 864e5).toISOString() : null;
    db.users.push({ username, password, role: 'user', createdAt: new Date().toISOString(), expiresAt, isActive: true });
    saveData();
    res.json({ ok: true });
});

app.put('/api/users/:username', auth, adminOnly, (req, res) => {
    const user = db.users.find(u => u.username === req.params.username);
    if (!user || user.role === 'admin') return res.status(403).json({ error: 'Invalid' });

    const { isActive, extendDays, newPassword } = req.body;
    if (typeof isActive === 'boolean') user.isActive = isActive;
    if (extendDays > 0) {
        const base = user.expiresAt && new Date(user.expiresAt) > new Date() ? new Date(user.expiresAt) : new Date();
        user.expiresAt = new Date(base.getTime() + extendDays * 864e5).toISOString();
    }
    if (newPassword) user.password = newPassword;
    saveData();
    res.json({ ok: true });
});

app.delete('/api/users/:username', auth, adminOnly, (req, res) => {
    const user = db.users.find(u => u.username === req.params.username);
    if (!user || user.role === 'admin') return res.status(403).json({ error: 'Invalid' });
    db.users = db.users.filter(u => u.username !== req.params.username);
    delete db.configs[req.params.username];
    saveData();
    res.json({ ok: true });
});

// ===================== API: Configs =====================
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
    const list = db.configs[req.user.username];
    const cfg = list?.find(c => c.id === req.params.id);
    if (!cfg) return res.status(404).json({ error: 'Not found' });
    Object.assign(cfg, req.body);
    saveData();
    res.json({ ok: true });
});

app.delete('/api/configs/:id', auth, (req, res) => {
    const list = db.configs[req.user.username];
    if (!list) return res.status(404).json({ error: 'Not found' });
    db.configs[req.user.username] = list.filter(c => c.id !== req.params.id);
    saveData();
    res.json({ ok: true });
});

// ===================== Fallback =====================
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ===================== Start Server =====================
app.listen(PORT, () => {
    console.log(`✅ PUG62 Panel running on port ${PORT}`);
    console.log(`🌐 Access: http://localhost:${PORT}`);
});

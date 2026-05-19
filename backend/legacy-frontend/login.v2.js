const API=window.location.origin;

// Show logout message if redirected from timeout
const logoutMsg = sessionStorage.getItem('logoutMsg');
if (logoutMsg) {
  sessionStorage.removeItem('logoutMsg');
  setTimeout(() => showError(logoutMsg), 300);
}

if(localStorage.getItem('token'))window.location.href='/dashboard';

// Password eye toggle
function togglePwd(){
  const inp=document.getElementById('password');
  const open=document.getElementById('eyeOpen');
  const closed=document.getElementById('eyeClosed');
  if(inp.type==='password'){inp.type='text';open.style.display='block';closed.style.display='none';}
  else{inp.type='password';open.style.display='none';closed.style.display='block';}
}

function showError(msg){
const el=document.getElementById('errorMsg');
document.getElementById('errorText').textContent=msg;
el.classList.add('show');
setTimeout(()=>el.classList.remove('show'),5000);
}

let pendingCreds=null;

function cancelForce(){
  document.getElementById('confirmOverlay').classList.remove('show');
  pendingCreds=null;
  const btn=document.getElementById('loginBtn');
  btn.disabled=false;btn.innerHTML='Sign In';
}

async function forceLogin(){
  if(!pendingCreds)return;
  document.getElementById('confirmOverlay').classList.remove('show');
  await doLogin(pendingCreds.u,pendingCreds.p,true);
  pendingCreds=null;
}

async function doLogin(u,p,force=false){
  const btn=document.getElementById('loginBtn');
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span>Signing in...';
  try{
    const r=await fetch(API+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,force:force})});
    const d=await r.json();
    if(!r.ok){
      // Check for session conflict (409)
      if(r.status===409){
        pendingCreds={u,p};
        document.getElementById('confirmOverlay').classList.add('show');
        btn.disabled=false;btn.innerHTML='Sign In';
        return;
      }
      throw new Error(d.detail||d.error||d.message||'Login failed');
    }
    localStorage.setItem('token',d.access_token||d.data?.token||d.token);
    localStorage.setItem('user',JSON.stringify(d.user||d.data?.user||{name:u}));
    window.location.href='/dashboard';
  }catch(err){showError(err.message)}finally{btn.disabled=false;btn.innerHTML='Sign In'}
}

async function handleLogin(e){
e.preventDefault();
const u=document.getElementById('username').value.trim();
const p=document.getElementById('password').value;
if(!u||!p)return showError('Please enter both username and password');
await doLogin(u,p,false);
}

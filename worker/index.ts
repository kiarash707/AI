export interface Env {
  DB: D1Database;
  OWNER_SETUP_TOKEN?: string;
  OWNER_AUTH_ENCRYPTION_KEY?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  AI_CREDENTIALS_ENCRYPTION_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_USER_SERVICE_URL?: string;
  TELEGRAM_USER_SERVICE_SECRET?: string;
  ALLOWED_ORIGIN?: string;
  DEV_MODE?: string;
}
type Model = {id:string;name:string;context_length:number;input_price:number;output_price:number;modalities:string[];tools:boolean;recommended_for:string[]};
const encoder=new TextEncoder(), decoder=new TextDecoder();
const responseHeaders=(origin:string)=>({'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization,x-telegram-bot-api-secret-token','vary':'Origin','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin','cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'",'strict-transport-security':'max-age=31536000; includeSubDomains','cache-control':'no-store'});
const json=(data:unknown,status=200,origin='*')=>new Response(JSON.stringify(data),{status,headers:responseHeaders(origin)});
const fail=(message:string,status=400,origin='*')=>json({error:message},status,origin);
const uuid=()=>crypto.randomUUID(); const now=()=>new Date().toISOString();
const safeError=(e:unknown)=>{const s=String(e instanceof Error?e.message:e);return s.replace(/(?:sk-or-v1-|sk-)[A-Za-z0-9_-]{12,}/g,'[redacted]').slice(0,350)};
let schemaReady=false;
async function ensure(db:D1Database){if(schemaReady)return;await db.batch([
 db.prepare('CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0)'),
 db.prepare("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL)"),
 db.prepare('CREATE INDEX IF NOT EXISTS messages_conv_created ON messages(conversation_id,created_at)'),
 db.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)'),
 db.prepare('CREATE TABLE IF NOT EXISTS telegram_links (telegram_user_id TEXT PRIMARY KEY, active_conversation_id TEXT, updated_at TEXT NOT NULL)'),
 db.prepare('CREATE TABLE IF NOT EXISTS telegram_updates (update_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL)'),
 db.prepare('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, conversation_id TEXT, owner_id TEXT NOT NULL, status TEXT NOT NULL, input TEXT NOT NULL, output TEXT, step TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
 db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)'),
 db.prepare('CREATE TABLE IF NOT EXISTS model_events (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, requested_model TEXT, used_model TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL)'),
 db.prepare('CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL)'),
 db.prepare('CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions(expires_at)'),
 db.prepare('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'active\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
 db.prepare('CREATE INDEX IF NOT EXISTS projects_owner_updated ON projects(owner_id,updated_at)'),
 db.prepare('CREATE TABLE IF NOT EXISTS workspace_tasks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'todo\', priority TEXT NOT NULL DEFAULT \'normal\', due_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
 db.prepare('CREATE INDEX IF NOT EXISTS workspace_tasks_owner_updated ON workspace_tasks(owner_id,updated_at)'),
 db.prepare('CREATE INDEX IF NOT EXISTS workspace_tasks_project ON workspace_tasks(project_id)'),
 db.prepare('CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
 db.prepare('CREATE INDEX IF NOT EXISTS memories_owner_updated ON memories(owner_id,updated_at)'),
 db.prepare('CREATE TABLE IF NOT EXISTS activity_log (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL)'),
 db.prepare('CREATE INDEX IF NOT EXISTS activity_log_owner_created ON activity_log(owner_id,created_at)')]);schemaReady=true;}
async function rateLimited(db:D1Database,key:string,limit=6){const t=Math.floor(Date.now()/60000),row:any=await db.prepare('SELECT window_start,count FROM rate_limits WHERE key=?').bind(key).first();if(row&&row.window_start===t&&row.count>=limit)return true;await db.prepare('INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN rate_limits.window_start=excluded.window_start THEN rate_limits.count+1 ELSE 1 END').bind(key,t).run();return false;}
async function setting(db:D1Database,key:string){const r:any=await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();return typeof r?.value==='string'?r.value:null;}
function fromB64(s:string):Uint8Array<ArrayBuffer>{const clean=s.replace(/-/g,'+').replace(/_/g,'/');const binary=atob(clean.padEnd(Math.ceil(clean.length/4)*4,'='));const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
function toB64(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function encryptionKey(env:Env){if(!env.AI_CREDENTIALS_ENCRYPTION_KEY)throw new Error('سرور هنوز Secret با نام AI_CREDENTIALS_ENCRYPTION_KEY را تنظیم نکرده است.');let raw:Uint8Array<ArrayBuffer>;try{raw=fromB64(env.AI_CREDENTIALS_ENCRYPTION_KEY)}catch{throw new Error('کلید رمزنگاری سمت سرور معتبر نیست؛ مقدار Base64 با ۳۲ بایت تصادفی لازم است.')}if(raw.byteLength!==32)throw new Error('Secret رمزنگاری باید Base64 از ۳۲ بایت تصادفی باشد.');return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function encryptSecret(env:Env,value:string){const key=await encryptionKey(env),iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('kayro-ai/openrouter/v1')},key,encoder.encode(value)));return `v1.${toB64(iv)}.${toB64(cipher)}`;}
async function decryptSecret(env:Env,stored:string){const parts=stored.split('.');if(parts.length!==3||parts[0]!=='v1')throw new Error('اعتبارنامهٔ ذخیره‌شده قابل‌خواندن نیست.');const key=await encryptionKey(env);try{return decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(parts[1]),additionalData:encoder.encode('kayro-ai/openrouter/v1')},key,fromB64(parts[2])))}catch{throw new Error('بازکردن امن اعتبارنامه ممکن نشد؛ Secret رمزنگاری را بررسی کنید.');}}
async function ownerAuthEncryptionKey(env:Env){
 if(!env.OWNER_AUTH_ENCRYPTION_KEY)throw new Error('Secret با نام OWNER_AUTH_ENCRYPTION_KEY تنظیم نشده است.');
 const raw=fromB64(env.OWNER_AUTH_ENCRYPTION_KEY);
 if(raw.byteLength!==32)throw new Error('OWNER_AUTH_ENCRYPTION_KEY باید Base64 از ۳۲ بایت تصادفی باشد.');
 return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function encryptOwnerSecret(env:Env,value:string){
 const key=await ownerAuthEncryptionKey(env),iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('kayro-ai/owner-totp/v1')},key,encoder.encode(value)));
 return 'v1.'+toB64(iv)+'.'+toB64(cipher);
}
async function decryptOwnerSecret(env:Env,stored:string){
 const p=stored.split('.');if(p.length!==3||p[0]!=='v1')throw new Error('ذخیرهٔ امن رمز احراز هویت نامعتبر است.');
 const key=await ownerAuthEncryptionKey(env);
 return decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(p[1]),additionalData:encoder.encode('kayro-ai/owner-totp/v1')},key,fromB64(p[2])));
}
const BASE32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes:Uint8Array){
 let bits=0,value=0,out='';
 for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){out+=BASE32[(value>>>(bits-5))&31];bits-=5}}
 if(bits)out+=BASE32[(value<<(5-bits))&31];
 return out;
}
function base32Decode(input:string){
 const s=input.toUpperCase().replace(/=+$/,'').replace(/\s/g,'');let bits=0,value=0,out:number[]=[];
 for(const c of s){const n=BASE32.indexOf(c);if(n<0)throw new Error('کلید TOTP نامعتبر است.');value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8}}
 return new Uint8Array(out);
}
export async function totpCode(secret:string,counter:number){
 const key=await crypto.subtle.importKey('raw',base32Decode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const msg=new Uint8Array(8);let n=counter;for(let i=7;i>=0;i--){msg[i]=n%256;n=Math.floor(n/256)}
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,msg)),offset=mac[mac.length-1]&15;
 const binary=(mac[offset]&127)*16777216+(mac[offset+1]&255)*65536+(mac[offset+2]&255)*256+(mac[offset+3]&255);
 return String(binary%1000000).padStart(6,'0');
}
async function matchTotpCounter(secret:string,code:string){
 if(!/^\d{6}$/.test(code))return null;
 const current=Math.floor(Date.now()/30000);
 for(const delta of [-1,0,1]){const counter=current+delta;if(counter>=0&&await totpCode(secret,counter)===code)return counter}
 return null;
}
function cookieValue(req:Request,name:string){
 const prefix=name+'=';return(req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(prefix))?.slice(prefix.length)||'';
}
async function validOwnerSession(req:Request,env:Env){
 if(!await setting(env.DB,'owner_totp_secret'))return false;
 const token=cookieValue(req,'kayro_auth');if(!/^[a-f0-9]{64}$/.test(token))return false;
 const hash=toB64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))));
 const row:any=await env.DB.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').bind(hash).first();
 if(!row||Number(row.expires_at)<=Math.floor(Date.now()/1000)){if(row)await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(hash).run();return false}
 return true;
}
async function issueOwnerSession(env:Env,origin:string){
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const hash=toB64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))));
 const expires=Math.floor(Date.now()/1000)+43200;
 await env.DB.prepare('INSERT INTO auth_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)').bind(hash,expires,now()).run();
 await recordActivity(env.DB,'امنیت','ورود','ورود موفق با Authenticator');
 const res=json({ok:true,expires_at:expires},200,origin);
 headers.append('Set-Cookie',`kayro_auth=${token}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`);
 return new Response(res.body,{status:res.status,headers});
}
function clearOwnerCookie(res:Response){
 const headers=new Headers(res.headers);headers.append('Set-Cookie','kayro_auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
 return new Response(res.body,{status:res.status,headers});
}
async function authRoute(req:Request,env:Env,origin:string,url:URL):Promise<Response|null>{
 if(!url.pathname.startsWith('/api/auth/'))return null;
 await ensure(env.DB);
 if(url.pathname==='/api/auth/status'&&req.method==='GET'){
  const configured=Boolean(await setting(env.DB,'owner_totp_secret'));
  let authenticated=false;try{authenticated=configured&&await validOwnerSession(req,env)}catch{}
  return json({setupRequired:!configured,setupAvailable:Boolean(env.OWNER_SETUP_TOKEN&&env.OWNER_SETUP_TOKEN.length>=32&&env.OWNER_AUTH_ENCRYPTION_KEY),authenticated},200,origin);
 }
 if(url.pathname==='/api/auth/setup'&&req.method==='POST'){
  if(await setting(env.DB,'owner_totp_secret'))return fail('راه‌اندازی قبلاً انجام شده است؛ از کد Authenticator استفاده کنید.',409,origin);
  if(!env.OWNER_SETUP_TOKEN||env.OWNER_SETUP_TOKEN.length<32)return fail('برای راه‌اندازی اولیه، Secret با نام OWNER_SETUP_TOKEN و حداقل ۳۲ نویسه در Cloudflare تنظیم کنید.',503,origin);if(!env.OWNER_AUTH_ENCRYPTION_KEY)return fail('Secret با نام OWNER_AUTH_ENCRYPTION_KEY را در Cloudflare تنظیم کنید.',503,origin);
  if(await rateLimited(env.DB,'owner-auth-setup',5))return fail('تلاش‌های راه‌اندازی زیاد است؛ یک دقیقه بعد دوباره تلاش کنید.',429,origin);
  let body:any;try{body=await req.json()}catch{return fail('درخواست JSON معتبر نیست.',400,origin)}
  if(typeof body.setup_token!=='string'||body.setup_token.length>512||body.setup_token!==env.OWNER_SETUP_TOKEN)return fail('کد راه‌اندازی اشتباه است.',401,origin);
  const secret=base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  const pending=JSON.stringify({encrypted:await encryptOwnerSecret(env,secret),expires_at:Date.now()+600000});
  await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('owner_totp_pending',pending,now()).run();
  const label=encodeURIComponent('KAYRO AI:Owner'),issuer=encodeURIComponent('KAYRO AI');
  const otpauth_uri=`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return json({ok:true,secret,otpauth_uri,expires_in:600},200,origin);
 }
 if(url.pathname==='/api/auth/verify-setup'&&req.method==='POST'){
  if(await setting(env.DB,'owner_totp_secret'))return fail('راه‌اندازی قبلاً انجام شده است.',409,origin);
  let body:any;try{body=await req.json()}catch{return fail('درخواست JSON معتبر نیست.',400,origin)}
  const raw=await setting(env.DB,'owner_totp_pending');if(!raw)return fail('ابتدا راه‌اندازی را شروع کنید.',409,origin);
  let pending:any;try{pending=JSON.parse(raw)}catch{return fail('اطلاعات راه‌اندازی نامعتبر است.',500,origin)}
  if(Number(pending.expires_at)<Date.now()){await env.DB.prepare("DELETE FROM settings WHERE key='owner_totp_pending'").run();return fail('زمان راه‌اندازی تمام شده؛ دوباره شروع کنید.',410,origin)}
  if(await rateLimited(env.DB,'owner-auth-setup-verify',6))return fail('کدهای اشتباه زیادی وارد شده‌اند؛ کمی صبر کنید.',429,origin);
  const secret=await decryptOwnerSecret(env,pending.encrypted),counter=await matchTotpCounter(secret,String(body.code||''));
  if(counter===null)return fail('کد Authenticator نادرست است یا منقضی شده است.',401,origin);
  await env.DB.batch([
   env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('owner_totp_secret',pending.encrypted,now()),
   env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('owner_totp_last_counter',String(counter),now()),
   env.DB.prepare("DELETE FROM settings WHERE key='owner_totp_pending'"),
   env.DB.prepare('DELETE FROM rate_limits WHERE key IN (?,?)').bind('owner-auth-setup','owner-auth-setup-verify')
  ]);
  return issueOwnerSession(env,origin);
 }
 if(url.pathname==='/api/auth/login'&&req.method==='POST'){
  if(!await setting(env.DB,'owner_totp_secret'))return fail('راه‌اندازی اولیه هنوز انجام نشده است.',409,origin);
  const ip=req.headers.get('CF-Connecting-IP')||'unknown';
  if(await rateLimited(env.DB,'owner-auth-login:'+ip,6))return fail('تلاش‌های ورود زیاد است؛ یک دقیقه بعد دوباره تلاش کنید.',429,origin);
  let body:any;try{body=await req.json()}catch{return fail('درخواست JSON معتبر نیست.',400,origin)}
  const stored=await setting(env.DB,'owner_totp_secret');if(!stored)return fail('Authenticator تنظیم نشده است.',409,origin);
  let secret:string;try{secret=await decryptOwnerSecret(env,stored)}catch{return fail('کلید رمزگذاری احراز هویت سرور تنظیم یا معتبر نیست.',503,origin)}
  const counter=await matchTotpCounter(secret,String(body.code||''));if(counter===null)return fail('کد Authenticator نادرست یا منقضی شده است.',401,origin);
  const freshCounter=await env.DB.prepare("UPDATE settings SET value=?,updated_at=? WHERE key='owner_totp_last_counter' AND CAST(value AS INTEGER) < ?").bind(String(counter),now(),counter).run();
  if(Number(freshCounter.meta?.changes||0)!==1)return fail('این کد قبلاً استفاده شده است؛ کد تازه‌ای از Authenticator وارد کنید.',401,origin);
  return issueOwnerSession(env,origin);
 }
 if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
  const token=cookieValue(req,'kayro_auth');
  if(/^[a-f0-9]{64}$/.test(token)){const hash=toB64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))));await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(hash).run()}
  return clearOwnerCookie(json({ok:true},200,origin));
 }
 return fail('مسیر احراز هویت ناشناخته است.',404,origin);
}

async function openRouterKey(db:D1Database,env:Env){const encrypted=await setting(db,'ai_openrouter_encrypted');return encrypted?decryptSecret(env,encrypted):null;}
export function zeroPrice(x:unknown){if(typeof x!=='string'&&typeof x!=='number')return false;if(x===''||x===null)return false;const n=Number(x);return Number.isFinite(n)&&n===0;}export function isZeroCostPricing(pricing:{prompt?:unknown;completion?:unknown}|null|undefined){return zeroPrice(pricing?.prompt)&&zeroPrice(pricing?.completion)}
async function getFreeModels(key:string):Promise<Model[]>{const r=await fetch('https://openrouter.ai/api/v1/models',{headers:{Authorization:`Bearer ${key}`,'HTTP-Referer':'https://kayro.ai','X-Title':'KAYRO AI'},signal:AbortSignal.timeout(15000)});if(!r.ok){if(r.status===401||r.status===403)throw new Error('کلید OpenRouter رد شد؛ کلید را بررسی یا جایگزین کنید.');if(r.status===429)throw new Error('محدودیت نرخ OpenRouter هنگام دریافت مدل‌ها؛ چند دقیقه بعد دوباره تلاش کنید.');throw new Error(`دریافت مدل‌ها ناموفق بود (HTTP ${r.status}).`)}const data:any=await r.json();return(data.data||[]).filter((m:any)=>isZeroCostPricing(m?.pricing)).map((m:any)=>({id:String(m.id),name:String(m.name||m.id),context_length:Number(m.context_length||0),input_price:0,output_price:0,modalities:Array.isArray(m.architecture?.input_modalities)?m.architecture.input_modalities.filter((v:any)=>['text','image'].includes(v)):['text'],tools:Boolean(m.supported_parameters?.includes('tools')||m.supported_parameters?.includes('tool_choice')),recommended_for:['conversation',...(String(m.id).match(/code|coder/i)?['coding']:[]),...(m.supported_parameters?.includes('tools')?['reasoning']:[])]}));}
export function classifyTask(text:string){if(/(?:```|\b(?:code|coding|program|debug|typescript|javascript|python|sql)\b|کد|برنامه.?نویسی|خطایابی)/i.test(text))return'coding';if(/(?:\b(?:analy[sz]e|reason|compare|plan|architecture|strategy)\b|استدلال|مقایسه|تحلیل|برنامه.?ریزی)/i.test(text))return'reasoning';return'conversation'}
export function taskSuitable(models:Model[],task:string){const filtered=task==='image'?models.filter(m=>m.modalities.includes('image')):models.filter(m=>m.modalities.includes('text'));if(task==='coding')return filtered.sort((a,b)=>Number(b.recommended_for.includes('coding'))-Number(a.recommended_for.includes('coding'))||b.context_length-a.context_length);if(task==='reasoning')return filtered.sort((a,b)=>Number(b.tools)-Number(a.tools)||b.context_length-a.context_length);return filtered.sort((a,b)=>b.context_length-a.context_length);}
function friendlyProviderError(status:number,_body:any){if(status===401||status===403)return'OpenRouter کلید را نپذیرفت. کلید API را بررسی کنید.';if(status===429)return'محدودیت نرخ مدل رایگان پر شده است. سیستم فقط مدل رایگان دیگری را امتحان می‌کند؛ در صورت نبود ظرفیت، بعداً ادامه دهید.';if(status===408||status===504)return'پاسخ مدل دیر رسید؛ یک مدل رایگان دیگر به‌صورت محدود امتحان می‌شود.';if(status>=500)return'سرویس مدل موقتاً خطا داد؛ تلاش محدود برای مدل رایگان جایگزین انجام می‌شود.';return`درخواست مدل پذیرفته نشد (HTTP ${status}). جزئیات فنی و اعتبارنامه در پاسخ مرورگر نمایش داده نمی‌شوند.`}
async function answer(db:D1Database,env:Env,conversationId:string,userText:string,source:'web'|'telegram',requestedModel?:string){const secret=await openRouterKey(db,env);if(!secret)throw Object.assign(Error('کلید هوش مصنوعی تنظیم نشده است. از تنظیمات ← هوش مصنوعی و API کلید را اضافه و اتصال را آزمایش کنید.'),{status:503});const all=await getFreeModels(secret);if(!all.length)throw Object.assign(Error('مدل رایگان با هزینهٔ صفرِ تأییدشده پیدا نشد؛ پیام ذخیره شد و گفتگو برای ادامه حفظ شده است.'),{status:503});const selected=taskSuitable(all,classifyTask(userText)),preferred=requestedModel&&selected.find(m=>m.id===requestedModel);if(preferred)selected.splice(selected.indexOf(preferred),1),selected.unshift(preferred);const initialModel=selected[0]?.id;const history:any=await db.prepare('SELECT role,content FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 21').bind(conversationId).all();const messages=[...(history.results||[])].reverse().map((m:any)=>({role:m.role,content:m.content}));let lastError='';for(const model of selected.slice(0,3)){let response:Response;try{response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json','HTTP-Referer':'https://kayro.ai','X-Title':'KAYRO AI'},body:JSON.stringify({model:model.id,messages,stream:false,max_tokens:1200}),signal:AbortSignal.timeout(30000)})}catch(e){lastError=e instanceof DOMException&&e.name==='TimeoutError'?'مهلت پاسخ مدل تمام شد.': 'ارتباط با سرویس مدل برقرار نشد.';continue}let data:any={};try{data=await response.json()}catch{}if(!response.ok){lastError=friendlyProviderError(response.status,data);if([400,401,402,403].includes(response.status))break;continue}const content=data.choices?.[0]?.message?.content;if(typeof content!=='string'||!content.trim()){lastError='مدل پاسخ متنی معتبری برنگرداند.';continue}const stamp=now();await db.prepare("INSERT INTO messages(id,conversation_id,role,content,source,created_at) VALUES(?,?,?,?,?,?)").bind(uuid(),conversationId,'assistant',content,source,stamp).run();await db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(stamp,conversationId).run();const switched=Boolean(initialModel&&model.id!==initialModel);if(switched)await db.prepare('INSERT INTO model_events(id,conversation_id,requested_model,used_model,reason,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),conversationId,requestedModel||initialModel,model.id,lastError||'مدل قبلی در دسترس نبود؛ مدل رایگان بعدی استفاده شد.',stamp).run();return{reply:content,model:model.id,switched,reason:switched?lastError||'به مدل رایگان جایگزین منتقل شد.':undefined}}throw Object.assign(Error(lastError||'هیچ مدل رایگان در دسترس نیست. گفتگو ذخیره شده و می‌توانید بعداً ادامه دهید.'),{status:503});}

export type AnonymousSession={id:string;fresh:boolean};
export function anonymousSession(req:Request):AnonymousSession{
 const raw=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('kayro_sid='));
 const candidate=raw?.slice('kayro_sid='.length)||'';
 if(/^[a-f0-9]{64}$/.test(candidate))return{id:candidate,fresh:false};
 return{id:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),fresh:true};
}
export function withAnonymousCookie(res:Response,session:AnonymousSession):Response{
 if(!session.fresh)return res;
 const headers=new Headers(res.headers);
 headers.append('Set-Cookie',`kayro_sid=${session.id}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
 headers.set('Cache-Control','no-store');
 return new Response(res.body,{status:res.status,statusText:res.statusText,headers});
}
async function handlePublicChat(req:Request,env:Env,session:AnonymousSession):Promise<Response>{
 const url=new URL(req.url),origin=req.headers.get('Origin')||url.origin,ownerId=`anon:${session.id}`;
 let response:Response;
 try{
  await ensure(env.DB);
  if(url.pathname==='/api/conversations'&&req.method==='GET'){
   const r=await env.DB.prepare('SELECT id,title,updated_at,archived FROM conversations WHERE owner_id=? AND archived=0 ORDER BY updated_at DESC LIMIT 100').bind(ownerId).all();
   response=json(r.results,200,origin);
  }else if(url.pathname==='/api/conversations'&&req.method==='POST'){
   const b:any=await req.json(),cid=uuid(),stamp=now(),title=String(b.title||'گفتگوی تازه').trim().slice(0,160)||'گفتگوی تازه';
   await env.DB.prepare('INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').bind(cid,ownerId,title,stamp,stamp).run();
   response=json({id:cid,title,updated_at:stamp},201,origin);
  }else{
   const match=url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
   if(!match){response=fail('درخواست ناشناخته است.',404,origin);}
   else{
    const cid=decodeURIComponent(match[1]);
    const conversation:any=await env.DB.prepare('SELECT id,title FROM conversations WHERE id=? AND owner_id=? AND archived=0').bind(cid,ownerId).first();
    if(!conversation){response=fail('گفتگو پیدا نشد یا متعلق به این مرورگر نیست.',404,origin);}
    else if(req.method==='GET'){
     const rows=await env.DB.prepare('SELECT id,role,content,created_at FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT 300').bind(cid).all();
     response=json(rows.results,200,origin);
    }else if(req.method==='POST'){
     const body:any=await req.json();
     if(typeof body.content!=='string'||!body.content.trim()||body.content.length>20000){response=fail('پیام باید بین ۱ تا ۲۰٬۰۰۰ نویسه باشد.',422,origin);}
     else if(await rateLimited(env.DB,`chat:${session.id}`,12)||await rateLimited(env.DB,'public-chat-global',60)){response=fail('تعداد پیام‌ها در این دقیقه زیاد است؛ کمی بعد دوباره تلاش کنید.',429,origin);}
     else{
      const stamp=now(),text=body.content.trim();
      await env.DB.prepare("INSERT INTO messages(id,conversation_id,role,content,source,created_at) VALUES(?,?,?,?,?,?)").bind(uuid(),cid,'user',text,'web',stamp).run();
      await env.DB.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND owner_id=?').bind(stamp,cid,ownerId).run();
      try{
       const pref=await setting(env.DB,'ai_model_mode')==='manual'?await setting(env.DB,'ai_default_model'):undefined;
       response=json(await answer(env.DB,env,cid,text,'web',pref||undefined),200,origin);
      }catch(e){response=fail(safeError(e),Number((e as any)?.status)||502,origin);}
     }
    }else response=fail('روش درخواست پشتیبانی نمی‌شود.',405,origin);
   }
  }
 }catch(e){response=fail(safeError(e),500,origin);}
 return withAnonymousCookie(response!,session);
}
async function handlePublicModels(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url),origin=req.headers.get('Origin')||url.origin;
 try{
  await ensure(env.DB);
  if(await rateLimited(env.DB,'public-model-list',40))return fail('درخواست‌های مدل زیاد شده‌اند؛ کمی بعد دوباره تلاش کنید.',429,origin);
  const key=await openRouterKey(env.DB,env);
  if(!key)return fail('اتصال هوش مصنوعی هنوز توسط مالک پیکربندی نشده است.',503,origin);
  const models=await getFreeModels(key);
  return json({models},200,origin);
 }catch(e){return fail(safeError(e),502,origin);}
}

async function tg(env:Env,method:string,body:unknown){if(!env.TELEGRAM_BOT_TOKEN)throw Error('اتصال ربات تلگرام پیکربندی نشده است.');const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const d:any=await r.json();if(!r.ok||!d.ok)throw Error('درخواست ربات تلگرام ناموفق بود.');return d.result;}
async function handleTelegram(req:Request,env:Env){if(!env.TELEGRAM_WEBHOOK_SECRET||req.headers.get('x-telegram-bot-api-secret-token')!==env.TELEGRAM_WEBHOOK_SECRET)return fail('Unauthorized',401);try{await ensure(env.DB);const update:any=await req.json(),result=await env.DB.prepare('INSERT OR IGNORE INTO telegram_updates(update_id,created_at) VALUES(?,?)').bind(update.update_id,now()).run();if(!result.meta.changes)return json({ok:true,duplicate:true});const callback=update.callback_query;if(callback?.from?.id){const uid=String(callback.from.id),owner=await setting(env.DB,'owner_telegram_user_id'),match=String(callback.data||'').match(/^open:([0-9a-f-]{36})$/i);if(!owner||uid!==owner||!match){await tg(env,'answerCallbackQuery',{callback_query_id:callback.id,text:'دسترسی یا گفتگو معتبر نیست.'});return json({ok:true})}const conversation:any=await env.DB.prepare("SELECT id,title FROM conversations WHERE id=? AND owner_id='owner' AND archived=0").bind(match[1]).first();if(!conversation){await tg(env,'answerCallbackQuery',{callback_query_id:callback.id,text:'گفتگو پیدا نشد.'});return json({ok:true})}await env.DB.prepare('INSERT OR REPLACE INTO telegram_links(telegram_user_id,active_conversation_id,updated_at) VALUES(?,?,?)').bind(uid,conversation.id,now()).run();await tg(env,'answerCallbackQuery',{callback_query_id:callback.id,text:'گفتگو باز شد.'});await tg(env,'sendMessage',{chat_id:callback.message?.chat?.id,text:`گفتگوی فعال: ${conversation.title}\nپیام‌تان را بفرستید تا از همین مکالمه ادامه دهیم.`});return json({ok:true})}const msg=update.message;if(!msg?.from?.id)return json({ok:true});const uid=String(msg.from.id),text=String(msg.text||''),owner=await setting(env.DB,'owner_telegram_user_id');if(!owner||uid!==owner){await tg(env,'sendMessage',{chat_id:msg.chat.id,text:'این ربات برای این حساب مجاز نشده است.'});return json({ok:true})}if(await rateLimited(env.DB,`telegram:${uid}`,8)){await tg(env,'sendMessage',{chat_id:msg.chat.id,text:'تعداد پیام‌ها در مدت کوتاه زیاد شده است؛ یک دقیقه بعد دوباره امتحان کنید.'});return json({ok:true,rate_limited:true})}const active:any=await env.DB.prepare('SELECT active_conversation_id FROM telegram_links WHERE telegram_user_id=?').bind(uid).first();if(text.startsWith('/start')){await tg(env,'sendMessage',{chat_id:msg.chat.id,text:'ربات KAYRO آماده است. /chats برای گفتگوهای قبلی و /new برای گفتگوی تازه.'})}else if(text.startsWith('/new')){const cid=uuid(),stamp=now();await env.DB.prepare('INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').bind(cid,'owner','گفتگوی تلگرام',stamp,stamp).run();await env.DB.prepare('INSERT OR REPLACE INTO telegram_links(telegram_user_id,active_conversation_id,updated_at) VALUES(?,?,?)').bind(uid,cid,stamp).run();await tg(env,'sendMessage',{chat_id:msg.chat.id,text:'گفتگوی تازه ساخته شد. پیام‌تان را ارسال کنید.'})}else if(text.startsWith('/chats')){const list:any=await env.DB.prepare('SELECT id,title,updated_at FROM conversations WHERE owner_id=? AND archived=0 ORDER BY updated_at DESC LIMIT 8').bind('owner').all();const buttons=(list.results||[]).map((c:any)=>[{text:String(c.title).slice(0,45),callback_data:`open:${c.id}`}]);await tg(env,'sendMessage',{chat_id:msg.chat.id,text:buttons.length?'گفتگوهای ذخیره‌شده:':'گفتگویی پیدا نشد.',reply_markup:{inline_keyboard:buttons}})}else if(active?.active_conversation_id&&text&&!text.startsWith('/')){const cid=active.active_conversation_id,conversation:any=await env.DB.prepare('SELECT id FROM conversations WHERE id=? AND owner_id=? AND archived=0').bind(cid,'owner').first();if(!conversation){await tg(env,'sendMessage',{chat_id:msg.chat.id,text:'گفتگوی فعال معتبر نیست؛ /chats را بزنید.'})}else{const stamp=now();await env.DB.prepare("INSERT INTO messages(id,conversation_id,role,content,source,created_at) VALUES(?,?,?,?,?,?)").bind(uuid(),cid,'user',text,'telegram',stamp).run();await env.DB.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(stamp,cid).run();try{const result=await answer(env.DB,env,cid,text,'telegram');await tg(env,'sendMessage',{chat_id:msg.chat.id,text:result.reply.slice(0,4000)})}catch(e){await tg(env,'sendMessage',{chat_id:msg.chat.id,text:safeError(e).slice(0,800)})}}}else await tg(env,'sendMessage',{chat_id:msg.chat.id,text:'برای شروع /new یا مشاهدهٔ گفتگوها /chats را بزنید.'});return json({ok:true})}catch(e){return fail(safeError(e),500)}}

async function handleTelegramAccount(req:Request,env:Env,origin:string):Promise<Response>{
 const base=env.TELEGRAM_USER_SERVICE_URL?.trim().replace(/\/+$/,'');
 const secret=env.TELEGRAM_USER_SERVICE_SECRET||'';
 if(!base||secret.length<32)return fail('سرویس حساب شخصی تلگرام هنوز پیکربندی نشده است؛ نشانی سرویس و Secret امن آن را در Cloudflare تنظیم کنید.',503,origin);
 let serviceUrl:URL;
 try{serviceUrl=new URL(base)}catch{return fail('نشانی سرویس تلگرام معتبر نیست.',503,origin)}
 if(serviceUrl.protocol!=='https:'&&env.DEV_MODE!=='true')return fail('نشانی سرویس تلگرام باید HTTPS باشد.',503,origin);
 const url=new URL(req.url),prefix='/api/settings/telegram-user',suffix=url.pathname.slice(prefix.length);
 let targetPath='',allowed=false;
 if(req.method==='GET'&&suffix==='/status'){targetPath='/status';allowed=true}
 else if(req.method==='POST'&&['/auth/start','/auth/code','/auth/password','/send','/read','/logout'].includes(suffix)){targetPath=suffix;allowed=true}
 else if(req.method==='GET'&&suffix==='/dialogs'){targetPath='/dialogs';allowed=true}
 else if(req.method==='GET'&&suffix==='/search'){targetPath='/search';allowed=true}
 else if(req.method==='GET'){
  const match=suffix.match(/^\/dialogs\/([^/]+)\/messages$/);
  if(match){let peer='';try{peer=decodeURIComponent(match[1])}catch{return fail('شناسهٔ گفتگو معتبر نیست.',422,origin)}
   if(!/^[A-Za-z0-9_@-]{1,160}$/.test(peer))return fail('شناسهٔ گفتگو معتبر نیست.',422,origin);
   targetPath='/dialogs/'+encodeURIComponent(peer)+'/messages';allowed=true
  }
 }
 if(!allowed)return fail('مسیر حساب تلگرام ناشناخته یا غیرمجاز است.',404,origin);
 const target=new URL(targetPath,serviceUrl);
 for(const k of ['limit','q','max_dialogs']){const v=url.searchParams.get(k);if(v!==null)target.searchParams.set(k,v)}
 let body:string|undefined;
 if(req.method!=='GET'){
  try{body=JSON.stringify(await req.json())}catch{return fail('بدنهٔ درخواست JSON معتبر نیست.',400,origin)}
  if(body.length>10000)return fail('درخواست از حد مجاز بزرگ‌تر است.',413,origin);
 }
 try{
  const upstream=await fetch(target.toString(),{method:req.method,headers:{'authorization':"Bearer "+secret,'content-type':'application/json','accept':'application/json'},body,signal:AbortSignal.timeout(22000),redirect:'error'});
  const type=upstream.headers.get('content-type')||'';
  if(!type.includes('application/json'))return fail('سرویس تلگرام پاسخ قابل‌خواندن برنگرداند.',502,origin);
  let data:any;try{data=await upstream.json()}catch{return fail('پاسخ سرویس تلگرام نامعتبر بود.',502,origin)}
  if(!upstream.ok)return fail(typeof data.detail==='string'?data.detail:'درخواست تلگرام ناموفق بود.',upstream.status,origin);
  return json(data,upstream.status,origin);
 }catch(e){
  const message=e instanceof DOMException&&e.name==='TimeoutError'?'مهلت پاسخ سرویس تلگرام تمام شد.':'ارتباط امن با سرویس حساب تلگرام برقرار نشد.';
  return fail(message,504,origin)
 }
}


type WorkspaceProject={id:string;title:string;description:string;status:'active'|'planning'|'paused'|'done'};
type WorkspaceTask={id:string;title:string;description:string;status:'todo'|'in_progress'|'done';priority:'low'|'normal'|'high';project_id:string|null;due_date:string|null};
async function recordActivity(db:D1Database,category:string,action:string,summary:string){
 await db.prepare('INSERT INTO activity_log(id,owner_id,category,action,summary,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),'owner',category.slice(0,40),action.slice(0,60),summary.slice(0,240),now()).run();
 await db.prepare('DELETE FROM activity_log WHERE owner_id=? AND id NOT IN (SELECT id FROM activity_log WHERE owner_id=? ORDER BY created_at DESC LIMIT 200)').bind('owner','owner').run();
}
function boundedText(v:unknown,max:number,optional=false):string|null{
 if(typeof v!=='string')return optional?'':null;
 const s=v.trim();if(!optional&&!s)return null;if(s.length>max)return null;return s;
}
function statusProject(v:unknown):'active'|'planning'|'paused'|'done'|null{return v==='active'||v==='planning'||v==='paused'||v==='done'?v:null}
function statusTask(v:unknown):'todo'|'in_progress'|'done'|null{return v==='todo'||v==='in_progress'||v==='done'?v:null}
function priorityTask(v:unknown):'low'|'normal'|'high'|null{return v==='low'||v==='normal'||v==='high'?v:null}
async function parseJsonBody(req:Request):Promise<any>{try{return await req.json()}catch{return null}}
async function handleWorkspaceRoute(req:Request,env:Env,origin:string,url:URL):Promise<Response|null>{
 const path=url.pathname,db=env.DB,stamp=now();
 if(path==='/api/workspace/integrations'&&req.method==='GET'){
  return json({openrouter:{configured:Boolean(await setting(db,'ai_openrouter_encrypted')),tested:Boolean(await setting(db,'ai_last_tested_at'))},telegramBot:{tokenConfigured:Boolean(env.TELEGRAM_BOT_TOKEN),ownerConfigured:Boolean(await setting(db,'owner_telegram_user_id'))},telegramAccount:{serviceConfigured:Boolean(env.TELEGRAM_USER_SERVICE_URL&&env.TELEGRAM_USER_SERVICE_SECRET)},browserExtension:{available:true}},200,origin);
 }
 if(path==='/api/workspace/projects'){
  if(req.method==='GET'){const rows=await db.prepare('SELECT p.*, (SELECT COUNT(*) FROM workspace_tasks t WHERE t.project_id=p.id AND t.owner_id=p.owner_id) AS task_count FROM projects p WHERE p.owner_id=? ORDER BY p.updated_at DESC LIMIT 200').bind('owner').all();return json(rows.results,200,origin)}
  if(req.method==='POST'){
   const b=await parseJsonBody(req);if(!b||typeof b!=='object')return fail('بدنهٔ درخواست JSON معتبر نیست.',400,origin);
   const title=boundedText(b.title,120),description=boundedText(b.description,2000,true),status=statusProject(b.status||'active');
   if(!title||description===null||!status)return fail('عنوان، توضیح یا وضعیت پروژه معتبر نیست.',422,origin);
   const id=uuid();await db.prepare('INSERT INTO projects(id,owner_id,title,description,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,'owner',title,description,status,stamp,stamp).run();
   await recordActivity(db,'پروژه','ایجاد','پروژهٔ «'+title+'» ساخته شد');return json({id,title,description,status,created_at:stamp,updated_at:stamp,task_count:0},201,origin)
  }
 }
 const projectMatch=path.match(/^\/api\/workspace\/projects\/([a-f0-9-]{36})$/i);
 if(projectMatch){
  const id=projectMatch[1];
  if(req.method==='PUT'||req.method==='PATCH'){
   const b=await parseJsonBody(req);if(!b||typeof b!=='object')return fail('بدنهٔ درخواست JSON معتبر نیست.',400,origin);
   const current:any=await db.prepare('SELECT * FROM projects WHERE id=? AND owner_id=?').bind(id,'owner').first();if(!current)return fail('پروژه پیدا نشد.',404,origin);
   const title=b.title===undefined?current.title:boundedText(b.title,120),description=b.description===undefined?current.description:boundedText(b.description,2000,true),status=b.status===undefined?current.status:statusProject(b.status);
   if(!title||description===null||!status)return fail('عنوان، توضیح یا وضعیت پروژه معتبر نیست.',422,origin);
   await db.prepare('UPDATE projects SET title=?,description=?,status=?,updated_at=? WHERE id=? AND owner_id=?').bind(title,description,status,stamp,id,'owner').run();
   await recordActivity(db,'پروژه','ویرایش','پروژهٔ «'+title+'» ویرایش شد');return json({ok:true},200,origin)
  }
  if(req.method==='DELETE'){
   const current:any=await db.prepare('SELECT title FROM projects WHERE id=? AND owner_id=?').bind(id,'owner').first();if(!current)return fail('پروژه پیدا نشد.',404,origin);
   await db.batch([db.prepare('UPDATE workspace_tasks SET project_id=NULL,updated_at=? WHERE project_id=? AND owner_id=?').bind(stamp,id,'owner'),db.prepare('DELETE FROM projects WHERE id=? AND owner_id=?').bind(id,'owner')]);
   await recordActivity(db,'پروژه','حذف','پروژهٔ «'+String(current.title).slice(0,120)+'» حذف شد؛ وظایف حفظ شدند');return json({ok:true},200,origin)
  }
 }
 if(path==='/api/workspace/tasks'){
  if(req.method==='GET'){const rows=await db.prepare('SELECT t.*,p.title AS project_title FROM workspace_tasks t LEFT JOIN projects p ON p.id=t.project_id WHERE t.owner_id=? ORDER BY CASE t.status WHEN \'in_progress\' THEN 0 WHEN \'todo\' THEN 1 ELSE 2 END,t.updated_at DESC LIMIT 300').bind('owner').all();return json(rows.results,200,origin)}
  if(req.method==='POST'){
   const b=await parseJsonBody(req);if(!b||typeof b!=='object')return fail('بدنهٔ درخواست JSON معتبر نیست.',400,origin);
   const title=boundedText(b.title,160),description=boundedText(b.description,3000,true),status=statusTask(b.status||'todo'),priority=priorityTask(b.priority||'normal');
   const projectId=typeof b.project_id==='string'&&b.project_id?b.project_id:null,dueDate=typeof b.due_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)?b.due_date:null;
   if(!title||description===null||!status||!priority||(b.due_date&&!dueDate))return fail('عنوان، توضیح، اولویت یا تاریخ وظیفه معتبر نیست.',422,origin);
   if(projectId&&!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_id=?').bind(projectId,'owner').first())return fail('پروژهٔ انتخاب‌شده وجود ندارد.',422,origin);
   const id=uuid();await db.prepare('INSERT INTO workspace_tasks(id,owner_id,project_id,title,description,status,priority,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,'owner',projectId,title,description,status,priority,dueDate,stamp,stamp).run();
   await recordActivity(db,'وظیفه','ایجاد','وظیفهٔ «'+title+'» ساخته شد');return json({id,title,description,status,priority,project_id:projectId,due_date:dueDate,created_at:stamp,updated_at:stamp},201,origin)
  }
 }
 const taskMatch=path.match(/^\/api\/workspace\/tasks\/([a-f0-9-]{36})$/i);
 if(taskMatch){
  const id=taskMatch[1];
  if(req.method==='PATCH'||req.method==='PUT'){
   const b=await parseJsonBody(req);if(!b||typeof b!=='object')return fail('بدنهٔ درخواست JSON معتبر نیست.',400,origin);
   const current:any=await db.prepare('SELECT * FROM workspace_tasks WHERE id=? AND owner_id=?').bind(id,'owner').first();if(!current)return fail('وظیفه پیدا نشد.',404,origin);
   const title=b.title===undefined?current.title:boundedText(b.title,160),description=b.description===undefined?current.description:boundedText(b.description,3000,true),status=b.status===undefined?current.status:statusTask(b.status),priority=b.priority===undefined?current.priority:priorityTask(b.priority);
   const projectId=b.project_id===undefined?current.project_id:(typeof b.project_id==='string'&&b.project_id?b.project_id:null),dueDate=b.due_date===undefined?current.due_date:(typeof b.due_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)?b.due_date:null);
   if(!title||description===null||!status||!priority||(b.due_date!==undefined&&b.due_date!==null&&b.due_date!==''&&!dueDate))return fail('عنوان، توضیح، وضعیت، اولویت یا تاریخ معتبر نیست.',422,origin);
   if(projectId&&!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_id=?').bind(projectId,'owner').first())return fail('پروژهٔ انتخاب‌شده وجود ندارد.',422,origin);
   await db.prepare('UPDATE workspace_tasks SET project_id=?,title=?,description=?,status=?,priority=?,due_date=?,updated_at=? WHERE id=? AND owner_id=?').bind(projectId,title,description,status,priority,dueDate,stamp,id,'owner').run();
   await recordActivity(db,'وظیفه','ویرایش','وظیفهٔ «'+title+'» ویرایش شد');return json({ok:true},200,origin)
  }
  if(req.method==='DELETE'){
   const current:any=await db.prepare('SELECT title FROM workspace_tasks WHERE id=? AND owner_id=?').bind(id,'owner').first();if(!current)return fail('وظیفه پیدا نشد.',404,origin);
   await db.prepare('DELETE FROM workspace_tasks WHERE id=? AND owner_id=?').bind(id,'owner').run();await recordActivity(db,'وظیفه','حذف','وظیفهٔ «'+String(current.title).slice(0,160)+'» حذف شد');return json({ok:true},200,origin)
  }
 }
 if(path==='/api/workspace/memories'){
  if(req.method==='GET'){const rows=await db.prepare('SELECT id,title,content,tags,created_at,updated_at FROM memories WHERE owner_id=? ORDER BY updated_at DESC LIMIT 300').bind('owner').all();return json(rows.results,200,origin)}
  if(req.method==='POST'){
   const b=await parseJsonBody(req);if(!b||typeof b!=='object')return fail('بدنهٔ درخواست JSON معتبر نیست.',400,origin);
   const title=boundedText(b.title,120),content=boundedText(b.content,5000),tags=boundedText(b.tags||'',240,true);
   if(!title||!content||tags===null)return fail('عنوان و محتوای یادداشت الزامی است و طول فیلدها باید معتبر باشد.',422,origin);
   const id=uuid();await db.prepare('INSERT INTO memories(id,owner_id,title,content,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,'owner',title,content,tags,stamp,stamp).run();
   await recordActivity(db,'حافظه','ایجاد','یادداشت «'+title+'» ذخیره شد');return json({id,title,content,tags,created_at:stamp,updated_at:stamp},201,origin)
  }
 }
 const memoryMatch=path.match(/^\/api\/workspace\/memories\/([a-f0-9-]{36})$/i);
 if(memoryMatch){
  const id=memoryMatch[1];
  if(req.method==='PUT'||req.method==='PATCH'){
   const b=await parseJsonBody(req);if(!b||typeof b!=='object')return fail('بدنهٔ درخواست JSON معتبر نیست.',400,origin);
   const current:any=await db.prepare('SELECT * FROM memories WHERE id=? AND owner_id=?').bind(id,'owner').first();if(!current)return fail('یادداشت پیدا نشد.',404,origin);
   const title=b.title===undefined?current.title:boundedText(b.title,120),content=b.content===undefined?current.content:boundedText(b.content,5000),tags=b.tags===undefined?current.tags:boundedText(b.tags,240,true);
   if(!title||!content||tags===null)return fail('عنوان، محتوا یا برچسب‌ها معتبر نیستند.',422,origin);
   await db.prepare('UPDATE memories SET title=?,content=?,tags=?,updated_at=? WHERE id=? AND owner_id=?').bind(title,content,tags,stamp,id,'owner').run();await recordActivity(db,'حافظه','ویرایش','یادداشت «'+title+'» ویرایش شد');return json({ok:true},200,origin)
  }
  if(req.method==='DELETE'){
   const current:any=await db.prepare('SELECT title FROM memories WHERE id=? AND owner_id=?').bind(id,'owner').first();if(!current)return fail('یادداشت پیدا نشد.',404,origin);
   await db.prepare('DELETE FROM memories WHERE id=? AND owner_id=?').bind(id,'owner').run();await recordActivity(db,'حافظه','حذف','یادداشت «'+String(current.title).slice(0,120)+'» حذف شد');return json({ok:true},200,origin)
  }
 }
 if(path==='/api/workspace/activity'&&req.method==='GET'){
  const rows=await db.prepare('SELECT id,category,action,summary,created_at FROM activity_log WHERE owner_id=? ORDER BY created_at DESC LIMIT 200').bind('owner').all();return json(rows.results,200,origin)
 }
 return null;
}

export default {async fetch(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url),requestOrigin=req.headers.get('Origin'),origin=requestOrigin||url.origin;
 if(requestOrigin&&requestOrigin!==url.origin&&(!env.ALLOWED_ORIGIN||requestOrigin!==env.ALLOWED_ORIGIN))return fail('Origin not allowed',403,url.origin);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:responseHeaders(origin)});
 if(url.pathname==='/api/telegram/webhook'&&req.method==='POST')return handleTelegram(req,env);
 if(!url.pathname.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(req):new Response('Not Found',{status:404});
 if(['POST','PUT','PATCH'].includes(req.method)&&Number(req.headers.get('content-length')||0)>1048576)return fail('درخواست از حد مجاز یک مگابایت بزرگ‌تر است.',413,origin);
 try{
  const authResponse=await authRoute(req,env,origin,url);if(authResponse)return authResponse;
  await ensure(env.DB);
  if(!await validOwnerSession(req,env))return fail('برای ادامه، کد شش‌رقمی برنامهٔ Authenticator را وارد کنید.',401,origin);
  const workspaceResponse=await handleWorkspaceRoute(req,env,origin,url);if(workspaceResponse)return workspaceResponse;
  if(url.pathname==='/api/health'&&req.method==='GET'){try{await env.DB.prepare('SELECT 1').first();return json({ok:true,database:'ok'},200,origin)}catch{return json({ok:false,database:'unavailable'},503,origin)}}
  if(url.pathname==='/api/models'&&req.method==='GET'){const key=await openRouterKey(env.DB,env);if(!key)return fail('ابتدا کلید OpenRouter را در تنظیمات هوش مصنوعی ذخیره کنید.',409,origin);try{return json({models:await getFreeModels(key)},200,origin)}catch(e){return fail(safeError(e),502,origin)}}
  if(url.pathname.startsWith('/api/settings/telegram-user'))return await handleTelegramAccount(req,env,origin);
  if(url.pathname==='/api/ai/settings'&&req.method==='GET'){const stored=await setting(env.DB,'ai_openrouter_encrypted'),selected=await setting(env.DB,'ai_default_model'),mode=await setting(env.DB,'ai_model_mode')||'auto',last=await setting(env.DB,'ai_last_tested_at');let mask='';if(stored){try{mask=`••••••••${(await decryptSecret(env,stored)).slice(-4)}`}catch{mask='ذخیره‌شده؛ رمزگشایی نیازمند بررسی سرور'}}return json({provider:'openrouter',has_key:Boolean(stored),masked_key:mask,default_model:selected,model_mode:mode,last_tested_at:last},200,origin)}
  if(url.pathname==='/api/ai/test'&&req.method==='POST'){if(await rateLimited(env.DB,'ai-test-owner',6))return fail('تعداد آزمایش‌ها زیاد است؛ یک دقیقه بعد دوباره تلاش کنید.',429,origin);const body:any=await req.json();const key=typeof body.api_key==='string'&&body.api_key.trim()?body.api_key.trim():await openRouterKey(env.DB,env);if(!key)return fail('ابتدا کلید OpenRouter را وارد کنید.',422,origin);if(key.length>512||/[\r\n]/.test(key))return fail('قالب کلید نامعتبر است.',422,origin);try{const models=await getFreeModels(key);const tested=now(),fingerprint=toB64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(key))));await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('ai_last_tested_at',tested,tested).run();await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('ai_tested_key_fingerprint',fingerprint,tested).run();return json({ok:true,free_model_count:models.length,tested_at:tested},200,origin)}catch(e){return fail(safeError(e),e instanceof Error&&e.message.includes('رد شد')?401:502,origin)}}
  if(url.pathname==='/api/ai/settings'&&req.method==='PUT'){const body:any=await req.json();if(body.provider!=='openrouter')return fail('ارائه‌دهندهٔ پشتیبانی‌شده در حال حاضر OpenRouter است.',422,origin);const secret=typeof body.api_key==='string'?body.api_key.trim():'';if(secret&&(secret.length<8||secret.length>512||/[\r\n]/.test(secret)))return fail('قالب کلید API معتبر نیست.',422,origin);const encrypted=secret?await encryptSecret(env,secret):null;const mode=body.model_mode==='manual'?'manual':'auto';let chosen='';if(mode==='manual'){if(typeof body.default_model!=='string'||body.default_model.length>240)return fail('یک مدل معتبر انتخاب کنید.',422,origin);const key=secret||await openRouterKey(env.DB,env);if(!key)return fail('برای انتخاب مدل ابتدا کلید را ذخیره کنید.',422,origin);const models=await getFreeModels(key);if(!models.some(m=>m.id===body.default_model))return fail('مدل انتخابی در فهرست مدل‌های رایگان با قیمت صفر نیست.',422,origin);chosen=body.default_model}if(encrypted){await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('ai_openrouter_encrypted',encrypted,now()).run();const fingerprint=toB64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(secret))));if(await setting(env.DB,'ai_tested_key_fingerprint')!==fingerprint)await env.DB.prepare("DELETE FROM settings WHERE key IN ('ai_last_tested_at','ai_tested_key_fingerprint')").run()}await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('ai_model_mode',mode,now()).run();await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('ai_default_model',chosen,now()).run();return json({ok:true,has_key:Boolean(secret)||Boolean(await setting(env.DB,'ai_openrouter_encrypted')),model_mode:mode,default_model:chosen},200,origin)}
  if(url.pathname==='/api/ai/settings'&&req.method==='DELETE'){await env.DB.prepare("DELETE FROM settings WHERE key IN ('ai_openrouter_encrypted','ai_default_model','ai_model_mode','ai_last_tested_at','ai_tested_key_fingerprint')").run();return json({ok:true},200,origin)}
  if(url.pathname==='/api/settings'&&req.method==='GET')return json({owner_telegram_user_id:await setting(env.DB,'owner_telegram_user_id'),telegram_token:env.TELEGRAM_BOT_TOKEN?'••••••••':''},200,origin);
  if(url.pathname==='/api/settings'&&req.method==='PUT'){const body:any=await req.json();if(body.owner_telegram_user_id!==undefined&&(!/^[0-9]{1,20}$/.test(body.owner_telegram_user_id)))return fail('شناسه باید رشتهٔ عددی معتبر باشد.',422,origin);if(body.owner_telegram_user_id)await env.DB.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('owner_telegram_user_id',body.owner_telegram_user_id,now()).run();return json({ok:true},200,origin)}
  if(url.pathname==='/api/conversations'&&req.method==='GET'){const r=await env.DB.prepare("SELECT id,title,updated_at,archived FROM conversations WHERE owner_id='owner' AND archived=0 ORDER BY updated_at DESC LIMIT 100").all();return json(r.results,200,origin)}
  if(url.pathname==='/api/conversations'&&req.method==='POST'){const b:any=await req.json(),cid=uuid(),stamp=now(),title=String(b.title||'گفتگوی تازه').slice(0,160);await env.DB.prepare('INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').bind(cid,'owner',title,stamp,stamp).run();return json({id:cid,title,updated_at:stamp},201,origin)}
  const match=url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);if(match){const cid=decodeURIComponent(match[1]),conversation:any=await env.DB.prepare("SELECT id FROM conversations WHERE id=? AND owner_id='owner' AND archived=0").bind(cid).first();if(!conversation)return fail('گفتگو پیدا نشد.',404,origin);if(req.method==='GET'){const rows=await env.DB.prepare('SELECT id,role,content,created_at FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT 300').bind(cid).all();return json(rows.results,200,origin)}if(req.method==='POST'){const body:any=await req.json();if(typeof body.content!=='string'||!body.content.trim()||body.content.length>20000)return fail('پیام باید بین ۱ تا ۲۰٬۰۰۰ نویسه باشد.',422,origin);if(await rateLimited(env.DB,'chat-owner',12))return fail('حد پیام‌ها در یک دقیقه پر شده است؛ کمی بعد دوباره تلاش کنید.',429,origin);const stamp=now();await env.DB.prepare("INSERT INTO messages(id,conversation_id,role,content,source,created_at) VALUES(?,?,?,?,?,?)").bind(uuid(),cid,'user',body.content,'web',stamp).run();await env.DB.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(stamp,cid).run();try{const pref=await setting(env.DB,'ai_model_mode')==='manual'?await setting(env.DB,'ai_default_model'):undefined;return json(await answer(env.DB,env,cid,body.content,'web',pref||undefined),200,origin)}catch(e){return fail(safeError(e),Number((e as any)?.status)||502,origin)}}}
  return fail('درخواست ناشناخته است.',404,origin)
 }catch(e){return fail(safeError(e),500,origin)}
 },async scheduled(_event:unknown,env:Env){await ensure(env.DB);await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(Math.floor(Date.now()/1000)).run();await env.DB.prepare('DELETE FROM rate_limits WHERE window_start<?').bind(Math.floor(Date.now()/60000)-60).run()}};
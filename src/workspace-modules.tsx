import React, {useEffect, useState} from 'react';
import {Activity, Archive, BookOpen, Check, ChevronLeft, CircleAlert, Clock3, Code2, ExternalLink, FolderKanban, Link2, ListTodo, Pencil, Plus, RefreshCw, Save, Shield, Trash2, Workflow, X, Zap} from 'lucide-react';

type ProjectStatus='planning'|'active'|'paused'|'done';
type TaskStatus='todo'|'in_progress'|'done';
type Priority='low'|'normal'|'high';
type Project={id:string;title:string;description:string;status:ProjectStatus;created_at:string;updated_at:string;task_count?:number};
type Task={id:string;title:string;description:string;status:TaskStatus;priority:Priority;project_id:string|null;project_title?:string|null;due_date:string|null;created_at:string;updated_at:string};
type Memory={id:string;title:string;content:string;tags:string;created_at:string;updated_at:string};
type Event={id:string;category:string;action:string;summary:string;created_at:string};
type Integrations={openrouter:{configured:boolean;tested:boolean};telegramBot:{tokenConfigured:boolean;ownerConfigured:boolean};telegramAccount:{serviceConfigured:boolean};browserExtension:{available:boolean}};
type Props={nav:string;onNavigate:(page:string)=>void;notify:(message:string)=>void};

async function api<T>(path:string,init:RequestInit={}):Promise<T>{
  const headers=new Headers(init.headers);
  if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json');
  const response=await fetch('/api'+path,{...init,headers,cache:'no-store'});
  let data:any=null;try{data=await response.json()}catch{}
  if(!response.ok)throw new Error(data?.error||data?.detail|| (response.status===401?'نشست منقضی شده است؛ دوباره با Authenticator وارد شوید.':`درخواست ناموفق بود (HTTP ${response.status}).`));
  return data as T;
}
const body=(method:string,value:unknown):RequestInit=>({method,body:JSON.stringify(value)});
const projectLabels:Record<ProjectStatus,string>={planning:'در حال برنامه‌ریزی',active:'فعال',paused:'متوقف',done:'تکمیل‌شده'};
const taskLabels:Record<TaskStatus,string>={todo:'برای انجام',in_progress:'در حال انجام',done:'انجام‌شده'};
const priorityLabels:Record<Priority,string>={low:'کم',normal:'معمولی',high:'بالا'};
const dateText=(value:string)=>{try{return new Date(value).toLocaleString('fa-IR',{dateStyle:'medium',timeStyle:'short'})}catch{return value}};

export function WorkspaceModule({nav,onNavigate,notify}:Props){
 const [projects,setProjects]=useState<Project[]>([]),[tasks,setTasks]=useState<Task[]>([]),[memories,setMemories]=useState<Memory[]>([]),[events,setEvents]=useState<Event[]>([]),[integrations,setIntegrations]=useState<Integrations|null>(null),[conversations,setConversations]=useState<Array<{id:string;title:string;updated_at:string}>>([]);
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [projectEdit,setProjectEdit]=useState<string|null>(null),[projectForm,setProjectForm]=useState({title:'',description:'',status:'active' as ProjectStatus});
 const [taskEdit,setTaskEdit]=useState<string|null>(null),[taskForm,setTaskForm]=useState({title:'',description:'',status:'todo' as TaskStatus,priority:'normal' as Priority,project_id:'',due_date:''});
 const [memoryEdit,setMemoryEdit]=useState<string|null>(null),[memoryForm,setMemoryForm]=useState({title:'',content:'',tags:''});
 async function reload(){
  setLoading(true);setError('');
  try{
   if(nav==='پروژه‌ها')setProjects(await api<Project[]>('/workspace/projects'));
   else if(nav==='وظایف'){
    const [p,t]=await Promise.all([api<Project[]>('/workspace/projects'),api<Task[]>('/workspace/tasks')]);setProjects(p);setTasks(t);
   }else if(nav==='حافظه و تاریخچه'){
    const [m,c]=await Promise.all([api<Memory[]>('/workspace/memories'),api<Array<{id:string;title:string;updated_at:string}>>('/conversations')]);setMemories(m);setConversations(c);
   }else if(nav==='گزارش فعالیت')setEvents(await api<Event[]>('/workspace/activity'));
   else if(nav==='اتصالات')setIntegrations(await api<Integrations>('/workspace/integrations'));
  }catch(e){setError(e instanceof Error?e.message:'بارگذاری اطلاعات ناموفق بود.')}
  finally{setLoading(false)}
 }
 useEffect(()=>{void reload();},[nav]);
 async function saveProject(){
  setSaving(true);setError('');
  try{
   if(projectEdit)await api('/workspace/projects/'+projectEdit,body('PUT',projectForm));
   else await api('/workspace/projects',body('POST',projectForm));
   setProjectForm({title:'',description:'',status:'active'});setProjectEdit(null);await reload();notify('پروژه ذخیره شد.');
  }catch(e){setError(e instanceof Error?e.message:'ذخیره پروژه ناموفق بود.')}finally{setSaving(false)}
 }
 function editProject(p:Project){setProjectEdit(p.id);setProjectForm({title:p.title,description:p.description,status:p.status});window.scrollTo({top:0,behavior:'smooth'});}
 async function deleteProject(p:Project){
  if(!window.confirm(`پروژهٔ «${p.title}» حذف شود؟ وظایف آن حفظ و از پروژه جدا می‌شوند.`))return;
  setError('');try{await api('/workspace/projects/'+p.id,{method:'DELETE'});await reload();notify('پروژه حذف شد.')}catch(e){setError(e instanceof Error?e.message:'حذف پروژه ناموفق بود.')}
 }
 async function saveTask(){
  setSaving(true);setError('');
  const value={...taskForm,project_id:taskForm.project_id||null,due_date:taskForm.due_date||null};
  try{
   if(taskEdit)await api('/workspace/tasks/'+taskEdit,body('PATCH',value));
   else await api('/workspace/tasks',body('POST',value));
   setTaskForm({title:'',description:'',status:'todo',priority:'normal',project_id:'',due_date:''});setTaskEdit(null);await reload();notify('وظیفه ذخیره شد.');
  }catch(e){setError(e instanceof Error?e.message:'ذخیره وظیفه ناموفق بود.')}finally{setSaving(false)}
 }
 function editTask(t:Task){setTaskEdit(t.id);setTaskForm({title:t.title,description:t.description,status:t.status,priority:t.priority,project_id:t.project_id||'',due_date:t.due_date||''});window.scrollTo({top:0,behavior:'smooth'});}
 async function updateTask(t:Task,changes:Partial<Task>){
  try{await api('/workspace/tasks/'+t.id,body('PATCH',changes));await reload();notify('وضعیت وظیفه به‌روزرسانی شد.')}catch(e){setError(e instanceof Error?e.message:'به‌روزرسانی وظیفه ناموفق بود.')}
 }
 async function deleteTask(t:Task){
  if(!window.confirm(`وظیفهٔ «${t.title}» حذف شود؟`))return;
  try{await api('/workspace/tasks/'+t.id,{method:'DELETE'});await reload();notify('وظیفه حذف شد.')}catch(e){setError(e instanceof Error?e.message:'حذف وظیفه ناموفق بود.')}
 }
 async function saveMemory(){
  setSaving(true);setError('');
  try{
   if(memoryEdit)await api('/workspace/memories/'+memoryEdit,body('PUT',memoryForm));
   else await api('/workspace/memories',body('POST',memoryForm));
   setMemoryForm({title:'',content:'',tags:''});setMemoryEdit(null);await reload();notify('یادداشت خصوصی ذخیره شد.');
  }catch(e){setError(e instanceof Error?e.message:'ذخیره یادداشت ناموفق بود.')}finally{setSaving(false)}
 }
 function editMemory(m:Memory){setMemoryEdit(m.id);setMemoryForm({title:m.title,content:m.content,tags:m.tags});window.scrollTo({top:0,behavior:'smooth'});}
 async function deleteMemory(m:Memory){
  if(!window.confirm(`یادداشت «${m.title}» برای همیشه حذف شود؟`))return;
  try{await api('/workspace/memories/'+m.id,{method:'DELETE'});await reload();notify('یادداشت حذف شد.')}catch(e){setError(e instanceof Error?e.message:'حذف یادداشت ناموفق بود.')}
 }
 const heading=nav==='پروژه‌ها'?'مدیریت پروژه‌های شخصی':nav==='وظایف'?'برنامه‌ریزی و پیگیری وظایف':nav==='اتصالات'?'وضعیت اتصال سرویس‌ها':nav==='افزونه مرورگر'?'افزونهٔ همراه مرورگر':nav==='حافظه و تاریخچه'?'یادداشت‌های ماندگار و تاریخچه':nav==='گزارش فعالیت'?'گزارش فعالیت‌های اخیر':'فضای کار';
 return <div className="workspace-module">
  <div className="workspace-module-header"><div><div className="workspace-module-kicker"><Shield size={14}/> فضای خصوصی مالک</div><h2>{heading}</h2><p>{nav==='پروژه‌ها'?'پروژه بساز، وضعیت را تغییر بده و کارها را به پروژه وصل کن.':nav==='وظایف'?'وظایف، اولویت‌ها، موعد و وضعیت اجرا در فضای ذخیره‌شدهٔ شخصی.':nav==='اتصالات'?'وضعیت از روی تنظیمات واقعی سرور خوانده می‌شود؛ هیچ اتصال ساختگی سبز نمایش داده نمی‌شود.':nav==='افزونه مرورگر'?'ابزار کوچک و متن‌باز برای فرستادن نشانی صفحهٔ جاری به KAYRO AI، بدون ارسال خودکار محتوا.':nav==='حافظه و تاریخچه'?'یادداشت‌های شخصی به‌صورت پایدار در D1 ذخیره می‌شوند؛ آن‌ها خودکار وارد مدل نمی‌شوند.':'آخرین تغییرات مهم فضای کار؛ اطلاعات حساس و محتوای کامل پیام‌ها ثبت نمی‌شود.'}</p></div><button className="wm-refresh" disabled={loading} onClick={()=>void reload()}><RefreshCw size={15}/> تازه‌سازی</button></div>
  {error&&<div className="wm-error" role="alert"><CircleAlert size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="بستن پیام"><X size={15}/></button></div>}
  {loading&&<div className="wm-loading"><Activity size={17}/> در حال دریافت اطلاعات ذخیره‌شده…</div>}
  {!loading&&nav==='پروژه‌ها'&&<div className="wm-columns"><section className="wm-card"><div className="wm-card-title"><FolderKanban size={19}/><div><h3>{projectEdit?'ویرایش پروژه':'پروژهٔ تازه'}</h3><small>اطلاعات خصوصی در پایگاه‌دادهٔ D1 ذخیره می‌شود.</small></div></div><form onSubmit={e=>{e.preventDefault();void saveProject()}} className="wm-form"><label>عنوان پروژه<input required maxLength={120} value={projectForm.title} onChange={e=>setProjectForm({...projectForm,title:e.target.value})} placeholder="مثلاً KAYRO AI"/></label><label>توضیح<textarea maxLength={2000} value={projectForm.description} onChange={e=>setProjectForm({...projectForm,description:e.target.value})} rows={3} placeholder="هدف و نتیجهٔ مورد انتظار"/></label><label>وضعیت<select value={projectForm.status} onChange={e=>setProjectForm({...projectForm,status:e.target.value as ProjectStatus})}>{Object.entries(projectLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><div className="wm-form-actions"><button className="wm-primary" disabled={saving}><Save size={15}/>{saving?'در حال ذخیره…':'ذخیره پروژه'}</button>{projectEdit&&<button type="button" className="wm-secondary" onClick={()=>{setProjectEdit(null);setProjectForm({title:'',description:'',status:'active'})}}>انصراف</button>}</div></form></section><section className="wm-card"><div className="wm-card-title"><FolderKanban size={19}/><div><h3>پروژه‌های ذخیره‌شده</h3><small>{projects.length} پروژه</small></div></div>{projects.length===0?<div className="wm-empty"><FolderKanban size={24}/><b>هنوز پروژه‌ای ساخته نشده</b><span>فرم کنار صفحه را برای ساخت اولین پروژه پر کن.</span></div>:<div className="wm-list">{projects.map(p=><article className="wm-item" key={p.id}><div className="wm-item-main"><div className="wm-item-heading"><b>{p.title}</b><span className={'wm-badge '+p.status}>{projectLabels[p.status]}</span></div>{p.description&&<p>{p.description}</p>}<small>{p.task_count||0} وظیفه · آخرین تغییر {dateText(p.updated_at)}</small></div><div className="wm-item-actions"><button title="ویرایش" onClick={()=>editProject(p)}><Pencil size={15}/></button><button title="حذف پروژه" className="is-danger" onClick={()=>void deleteProject(p)}><Trash2 size={15}/></button></div></article>)}</div>}</section></div>}
  {!loading&&nav==='وظایف'&&<><section className="wm-card wm-task-create"><div className="wm-card-title"><ListTodo size={19}/><div><h3>{taskEdit?'ویرایش وظیفه':'وظیفهٔ تازه'}</h3><small>وضعیت، اولویت و موعد را در یک جا مدیریت کن.</small></div></div><form onSubmit={e=>{e.preventDefault();void saveTask()}} className="wm-form wm-task-form"><label>عنوان وظیفه<input required maxLength={160} value={taskForm.title} onChange={e=>setTaskForm({...taskForm,title:e.target.value})} placeholder="چه کاری باید انجام شود؟"/></label><label>پروژه<select value={taskForm.project_id} onChange={e=>setTaskForm({...taskForm,project_id:e.target.value})}><option value="">بدون پروژه</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label>وضعیت<select value={taskForm.status} onChange={e=>setTaskForm({...taskForm,status:e.target.value as TaskStatus})}>{Object.entries(taskLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>اولویت<select value={taskForm.priority} onChange={e=>setTaskForm({...taskForm,priority:e.target.value as Priority})}>{Object.entries(priorityLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>موعد انجام<input type="date" value={taskForm.due_date} onChange={e=>setTaskForm({...taskForm,due_date:e.target.value})}/></label><label className="wm-task-description">توضیح<textarea rows={2} maxLength={3000} value={taskForm.description} onChange={e=>setTaskForm({...taskForm,description:e.target.value})} placeholder="جزئیات اختیاری"/></label><div className="wm-form-actions"><button className="wm-primary" disabled={saving}><Save size={15}/>{saving?'در حال ذخیره…':'ذخیره وظیفه'}</button>{taskEdit&&<button type="button" className="wm-secondary" onClick={()=>{setTaskEdit(null);setTaskForm({title:'',description:'',status:'todo',priority:'normal',project_id:'',due_date:''})}}>انصراف</button>}</div></form></section><section className="wm-card"><div className="wm-card-title"><Workflow size={19}/><div><h3>فهرست وظایف</h3><small>{tasks.filter(t=>t.status!=='done').length} باز · {tasks.filter(t=>t.status==='done').length} انجام‌شده</small></div></div>{tasks.length===0?<div className="wm-empty"><ListTodo size={24}/><b>وظیفه‌ای ثبت نشده</b><span>اولین وظیفه را بالا اضافه کن.</span></div>:<div className="wm-list">{tasks.map(t=><article className={'wm-item wm-task-item '+(t.status==='done'?'is-done':'')} key={t.id}><div className="wm-item-main"><div className="wm-item-heading"><b>{t.title}</b><span className={'wm-badge '+t.status}>{taskLabels[t.status]}</span><span className={'wm-priority '+t.priority}>اولویت {priorityLabels[t.priority]}</span></div>{t.description&&<p>{t.description}</p>}<small>{t.project_title||'بدون پروژه'}{t.due_date?' · موعد: '+t.due_date:''} · آخرین تغییر {dateText(t.updated_at)}</small></div><div className="wm-item-actions"><select aria-label={'وضعیت '+t.title} value={t.status} onChange={e=>void updateTask(t,{status:e.target.value as TaskStatus})}>{Object.entries(taskLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><button title="ویرایش" onClick={()=>editTask(t)}><Pencil size={15}/></button><button title="حذف" className="is-danger" onClick={()=>void deleteTask(t)}><Trash2 size={15}/></button></div></article>)}</div>}</section></>}
  {!loading&&nav==='حافظه و تاریخچه'&&<><section className="wm-columns"><section className="wm-card"><div className="wm-card-title"><BookOpen size={19}/><div><h3>{memoryEdit?'ویرایش یادداشت':'یادداشت جدید'}</h3><small>یادداشت‌ها دائمی‌اند و خودکار به چت ارسال نمی‌شوند.</small></div></div><form className="wm-form" onSubmit={e=>{e.preventDefault();void saveMemory()}}><label>عنوان<input required maxLength={120} value={memoryForm.title} onChange={e=>setMemoryForm({...memoryForm,title:e.target.value})} placeholder="موضوع یادداشت"/></label><label>محتوا<textarea required rows={6} maxLength={5000} value={memoryForm.content} onChange={e=>setMemoryForm({...memoryForm,content:e.target.value})} placeholder="اطلاعاتی که می‌خواهی برای مراجعهٔ بعدی نگه داری"/></label><label>برچسب‌ها<input maxLength={240} value={memoryForm.tags} onChange={e=>setMemoryForm({...memoryForm,tags:e.target.value})} placeholder="مثلاً کار، ایده، پروژه"/></label><div className="wm-form-actions"><button className="wm-primary" disabled={saving}><Save size={15}/>{saving?'در حال ذخیره…':'ذخیره یادداشت'}</button>{memoryEdit&&<button type="button" className="wm-secondary" onClick={()=>{setMemoryEdit(null);setMemoryForm({title:'',content:'',tags:''})}}>انصراف</button>}</div></form></section><section className="wm-card"><div className="wm-card-title"><BookOpen size={19}/><div><h3>یادداشت‌های خصوصی</h3><small>{memories.length} یادداشت ذخیره‌شده</small></div></div>{memories.length===0?<div className="wm-empty"><BookOpen size={24}/><b>حافظه خالی است</b><span>اولین یادداشت را بنویس.</span></div>:<div className="wm-list">{memories.map(m=><article className="wm-item" key={m.id}><div className="wm-item-main"><div className="wm-item-heading"><b>{m.title}</b>{m.tags&&<span className="wm-badge">{m.tags}</span>}</div><p className="wm-memory-content">{m.content}</p><small>آخرین تغییر {dateText(m.updated_at)}</small></div><div className="wm-item-actions"><button title="ویرایش" onClick={()=>editMemory(m)}><Pencil size={15}/></button><button title="حذف" className="is-danger" onClick={()=>void deleteMemory(m)}><Trash2 size={15}/></button></div></article>)}</div>}</section></section><section className="wm-card wm-history-card"><div className="wm-card-title"><Clock3 size={19}/><div><h3>تاریخچهٔ گفتگوها</h3><small>گفتگوها و پیام‌ها جدا از یادداشت‌های حافظه نگه‌داری می‌شوند.</small></div><button className="wm-text-button" onClick={()=>onNavigate('گفتگوها')}>مشاهدهٔ همه <ChevronLeft size={15}/></button></div>{conversations.length===0?<div className="wm-empty compact">هنوز گفتگویی ذخیره نشده است.</div>:<div className="wm-list">{conversations.slice(0,8).map(c=><button className="wm-history-row" key={c.id} onClick={()=>onNavigate('گفتگوها')}><span><b>{c.title||'گفتگوی بدون عنوان'}</b><small>{dateText(c.updated_at)}</small></span><ChevronLeft size={16}/></button>)}</div>}</section></>}
  {!loading&&nav==='گزارش فعالیت'&&<section className="wm-card"><div className="wm-card-title"><Activity size={19}/><div><h3>رویدادهای اخیر</h3><small>حداکثر ۲۰۰ رویداد اخیر؛ بدون متن پیام یا اعتبارنامه</small></div></div>{events.length===0?<div className="wm-empty"><Activity size={24}/><b>هنوز رویدادی ثبت نشده</b><span>ایجاد و ویرایش پروژه، وظیفه و یادداشت‌ها این گزارش را پر می‌کند.</span></div>:<div className="wm-activity-list">{events.map(ev=><article className="wm-activity" key={ev.id}><div className="wm-activity-icon"><Activity size={16}/></div><div><div className="wm-item-heading"><b>{ev.summary}</b><span className="wm-badge">{ev.category} · {ev.action}</span></div><small>{dateText(ev.created_at)}</small></div></article>)}</div>}</section>}
  {!loading&&nav==='اتصالات'&&<div className="wm-integration-grid">
   <IntegrationCard title="OpenRouter" description="مدل‌های هوش مصنوعی و گفتگو" configured={!!integrations?.openrouter.configured} detail={integrations?.openrouter.tested?'کلید ذخیره و اتصال قبلاً آزمایش شده است.':integrations?.openrouter.configured?'کلید ذخیره شده؛ آزمایش اتصال لازم است.':'کلید API هنوز در سرور ذخیره نشده است.'} icon={<Zap size={20}/>} action="تنظیم هوش مصنوعی" onClick={()=>onNavigate('هوش مصنوعی و API')}/>
   <IntegrationCard title="حساب شخصی تلگرام" description="گفتگو، تاریخچه و ارسال با تأیید دستی" configured={!!integrations?.telegramAccount.serviceConfigured} detail={integrations?.telegramAccount.serviceConfigured?'نشانی و کلید پل ارتباطی تنظیم شده‌اند؛ اتصال حساب را داخل صفحهٔ تلگرام آزمایش کن.':'سرویس MTProto یا Secretهای اتصال هنوز تنظیم نشده‌اند.'} icon={<Link2 size={20}/>} action="مدیریت حساب تلگرام" onClick={()=>onNavigate('حساب تلگرام')}/>
   <IntegrationCard title="ربات تلگرام" description="وب‌هوک و دسترسی ربات" configured={!!integrations?.telegramBot.tokenConfigured&&!!integrations?.telegramBot.ownerConfigured} detail={integrations?.telegramBot.tokenConfigured&&integrations?.telegramBot.ownerConfigured?'توکن و شناسهٔ مالک ثبت شده‌اند؛ تحویل وب‌هوک باید جداگانه آزمایش شود.': 'توکن ربات یا شناسهٔ عددی مالک کم است.'} icon={<Link2 size={20}/>} action="تنظیم ربات تلگرام" onClick={()=>onNavigate('ربات تلگرام')}/>
   <IntegrationCard title="افزونهٔ مرورگر" description="کمک سریع از صفحهٔ جاری" configured={true} detail="فایل‌های افزونه داخل مخزن قرار دارند؛ نصب محلی از طریق Load unpacked انجام می‌شود." icon={<Code2 size={20}/>} action="راهنمای نصب افزونه" onClick={()=>onNavigate('افزونه مرورگر')}/>
  </div>}
  {!loading&&nav==='افزونه مرورگر'&&<><section className="wm-card"><div className="wm-card-title"><Code2 size={19}/><div><h3>افزونهٔ کوچک و خصوصی KAYRO</h3><small>Chrome و مرورگرهای مبتنی بر Chromium · Manifest V3</small></div></div><p className="wm-long-copy">این افزونه عنوان و نشانی صفحهٔ جاری را فقط پس از کلیک خودت آماده می‌کند و آن را در کلیپ‌بورد می‌گذارد؛ سپس KAYRO AI را باز می‌کند. محتوای صفحه، کوکی‌ها، گذرواژه‌ها و تاریخچهٔ مرورگر به‌طور خودکار خوانده یا ارسال نمی‌شود.</p><div className="wm-extension-features"><div><Shield size={18}/><b>بدون کلید API</b><small>هیچ Secretی داخل افزونه نیست.</small></div><div><Code2 size={18}/><b>دسترسی محدود</b><small>فقط تب فعال پس از اقدام کاربر.</small></div><div><ExternalLink size={18}/><b>بدون آپلود خودکار</b><small>متن فقط به انتخاب خودت منتقل می‌شود.</small></div></div><div className="wm-install"><h4>نصب دستی روی Chrome / Chromium</h4><ol><li>مخزن <a href="https://github.com/kiarash707/AI/tree/main/browser-extension" target="_blank" rel="noreferrer">browser-extension در GitHub</a> را دانلود کن و ZIP را Extract کن.</li><li>در نوار آدرس مرورگر <code>chrome://extensions</code> را باز کن.</li><li>Developer mode را روشن و روی <b>Load unpacked</b> کلیک کن.</li><li>پوشهٔ <code>browser-extension</code> را انتخاب کن و افزونه را Pin کن.</li></ol></div><button className="wm-primary" onClick={()=>onNavigate('گفتگوها')}><Plus size={15}/> رفتن به گفتگو و تحلیل صفحه</button></section></>}
 </div>;
}

function IntegrationCard({title,description,configured,detail,icon,action,onClick}:{title:string;description:string;configured:boolean;detail:string;icon:React.ReactNode;action:string;onClick:()=>void}){
 return <article className="wm-card wm-integration-card"><div className={'wm-integration-icon '+(configured?'is-ready':'')}>{icon}</div><div className="wm-item-heading"><h3>{title}</h3><span className={'wm-badge '+(configured?'active':'paused')}>{configured?'تنظیم شده':'نیازمند تنظیم'}</span></div><p>{description}</p><small>{detail}</small><button className="wm-secondary" onClick={onClick}>{action}<ChevronLeft size={15}/></button></article>;
}

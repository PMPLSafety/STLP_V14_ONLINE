const $=id=>document.getElementById(id);
let sb, profile;
let pendingImportRows = [];

// Single Source of Truth Schema for User Export and User Import
const USER_EXCEL_COLUMNS = [
  "Employee ID",
  "Name",
  "Department",
  "Designation",
  "Company",
  "Status",
  "Username/Email"
];

const configured = !window.SUPABASE_URL.includes("YOUR_") && !window.SUPABASE_ANON_KEY.includes("YOUR_");
if(configured) sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const esc = x => String(x??"").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));

function cleanExcelVal(val) {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();
  if (str.endsWith('.0')) {
    str = str.slice(0, -2);
  }
  return str;
}

function validateEmail(email) {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase().trim());
}

function loginPage(msg=""){
  app.innerHTML = `<div class=login><div class=loginbox><h1>🛡️ Safety Training & Learning Portal</h1><p class=muted>Talwandi Sabo Thermal Plant</p><label>Email / Employee ID</label><input id=email><label>Password</label><input id=password type=password onkeydown="if(event.key==='Enter')login()"><button class="btn blue full" onclick=login()>Login</button><p class=muted>${esc(msg)}</p></div></div>`;
}

async function login(){
  if(!configured) return loginPage("Configure config.js first.");
  let inputVal = $('email').value.trim();
  let passVal = $('password').value;

  let emailToAuth = inputVal;
  if(!inputVal.includes("@")){
    let pr = await sb.from("profiles").select("username").eq("employee_id", inputVal).single();
    if(pr.data && pr.data.username){
      emailToAuth = pr.data.username;
    } else {
      emailToAuth = `${inputVal.toLowerCase()}@tsl.internal`;
    }
  }

  let r = await sb.auth.signInWithPassword({ email: emailToAuth, password: passVal });
  if(r.error) return loginPage(r.error.message);

  let p = await sb.from("profiles").select("*").eq("id", r.data.user.id).single();
  if(p.data && p.data.active === false && p.data.role !== 'admin'){
    await sb.auth.signOut();
    return loginPage("Your account is deactivated. Please contact Admin.");
  }

  start();
}

async function start(){
  let r = await sb.auth.getUser();
  if(!r.data.user) return loginPage();
  let p = await sb.from("profiles").select("*").eq("id", r.data.user.id).single();
  if(p.error) return loginPage("Login works but no profile exists.");
  if(p.data.active === false && p.data.role !== 'admin'){
    await sb.auth.signOut();
    return loginPage("Your account is deactivated. Please contact Admin.");
  }
  profile = p.data;
  route("dash");
}

async function logout(){
  await sb.auth.signOut();
  profile = null;
  loginPage();
}

const MENU_ICONS = {
  dash:"📊", users:"👥", train:"📚", notes:"🔔", results:"📝",
  progress:"📈", reports:"📄", history:"🕒", feedback:"💬"
};

let _clockTimer = null;
function _sidebarCollapsedPref(){ return localStorage.getItem("stlp_sidebar_collapsed") === "1"; }
function toggleSidebar(){
  const side = $("sideEl"), main = $("mainEl");
  const nowCollapsed = !side.classList.contains("collapsed");
  side.classList.toggle("collapsed", nowCollapsed);
  main.classList.toggle("collapsed", nowCollapsed);
  localStorage.setItem("stlp_sidebar_collapsed", nowCollapsed ? "1" : "0");
}
function toggleMobileSidebar(){
  $("sideEl")?.classList.toggle("mobile-open");
  $("sideScrim")?.classList.toggle("show");
}

function layout(active, title, html){
  let admin = profile.role === "admin";
  let menu = admin ?
    [["dash","Dashboard"],["users","Users Management"],["train","Training"],["notes","Notifications"],["results","Results"],["progress","Progress"],["reports","Reports"],["history","History"],["feedback","Feedback"]] :
    [["dash","Dashboard"],["train","My Trainings"],["notes","Notifications"],["results","Assessments"],["history","History"]];

  const collapsed = _sidebarCollapsedPref();
  const initials = (profile.name||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();

  app.innerHTML = `
    <div class="side-scrim" id="sideScrim" onclick="toggleMobileSidebar()"></div>
    <aside class="side${collapsed?" collapsed":""}" id="sideEl">
      <button class="side-toggle" onclick="toggleSidebar()" title="Collapse sidebar">${collapsed?"›":"‹"}</button>
      <div class="brand"><span class="mark">🛡️</span><span class="txt">Safety Training &amp; Learning Portal<small>Talwandi Sabo Thermal Plant</small></span></div>
      <div class="nav">${menu.map(m=>`<button class="${active===m[0]?"active":""}" data-tip="${esc(m[1])}" onclick="route('${m[0]}')"><span class="ico">${MENU_ICONS[m[0]]||"•"}</span><span class="lbl">${esc(m[1])}</span></button>`).join("")}</div>
      <div class="sidebar-foot"><button class="btn light full" onclick="logout()">🚪 <span class="lbl-logout">Logout</span></button></div>
    </aside>
    <main class="main${collapsed?" collapsed":""}" id="mainEl">
      <div class="top">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="mobile-menu-btn" onclick="toggleMobileSidebar()">☰</button>
          <div><span class="eyebrow">${admin?"Administrator":"Employee"} Portal</span><h2>${esc(title)}</h2></div>
        </div>
        <div class="top-right">
          <div class="clock" id="topClock"><span class="t">--:--:--</span><span class="d">--</span></div>
          <button class="btn light" style="padding:9px 12px;font-size:12px" onclick="changeMyPasswordModal()">🔑 Change Password</button>
          <span class="chip"><span class="avatar">${esc(initials||"U")}</span>${esc(profile.name)}<span class="role-tag">${admin?"ADMIN":"USER"}</span></span>
        </div>
      </div>
      <div class="content-pad">${html}</div>
    </main>`;

  _startClock();
}

function _startClock(){
  if(_clockTimer) clearInterval(_clockTimer);
  const tick = () => {
    const el = $("topClock");
    if(!el){ clearInterval(_clockTimer); return; }
    const now = new Date();
    el.querySelector(".t").textContent = now.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    el.querySelector(".d").textContent = now.toLocaleDateString("en-IN",{weekday:"short",day:"2-digit",month:"short",year:"numeric"});
  };
  tick();
  _clockTimer = setInterval(tick, 1000);
}

function metric(a,b){
  return `<div class=card><span class=muted>${a}</span><strong style="font-size:28px;display:block;margin-top:7px">${b}</strong></div>`;
}

function kpi(icon, colorClass, label, value, sub){
  return `<div class="kpi ${colorClass}"><span class="ico">${icon}</span><span class="val">${value}</span><span class="lbl">${esc(label)}</span>${sub?`<span class="sub">${esc(sub)}</span>`:""}</div>`;
}

let _dashCharts = {};
function _destroyDashCharts(){
  Object.values(_dashCharts).forEach(c => { try{ c.destroy(); }catch(e){} });
  _dashCharts = {};
}

const CHART_PALETTE = {
  teal:"#12979f", navy:"#15426e", amber:"#e8912c", green:"#1f9d55",
  red:"#d64545", purple:"#7c5cd6", blue:"#3d8fd6", slate:"#c9d4e0"
};

// Build a per-employee x per-training compliance matrix from existing tables/logic.
// Mirrors the calculation already used in the Progress module so figures stay consistent.
function _buildComplianceMatrix(employees, activeTrainings, attempts, progresses){
  const now = new Date();
  const getItemStatus = (emp, training) => {
    if(!training) return "MISSING";
    const empUuid = String(emp.id||"").toLowerCase().trim();
    const empCode = String(emp.employee_id||"").toLowerCase().trim();
    const empUser = String(emp.username||"").toLowerCase().trim();
    const tId = String(training.id||"").toLowerCase().trim();
    const tTitle = String(training.title||"").toLowerCase().trim();
    const matchUser = (rec) => {
      if(!rec) return false;
      const uVal = String(rec.user_id||rec.employee_id||rec.username||"").toLowerCase().trim();
      if(!uVal) return false;
      return uVal===empUuid || (empCode!==""&&uVal===empCode) || (empUser!==""&&uVal===empUser);
    };
    const matchTraining = (rec) => {
      if(!rec) return false;
      const recTId = String(rec.training_id||rec.training_title||"").toLowerCase().trim();
      const recRelTitle = String(rec.trainings?.title||"").toLowerCase().trim();
      return (recTId!==""&&recTId===tId) || (tTitle!==""&&recTId===tTitle) || (tTitle!==""&&recRelTitle===tTitle);
    };
    const userAttempts = attempts.filter(a=>matchUser(a)&&matchTraining(a));
    const passedAttempt = userAttempts.find(a=>
      a.passed===true || String(a.passed).toLowerCase()==='true' || a.passed===1 ||
      (a.score!==undefined && a.score!==null && training.passing_marks && Number(a.score)>=Number(training.passing_marks))
    );
    const prog = progresses.find(p=>matchUser(p)&&matchTraining(p));
    const isCompletedProg = prog && (prog.status==='completed' || String(prog.status).toLowerCase()==='completed');
    if(passedAttempt || isCompletedProg){
      let completionDate = null;
      if(passedAttempt && passedAttempt.created_at) completionDate = new Date(passedAttempt.created_at);
      else if(prog && (prog.updated_at||prog.created_at)) completionDate = new Date(prog.updated_at||prog.created_at);
      if(completionDate && !isNaN(completionDate.getTime()) && training.validity){
        const valStr = String(training.validity).toLowerCase().trim();
        const numMatch = valStr.match(/\d+/);
        const num = numMatch ? parseInt(numMatch[0],10) : 1;
        const expiryDate = new Date(completionDate.getTime());
        if(valStr.includes("month")) expiryDate.setMonth(expiryDate.getMonth()+num);
        else if(valStr.includes("day")) expiryDate.setDate(expiryDate.getDate()+num);
        else expiryDate.setFullYear(expiryDate.getFullYear()+num);
        if(now>expiryDate) return "EXPIRED";
      }
      return "COMPLETE";
    }
    return "PENDING";
  };

  let totals = {COMPLETE:0, PENDING:0, EXPIRED:0, MISSING:0};
  const matrixData = employees.map(emp=>{
    let cnt = {COMPLETE:0, PENDING:0, EXPIRED:0, MISSING:0};
    activeTrainings.forEach(t=>{ cnt[getItemStatus(emp,t)]++; });
    const totalReqs = activeTrainings.length;
    const progressPct = totalReqs>0 ? Math.round((cnt.COMPLETE/totalReqs)*100) : 0;
    let overallStatus = "COMPLETE";
    if(totalReqs===0) overallStatus="COMPLETE";
    else if(cnt.EXPIRED>0) overallStatus="EXPIRED";
    else if(cnt.PENDING>0) overallStatus="PENDING";
    else if(cnt.MISSING>0 && cnt.COMPLETE<totalReqs) overallStatus="MISSING";
    totals[overallStatus] = (totals[overallStatus]||0)+1;
    return {department: emp.department||"Unassigned", progressPct, overallStatus};
  });
  return {matrixData, totals};
}

function _gaugeSVG(pct){
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  const color = pct>=90 ? CHART_PALETTE.green : pct>=70 ? CHART_PALETTE.amber : CHART_PALETTE.red;
  const r=70, full=Math.PI*r, dash=(pct/100)*full;
  return `<svg viewBox="0 0 180 100">
    <path d="M10,95 A70,70 0 0 1 170,95" fill="none" stroke="#e1e8f0" stroke-width="16" stroke-linecap="round"/>
    <path d="M10,95 A70,70 0 0 1 170,95" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(1)} ${full.toFixed(1)}"/>
  </svg>`;
}

function _monthKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function _lastNMonths(n){
  const out=[]; const now=new Date();
  for(let i=n-1;i>=0;i--){ const d=new Date(now.getFullYear(), now.getMonth()-i, 1); out.push({key:_monthKey(d), label:d.toLocaleDateString("en-IN",{month:"short"})}); }
  return out;
}

function _renderHeatmap(attempts){
  const days = 84; // 12 weeks
  const now = new Date(); now.setHours(0,0,0,0);
  const counts = {};
  attempts.forEach(a=>{
    if(!a.created_at) return;
    const d = new Date(a.created_at); d.setHours(0,0,0,0);
    const diff = Math.round((now-d)/86400000);
    if(diff>=0 && diff<days){
      const key = d.toISOString().slice(0,10);
      counts[key] = (counts[key]||0)+1;
    }
  });
  let max = 1;
  Object.values(counts).forEach(v=>{ if(v>max) max=v; });
  const cells = [];
  for(let i=days-1;i>=0;i--){
    const d = new Date(now.getTime()-i*86400000);
    const key = d.toISOString().slice(0,10);
    const c = counts[key]||0;
    let lvl = 0;
    if(c>0){ const ratio=c/max; lvl = ratio>0.75?4 : ratio>0.5?3 : ratio>0.25?2 : 1; }
    cells.push(`<i data-lvl="${lvl}" title="${key} · ${c} activity"></i>`);
  }
  const hasActivity = Object.keys(counts).length>0;
  if(!hasActivity){
    return `<div class="chart-empty">No assessment activity recorded yet.</div>`;
  }
  return `<div class="heatmap-scroll"><div class="heatmap">${cells.join("")}</div></div>
    <div class="heatmap-legend">Less <i data-lvl="0" style="background:#eef2f7"></i><i data-lvl="1" style="background:#bfe9df"></i><i data-lvl="2" style="background:#7ed0c2"></i><i data-lvl="3" style="background:#3bb0a3"></i><i data-lvl="4" style="background:#0e7c86"></i> More</div>`;
}

async function dash(){
  if(profile.role==="admin"){
    const [uRes, tRes, attRes, progRes] = await Promise.all([
      sb.from("profiles").select("*").eq("role","user"),
      sb.from("trainings").select("*"),
      sb.from("assessment_attempts").select("*"),
      sb.from("training_progress").select("*")
    ]);

    const employees = uRes.data || [];
    const allTrainings = tRes.data || [];
    const attempts = attRes.data || [];
    const progresses = progRes.data || [];
    const activeTrainings = allTrainings.filter(t=>t.archived!==true);
    const publishedTrainings = allTrainings.filter(t=>t.published && !t.archived);

    // Completed count — same fallback logic previously used on this dashboard
    let completedCount = progresses.filter(p=>p.status==="completed").length;
    if(completedCount===0){
      const uniqueSet = new Set(attempts.filter(a=>a.passed===true).map(x=>`${x.user_id}_${x.training_id}`));
      completedCount = uniqueSet.size;
    }

    const {matrixData, totals} = _buildComplianceMatrix(employees, activeTrainings, attempts, progresses);
    const overallCompliancePct = employees.length>0 ? Math.round((totals.COMPLETE/employees.length)*100) : 0;

    // Department-wise compliance (average progress % per department)
    const deptMap = {};
    matrixData.forEach(m=>{
      if(!deptMap[m.department]) deptMap[m.department] = {sum:0, n:0};
      deptMap[m.department].sum += m.progressPct;
      deptMap[m.department].n += 1;
    });
    const deptLabels = Object.keys(deptMap).sort();
    const deptValues = deptLabels.map(d=>Math.round(deptMap[d].sum/deptMap[d].n));

    // Certificate status — derived from actual assessment attempts per user/training
    let certCertified=0, certFailed=0, certNotAttempted=0;
    const requiredTrainings = publishedTrainings.filter(t=>t.assessment_required);
    if(requiredTrainings.length>0 && employees.length>0){
      employees.forEach(emp=>{
        requiredTrainings.forEach(t=>{
          const uVal = (r)=>String(r.user_id||"").toLowerCase().trim();
          const empId = String(emp.id||"").toLowerCase().trim();
          const userAtt = attempts.filter(a=>uVal(a)===empId && String(a.training_id)===String(t.id));
          if(userAtt.length===0) certNotAttempted++;
          else if(userAtt.some(a=>a.passed===true)) certCertified++;
          else certFailed++;
        });
      });
    }

    // Monthly training completion trend (last 6 months, based on passed attempts)
    const months = _lastNMonths(6);
    const monthlyCompletions = months.map(m=>
      attempts.filter(a=>a.passed===true && a.created_at && _monthKey(new Date(a.created_at))===m.key).length
    );

    // Assessment score trend (average score per month, last 6 months)
    const monthlyScores = months.map(m=>{
      const inMonth = attempts.filter(a=>a.created_at && _monthKey(new Date(a.created_at))===m.key && a.score!==null && a.score!==undefined);
      if(inMonth.length===0) return null;
      return Math.round(inMonth.reduce((s,a)=>s+Number(a.score||0),0)/inMonth.length);
    });
    const hasScoreData = monthlyScores.some(v=>v!==null);

    const html = `
      <div class="kpi-grid">
        ${kpi("👥","c1","Total Employees",employees.length)}
        ${kpi("📚","c6","Active Trainings",activeTrainings.length,`${publishedTrainings.length} published`)}
        ${kpi("✅","c3","Completed",completedCount)}
        ${kpi("📝","c2","Assessments Taken",attempts.length)}
        ${kpi("🎓","c5","Certificates Issued",certCertified)}
        ${kpi("📊","c4","Overall Compliance",overallCompliancePct+"%")}
      </div>

      <div class="chart-row cols-2" style="margin-top:22px">
        <div class="chart-card">
          <h4>📈 Monthly Training Completion</h4>
          <span class="chart-sub">Passed assessments by month · last 6 months</span>
          <div class="chart-box"><canvas id="chLine"></canvas></div>
        </div>
        <div class="chart-card">
          <h4>🟢 Compliance Overview</h4>
          <span class="chart-sub">Employee status across active trainings</span>
          <div class="chart-box short"><canvas id="chPie"></canvas></div>
        </div>
      </div>

      <div class="chart-row cols-2">
        <div class="chart-card">
          <h4>🏭 Department-wise Compliance</h4>
          <span class="chart-sub">Average completion % by department</span>
          <div class="chart-box">${deptLabels.length?'<canvas id="chBar"></canvas>':'<div class="chart-empty">No department data available yet.</div>'}</div>
        </div>
        <div class="chart-card">
          <div class="gauge-wrap">
            <h4 style="align-self:flex-start">🎯 Overall Compliance</h4>
            <span class="chart-sub" style="align-self:flex-start">Employees fully compliant vs total workforce</span>
            <div class="gauge">${_gaugeSVG(overallCompliancePct)}<div class="gauge-val"><span class="n">${overallCompliancePct}%</span><span class="l">Compliant</span></div></div>
            <div class="gauge-legend"><span><i style="background:${CHART_PALETTE.green}"></i>≥90%</span><span><i style="background:${CHART_PALETTE.amber}"></i>70–89%</span><span><i style="background:${CHART_PALETTE.red}"></i>&lt;70%</span></div>
          </div>
        </div>
      </div>

      <div class="chart-row cols-2">
        <div class="chart-card">
          <h4>📉 Assessment Score Trend</h4>
          <span class="chart-sub">Average score by month · last 6 months</span>
          <div class="chart-box">${hasScoreData?'<canvas id="chArea"></canvas>':'<div class="chart-empty">No assessment score data available yet.</div>'}</div>
        </div>
        <div class="chart-card">
          <h4>🎓 Certificate Status</h4>
          <span class="chart-sub">Across published trainings requiring assessment</span>
          <div class="chart-box short">${requiredTrainings.length?'<canvas id="chDonut"></canvas>':'<div class="chart-empty">No assessment-required trainings published yet.</div>'}</div>
        </div>
      </div>

      <div class="chart-row cols-1" style="grid-template-columns:1fr">
        <div class="chart-card">
          <h4>🗓️ Training Activity Calendar</h4>
          <span class="chart-sub">Assessment attempts per day · last 12 weeks</span>
          ${_renderHeatmap(attempts)}
        </div>
      </div>

      <div class="card" style="margin-top:16px"><h3>Welcome</h3><p class="muted">Use Users Management to add, import, edit or delete portal employees.</p></div>
    `;

    layout("dash","Admin Dashboard", html);
    _destroyDashCharts();

    if(window.Chart){
      Chart.defaults.font.family = "Inter, system-ui, sans-serif";
      Chart.defaults.color = "#64748b";

      const lineEl = $("chLine");
      if(lineEl) _dashCharts.line = new Chart(lineEl, {
        type:"line",
        data:{ labels: months.map(m=>m.label), datasets:[{
          label:"Completions", data: monthlyCompletions, borderColor: CHART_PALETTE.teal,
          backgroundColor:"rgba(18,151,159,.12)", fill:true, tension:.35, pointRadius:3,
          pointBackgroundColor: CHART_PALETTE.teal
        }]},
        options:{ plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true, ticks:{precision:0}, grid:{color:"#eef2f7"}}, x:{grid:{display:false}} }, maintainAspectRatio:false }
      });

      const pieEl = $("chPie");
      if(pieEl) _dashCharts.pie = new Chart(pieEl, {
        type:"pie",
        data:{ labels:["Completed","Pending","Expired"], datasets:[{
          data:[totals.COMPLETE, totals.PENDING+totals.MISSING, totals.EXPIRED],
          backgroundColor:[CHART_PALETTE.green, CHART_PALETTE.amber, CHART_PALETTE.red],
          borderWidth:2, borderColor:"#fff"
        }]},
        options:{ plugins:{legend:{position:"bottom", labels:{boxWidth:10, padding:14, font:{size:11}}}}, maintainAspectRatio:false }
      });

      const barEl = $("chBar");
      if(barEl) _dashCharts.bar = new Chart(barEl, {
        type:"bar",
        data:{ labels: deptLabels, datasets:[{
          label:"Compliance %", data: deptValues, backgroundColor: CHART_PALETTE.navy, borderRadius:6, maxBarThickness:38
        }]},
        options:{ plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true, max:100, grid:{color:"#eef2f7"}}, x:{grid:{display:false}} }, maintainAspectRatio:false }
      });

      const areaEl = $("chArea");
      if(areaEl) _dashCharts.area = new Chart(areaEl, {
        type:"line",
        data:{ labels: months.map(m=>m.label), datasets:[{
          label:"Avg Score", data: monthlyScores, borderColor: CHART_PALETTE.purple,
          backgroundColor:"rgba(124,92,214,.15)", fill:true, tension:.35, spanGaps:true, pointRadius:3,
          pointBackgroundColor: CHART_PALETTE.purple
        }]},
        options:{ plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true, max:100, grid:{color:"#eef2f7"}}, x:{grid:{display:false}} }, maintainAspectRatio:false }
      });

      const donutEl = $("chDonut");
      if(donutEl) _dashCharts.donut = new Chart(donutEl, {
        type:"doughnut",
        data:{ labels:["Certified","Failed","Not Attempted"], datasets:[{
          data:[certCertified, certFailed, certNotAttempted],
          backgroundColor:[CHART_PALETTE.green, CHART_PALETTE.red, CHART_PALETTE.slate],
          borderWidth:2, borderColor:"#fff"
        }]},
        options:{ cutout:"62%", plugins:{legend:{position:"bottom", labels:{boxWidth:10, padding:14, font:{size:11}}}}, maintainAspectRatio:false }
      });
    }
  } else {
    const [p, a, passedAtt] = await Promise.all([
      sb.from("training_progress").select("*",{count:"exact",head:true}).eq("user_id",profile.id).eq("status","completed"),
      sb.from("assessment_attempts").select("*",{count:"exact",head:true}).eq("user_id",profile.id),
      sb.from("assessment_attempts").select("*",{count:"exact",head:true}).eq("user_id",profile.id).eq("passed",true)
    ]);

    let userCompleted = p.count || 0;
    if(userCompleted === 0 && (passedAtt.count || 0) > 0){
      userCompleted = passedAtt.count;
    }

    layout("dash","Welcome, "+esc(profile.name),`<div class="kpi-grid">${kpi("✅","c3","Completed",userCompleted)}${kpi("📝","c2","Assessments",a.count||0)}</div>`);
  }
}

// --- USERS MANAGEMENT MODULE ---

let usersModuleCache = null;
let usersCurrentPage = 1;
const USERS_PAGE_SIZE = 10;
let usersSortCol = "name";
let usersSortDir = "asc";

async function users(){
  let r = await sb.from("profiles").select("*").eq("role","user").order("created_at",{ascending:false});
  const usersList = r.data || [];

  const departments = [...new Set(usersList.map(u => u.department).filter(Boolean))].sort();
  const companies = [...new Set(usersList.map(u => u.company).filter(Boolean))].sort();

  const totalUsers = usersList.length;
  const activeCount = usersList.filter(u => u.active !== false).length;
  const inactiveCount = usersList.filter(u => u.active === false).length;

  usersModuleCache = {
    allUsers: usersList,
    departments: departments,
    companies: companies,
    summary: { total: totalUsers, active: activeCount, inactive: inactiveCount }
  };
  usersCurrentPage = 1;

  layout("users","Users Management",`
    <div class="grid" style="margin-bottom:20px">
      ${metric("Total Users", usersModuleCache.summary.total)}
      ${metric("Active Users", usersModuleCache.summary.active)}
      ${metric("Inactive Users", usersModuleCache.summary.inactive)}
    </div>

    <div class="actions">
      <button class="btn blue" onclick="addUserForm()">➕ Add Manual User</button>
      <button class="btn light" onclick="importExcelModal()">📥 Import Employees from Excel</button>
      <button class="btn light" onclick="exportUsersToExcel()">📤 Export User Details</button>
    </div>

    <div class="card" style="margin-top:16px;margin-bottom:16px;padding:16px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;align-items:end">
        <div>
          <label style="font-size:12px;font-weight:bold">Search</label>
          <input id="userSearchInput" placeholder="Name, Emp ID, Dept, Desig..." oninput="renderUsersTable(1)" style="width:100%;margin:4px 0 0">
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Department</label>
          <select id="userFilterDept" onchange="renderUsersTable(1)" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Departments</option>
            ${departments.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Company</label>
          <select id="userFilterComp" onchange="renderUsersTable(1)" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Companies</option>
            ${companies.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Status</label>
          <select id="userFilterStatus" onchange="renderUsersTable(1)" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px">
      <div id="usersTableContent"></div>
      <div id="usersPaginationContent" style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:8px"></div>
    </div>
  `);

  renderUsersTable(1);
}

function handleUsersSort(colKey) {
  if (usersSortCol === colKey) {
    usersSortDir = usersSortDir === "asc" ? "desc" : "asc";
  } else {
    usersSortCol = colKey;
    usersSortDir = "asc";
  }
  renderUsersTable(usersCurrentPage);
}

function renderUsersTable(page = 1) {
  if (!usersModuleCache) return;
  usersCurrentPage = page;

  const searchQ = ($("userSearchInput")?.value || "").toLowerCase().trim();
  const deptF = $("userFilterDept")?.value || "ALL";
  const compF = $("userFilterComp")?.value || "ALL";
  const statusF = $("userFilterStatus")?.value || "ALL";

  let filtered = usersModuleCache.allUsers.filter(u => {
    if (deptF !== "ALL" && String(u.department || "") !== deptF) return false;
    if (compF !== "ALL" && String(u.company || "") !== compF) return false;
    
    const isActive = u.active !== false;
    if (statusF === "ACTIVE" && !isActive) return false;
    if (statusF === "INACTIVE" && isActive) return false;

    if (searchQ) {
      const haystack = `${u.name || ""} ${u.employee_id || ""} ${u.department || ""} ${u.designation || ""} ${u.company || ""}`.toLowerCase();
      if (!haystack.includes(searchQ)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    let valA = "", valB = "";
    if (usersSortCol === "name") { valA = a.name || ""; valB = b.name || ""; }
    else if (usersSortCol === "employee_id") { valA = a.employee_id || ""; valB = b.employee_id || ""; }
    else if (usersSortCol === "department") { valA = a.department || ""; valB = b.department || ""; }
    else if (usersSortCol === "company") { valA = a.company || ""; valB = b.company || ""; }
    else if (usersSortCol === "status") { valA = a.active !== false ? "Active" : "Inactive"; valB = b.active !== false ? "Active" : "Inactive"; }

    let cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
    return usersSortDir === "asc" ? cmp : -cmp;
  });

  const totalFiltered = filtered.length;
  const totalPages = Math.ceil(totalFiltered / USERS_PAGE_SIZE) || 1;
  if (usersCurrentPage > totalPages) usersCurrentPage = totalPages;

  const startIndex = (usersCurrentPage - 1) * USERS_PAGE_SIZE;
  const pageUsers = filtered.slice(startIndex, startIndex + USERS_PAGE_SIZE);

  const container = $("usersTableContent");
  const paginationContainer = $("usersPaginationContent");

  if (totalFiltered === 0) {
    container.innerHTML = `<div class="card empty" style="text-align:center;padding:30px">No matching employees found.</div>`;
    paginationContainer.innerHTML = "";
    return;
  }

  const getSortIcon = (colKey) => {
    if (usersSortCol !== colKey) return "↕";
    return usersSortDir === "asc" ? "↑" : "↓";
  };

  container.innerHTML = `
    <div class="tablewrap" style="overflow-x:auto">
      <table class="table">
        <thead>
          <tr>
            <th style="cursor:pointer;white-space:nowrap" onclick="handleUsersSort('name')">Name ${getSortIcon('name')}</th>
            <th style="cursor:pointer;white-space:nowrap" onclick="handleUsersSort('employee_id')">Employee ID ${getSortIcon('employee_id')}</th>
            <th style="cursor:pointer;white-space:nowrap" onclick="handleUsersSort('department')">Department ${getSortIcon('department')}</th>
            <th style="white-space:nowrap">Designation</th>
            <th style="cursor:pointer;white-space:nowrap" onclick="handleUsersSort('company')">Company ${getSortIcon('company')}</th>
            <th style="cursor:pointer;white-space:nowrap" onclick="handleUsersSort('status')">Status ${getSortIcon('status')}</th>
            <th style="white-space:nowrap;text-align:center">Action</th>
          </tr>
        </thead>
        <tbody>
          ${pageUsers.map(u => `
            <tr>
              <td><b>${esc(u.name)}</b></td>
              <td>${esc(u.employee_id || "-")}</td>
              <td>${esc(u.department || "-")}</td>
              <td>${esc(u.designation || "-")}</td>
              <td>${esc(u.company || "-")}</td>
              <td><span class="badge ${u.active===false?"o":"g"}">${u.active===false?"🟠 Inactive":"🟢 Active"}</span></td>
              <td style="white-space:nowrap;text-align:center">
                <button class="btn light" onclick="editUser('${u.id}')">Edit</button>
                <button class="btn light" style="color:#ed6c02" onclick="adminResetPassword('${u.id}', '${esc(u.name)}')">Reset Pass</button>
                <button class="btn light" style="color:#d32f2f" onclick="confirmDeleteUser('${u.id}', '${esc(u.name)}', '${esc(u.employee_id)}')">Delete</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  paginationContainer.innerHTML = `
    <span class="muted" style="font-size:13px">Showing <b>${startIndex + 1}</b> - <b>${Math.min(startIndex + USERS_PAGE_SIZE, totalFiltered)}</b> of <b>${totalFiltered}</b> employees</span>
    <div style="display:flex;gap:6px">
      <button class="btn light" ${usersCurrentPage === 1 ? 'disabled style="opacity:0.5"' : ''} onclick="renderUsersTable(${usersCurrentPage - 1})">Previous</button>
      <span class="chip" style="align-self:center">${usersCurrentPage} / ${totalPages}</span>
      <button class="btn light" ${usersCurrentPage === totalPages ? 'disabled style="opacity:0.5"' : ''} onclick="renderUsersTable(${usersCurrentPage + 1})">Next</button>
    </div>
  `;
}

function adminResetPassword(userId, userName) {
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:450px">
        <h2>Reset Password</h2>
        <p>Are you sure you want to reset password for <b>${esc(userName)}</b>?</p>
        <p class="muted" style="font-size:13px;margin-top:8px">This will set the employee's password back to the default temporary password (<b>TSL@1234</b>). Current passwords are secure and cannot be viewed.</p>
        <div class="actions" style="justify-content:flex-end;margin-top:16px">
          <button class="btn light" onclick="closeModal()">Cancel</button>
          <button class="btn blue" onclick="executeAdminResetPassword('${userId}')">Confirm Reset</button>
        </div>
      </div>
    </div>
  `);
}

async function executeAdminResetPassword(userId) {
  let s = (await sb.auth.getSession()).data.session;
  if(!s) return alert("Session expired. Please login again.");

  let r = await fetch(`${window.SUPABASE_URL}/functions/v1/admin-create-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + s.access_token,
      "apikey": window.SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ target_user_id: userId, reset_password: "TSL@1234" })
  });

  let d = await r.json().catch(()=>({}));
  closeModal();

  if(!r.ok && !d.success) {
    alert(d.error || d.message || "Failed to reset password via Admin API.");
  } else {
    alert("Password reset successfully. Temporary password set to TSL@1234.");
  }
}

function changeMyPasswordModal() {
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:450px">
        <h2>Change Password</h2>
        <div style="margin-top:12px">
          <label>Current Password *</label>
          <input type="password" id="myCurrPass" style="width:100%;margin-bottom:12px">
          <label>New Password *</label>
          <input type="password" id="myNewPass" style="width:100%;margin-bottom:12px">
          <label>Confirm New Password *</label>
          <input type="password" id="myConfirmPass" style="width:100%;margin-bottom:12px">
        </div>
        <div class="actions" style="justify-content:flex-end;margin-top:16px">
          <button class="btn light" onclick="closeModal()">Cancel</button>
          <button class="btn blue" onclick="executeChangeMyPassword()">Update Password</button>
        </div>
      </div>
    </div>
  `);
}

async function executeChangeMyPassword() {
  const currPass = $("myCurrPass")?.value;
  const newPass = $("myNewPass")?.value;
  const confirmPass = $("myConfirmPass")?.value;

  if (!currPass || !newPass || !confirmPass) {
    return alert("All password fields are required.");
  }

  if (newPass !== confirmPass) {
    return alert("New Password and Confirm New Password do not match.");
  }

  if (newPass.length < 6) {
    return alert("Password must be at least 6 characters long.");
  }

  const verifyRes = await sb.auth.signInWithPassword({
    email: profile.username || `${String(profile.employee_id).toLowerCase()}@tsl.internal`,
    password: currPass
  });

  if (verifyRes.error) {
    return alert("Current password is incorrect.");
  }

  const updateRes = await sb.auth.updateUser({ password: newPass });

  if (updateRes.error) {
    return alert("Password update failed: " + updateRes.error.message);
  }

  closeModal();
  alert("Password changed successfully!");
}

function addUserForm(){
  document.body.insertAdjacentHTML("beforeend",`
    <div class=modalbg id=modal>
      <div class=modal>
        <h2>Add Manual User</h2>
        <div class=formgrid>
          <div><label>Employee ID *</label><input id=uid placeholder="e.g. EMP001"></div>
          <div><label>Name *</label><input id=un placeholder="Full Name"></div>
          <div><label>Username / Email</label><input id=ue placeholder="Optional email"></div>
          <div><label>Password *</label><input id=up type=password value="TSL@1234"></div>
          <div><label>Department</label><input id=ud placeholder="Electrical"></div>
          <div><label>Designation</label><input id=udes placeholder="Engineer"></div>
          <div class=fullfield><label>Company</label><input id=uc value="Talwandi Sabo Thermal Plant"></div>
          <div>
            <label>Status</label>
            <select id=ustatus>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>
        <div class=actions style="margin-top:15px">
          <button class="btn blue" onclick=createUser()>Create User</button>
          <button class="btn light" onclick=closeModal()>Cancel</button>
        </div>
      </div>
    </div>
  `);
}

async function createUser(){
  let s = (await sb.auth.getSession()).data.session;
  if(!s) return alert("Please login again.");

  let empId = $("uid").value.trim();
  let name = $("un").value.trim();
  let username = $("ue").value.trim();
  let password = $("up").value;

  if(!empId || !name || !password){
    return alert("Employee ID, Name and Password are required.");
  }

  if(username && !validateEmail(username)){
    return alert("Please enter a valid email address.");
  }

  let payload = {
    employee_id: empId,
    name: name,
    username: username || `${empId.toLowerCase()}@tsl.internal`,
    password: password,
    department: $("ud").value.trim(),
    designation: $("udes").value.trim(),
    company: $("uc").value.trim(),
    active: $("ustatus").value === "true"
  };

  let r = await fetch(`${window.SUPABASE_URL}/functions/v1/admin-create-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + s.access_token,
      "apikey": window.SUPABASE_ANON_KEY
    },
    body: JSON.stringify(payload)
  });

  let rawText = await r.text().catch(() => "");
  let d = {};
  try { d = JSON.parse(rawText); } catch(e) {}

  if(!r.ok) {
    let mainErr = d.error || `HTTP ${r.status}: ${r.statusText}`;
    let detailErr = d.details || d.message || rawText;
    let formattedMsg = mainErr;
    if(detailErr && detailErr !== mainErr) {
      formattedMsg += ` - ${typeof detailErr === 'object' ? JSON.stringify(detailErr) : detailErr}`;
    }
    return alert("Could not create user: " + formattedMsg);
  }

  closeModal();
  alert("User created successfully.");
  route("users");
}

async function editUser(id){
  let r = await sb.from("profiles").select("*").eq("id",id).single();
  if(r.error) return alert(r.error.message);
  let u = r.data;

  document.body.insertAdjacentHTML("beforeend",`
    <div class=modalbg id=modal>
      <div class=modal>
        <h2>Edit Employee</h2>
        <div class=formgrid>
          <div><label>Employee ID *</label><input id=eid value="${esc(u.employee_id||"")}"></div>
          <div><label>Name *</label><input id=en value="${esc(u.name||"")}"></div>
          <div><label>Department</label><input id=ed value="${esc(u.department||"")}"></div>
          <div><label>Designation</label><input id=edes value="${esc(u.designation||"")}"></div>
          <div><label>Company</label><input id=ec value="${esc(u.company||"")}"></div>
          <div>
            <label>Status</label>
            <select id=ea>
              <option value="true" ${u.active!==false?"selected":""}>Active</option>
              <option value="false" ${u.active===false?"selected":""}>Inactive</option>
            </select>
          </div>
        </div>
        <div class=actions style="margin-top:15px">
          <button class="btn blue" onclick="saveUser('${id}')">Save Changes</button>
          <button class="btn light" onclick=closeModal()>Cancel</button>
        </div>
      </div>
    </div>
  `);
}

async function saveUser(id){
  let payload = {
    employee_id: $("eid").value.trim(),
    name: $("en").value.trim(),
    department: $("ed").value.trim(),
    designation: $("edes").value.trim(),
    company: $("ec").value.trim(),
    active: $("ea").value === "true"
  };

  if(!payload.employee_id || !payload.name){
    return alert("Employee ID and Name are required.");
  }

  let r = await sb.from("profiles").update(payload).eq("id", id);
  if(r.error){
    alert("Update failed: " + r.error.message);
  } else {
    closeModal();
    alert("Employee updated successfully.");
    route("users");
  }
}

function confirmDeleteUser(id, name, empId){
  document.body.insertAdjacentHTML("beforeend",`
    <div class=modalbg id=modal>
      <div class=modal style="max-width:450px">
        <h2>Confirm Delete</h2>
        <p>Are you sure you want to delete this employee?</p>
        <div class="card" style="margin:12px 0;background:#f9f9f9">
          <p><b>Employee:</b> ${esc(name)}</p>
          <p><b>Employee ID:</b> ${esc(empId||"-")}</p>
        </div>
        <div class=actions style="justify-content:flex-end">
          <button class="btn light" onclick="closeModal()">Cancel</button>
          <button class="btn red" style="background:#d32f2f;color:#fff" onclick="executeDeleteUser('${id}')">Delete</button>
        </div>
      </div>
    </div>
  `);
}

async function executeDeleteUser(id){
  let s = (await sb.auth.getSession()).data.session;
  if(!s) return alert("Session expired. Please login again.");

  let r = await fetch(`${window.SUPABASE_URL}/functions/v1/admin-delete-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + s.access_token,
      "apikey": window.SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ target_user_id: id })
  });

  let d = await r.json().catch(()=>({}));
  if(!r.ok) return alert(d.error || d.message || "Failed to delete user.");

  closeModal();
  alert("Employee deleted successfully.");
  route("users");
}

// --- EXCEL IMPORT / EXPORT MODULE ---

function importExcelModal(){
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal">
        <h2>📥 Import Employees from Excel</h2>
        <p class="muted">File must use the exact format produced by Export User Details.</p>
        <div style="margin:20px 0">
          <label>Select Excel File</label>
          <input type="file" id="excelfile" accept=".xlsx, .xls, .csv">
        </div>
        <div class="actions">
          <button class="btn blue" onclick="previewExcelImport()">Parse & Preview</button>
          <button class="btn light" onclick="closeModal()">Cancel</button>
        </div>
      </div>
    </div>
  `);
}

async function previewExcelImport(){
  const fileInput = $("excelfile");
  if(!fileInput.files.length) return alert("Please select an Excel file first.");

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if(!rawJson || rawJson.length < 2) return alert("The selected Excel file is empty or missing data rows.");

      const fileHeaders = rawJson[0].map(h => String(h||"").trim());
      
      const missingHeaders = USER_EXCEL_COLUMNS.filter(col => !fileHeaders.includes(col));
      if(missingHeaders.length > 0){
        return alert(`Invalid Excel format. Missing required columns:\n\n${missingHeaders.join(", ")}\n\nPlease use the file generated by 'Export User Details'.`);
      }

      const rows = XLSX.utils.sheet_to_json(worksheet);

      const validRows = rows.filter(r => {
        let empId = cleanExcelVal(r["Employee ID"]);
        let name = cleanExcelVal(r["Name"]);
        let email = cleanExcelVal(r["Username/Email"]);
        return empId !== "" || name !== "" || email !== "";
      });

      if(!validRows.length) return alert("No valid employee rows found in the Excel file.");

      pendingImportRows = validRows;
      closeModal();

      let previewRowsHtml = validRows.slice(0, 10).map((r, i) => `
        <tr>
          <td>${i + 2}</td>
          <td>${esc(cleanExcelVal(r["Employee ID"]))}</td>
          <td>${esc(cleanExcelVal(r["Name"]))}</td>
          <td>${esc(cleanExcelVal(r["Username/Email"]) || "-")}</td>
          <td>${esc(cleanExcelVal(r["Department"]) || "-")}</td>
          <td>${esc(cleanExcelVal(r["Designation"]) || "-")}</td>
          <td>${esc(cleanExcelVal(r["Company"]) || "-")}</td>
          <td>${esc(cleanExcelVal(r["Status"]) || "Active")}</td>
        </tr>
      `).join("");

      document.body.insertAdjacentHTML("beforeend", `
        <div class="modalbg" id="modal">
          <div class="modal" style="max-width:900px">
            <h2>Employee Import Preview</h2>
            <p class="muted">Total Rows Detected: <b>${rows.length}</b> (Showing first 10 rows preview)</p>
            <div class="tablewrap" style="max-height:300px;overflow-y:auto;margin:15px 0">
              <table class="table">
                <tr><th>Row</th><th>Emp ID</th><th>Name</th><th>Email</th><th>Dept</th><th>Desig</th><th>Company</th><th>Status</th></tr>
                ${previewRowsHtml}
              </table>
            </div>
            <div class="actions">
              <button class="btn blue" onclick="executeExcelImport()">Confirm & Process Import</button>
              <button class="btn light" onclick="closeModal()">Cancel</button>
            </div>
          </div>
        </div>
      `);

    } catch(err) {
      alert("Error reading Excel file: " + err.message);
    }
  };

  reader.readAsArrayBuffer(file);
}

async function executeExcelImport(){
  if(!pendingImportRows.length) return alert("No data to import.");

  let totalRows = pendingImportRows.length;
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let invalidEmailCount = 0;
  let duplicateEmailCount = 0;
  let failedCount = 0;

  let rowDetails = [];

  let s = (await sb.auth.getSession()).data.session;
  if(!s) return alert("Session expired. Please login again.");

  let existingRes = await sb.from("profiles").select("id, employee_id, username");
  let existingEmpMap = {};
  let existingEmailMap = {};

  if(existingRes.data){
    existingRes.data.forEach(p => {
      if(p.employee_id) existingEmpMap[cleanExcelVal(p.employee_id).toLowerCase()] = p.id;
      if(p.username) existingEmailMap[cleanExcelVal(p.username).toLowerCase()] = p.id;
    });
  }

  const processedEmpIds = new Set();
  const processedEmails = new Set();

  for (let idx = 0; idx < pendingImportRows.length; idx++) {
    let rowNum = idx + 2;
    let row = pendingImportRows[idx];

    try {
      let empId = cleanExcelVal(row["Employee ID"]);
      let name = cleanExcelVal(row["Name"]);
      let dept = cleanExcelVal(row["Department"]);
      let desig = cleanExcelVal(row["Designation"]);
      let comp = cleanExcelVal(row["Company"]) || "Talwandi Sabo Thermal Plant";
      let statusStr = cleanExcelVal(row["Status"]).toLowerCase();
      let emailVal = cleanExcelVal(row["Username/Email"]);

      if(!empId && !name && !emailVal) {
        continue;
      }

      let active = statusStr !== "inactive" && statusStr !== "false";

      if(!empId || !name){
        skippedCount++;
        rowDetails.push(`Row ${rowNum} (${empId || 'No ID'}): Missing required Employee ID or Name.`);
        continue;
      }

      let empKey = empId.toLowerCase();
      let emailKey = emailVal.toLowerCase();

      if(emailVal && !validateEmail(emailVal)){
        invalidEmailCount++;
        failedCount++;
        rowDetails.push(`Row ${rowNum} (${empId}): Invalid email format '${emailVal}'.`);
        continue;
      }

      if(processedEmpIds.has(empKey)){
        skippedCount++;
        rowDetails.push(`Row ${rowNum} (${empId}): Duplicate Employee ID in uploaded file - skipped.`);
        continue;
      }
      if(emailKey && processedEmails.has(emailKey)){
        duplicateEmailCount++;
        skippedCount++;
        rowDetails.push(`Row ${rowNum} (${empId}): Duplicate Email '${emailVal}' in uploaded file - skipped.`);
        continue;
      }

      processedEmpIds.add(empKey);
      if(emailKey) processedEmails.add(emailKey);

      let targetEmail = emailVal ? emailVal : `${empKey}@tsl.internal`;
      let existingId = existingEmpMap[empKey] || (emailKey ? existingEmailMap[emailKey] : null);

      if(existingId){
        let up = await sb.from("profiles").update({
          name: name,
          department: dept,
          designation: desig,
          company: comp,
          active: active,
          username: targetEmail
        }).eq("id", existingId);

        if(up.error){
          failedCount++;
          let dbErr = up.error.details || up.error.message || JSON.stringify(up.error);
          rowDetails.push(`Row ${rowNum} (${empId}): Profile update failed - ${dbErr}`);
        } else {
          updatedCount++;
          rowDetails.push(`Row ${rowNum} (${empId}): Existing user updated successfully.`);
        }
      } else {
        let res = await fetch(`${window.SUPABASE_URL}/functions/v1/admin-create-user`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + s.access_token,
            "apikey": window.SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            employee_id: empId,
            name: name,
            username: targetEmail,
            password: "TSL@1234",
            department: dept,
            designation: desig,
            company: comp,
            active: active
          })
        });

        let rawText = await res.text().catch(() => "");
        let resData = {};
        try { resData = JSON.parse(rawText); } catch(e) {}

        if(res.ok && resData.success){
          addedCount++;
          rowDetails.push(`Row ${rowNum} (${empId}): User created successfully.`);
        } else {
          let mainErr = resData.error || `HTTP ${res.status}: ${res.statusText}`;
          let detailErr = resData.details || resData.message || resData.hint || rawText;

          let formattedMsg = mainErr;
          if(detailErr && detailErr !== mainErr) {
            formattedMsg += ` - ${typeof detailErr === 'object' ? JSON.stringify(detailErr) : detailErr}`;
          }

          failedCount++;
          rowDetails.push(`Row ${rowNum} (${empId}): ${formattedMsg}`);
        }
      }

    } catch(err) {
      failedCount++;
      rowDetails.push(`Row ${rowNum}: Exception - ${err.message || err}`);
    }
  }

  closeModal();
  pendingImportRows = [];

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:600px">
        <h2>Import Completed</h2>
        <div class="card" style="text-align:left;margin:15px 0">
          <p><b>Total Rows:</b> ${totalRows}</p>
          <p style="color:#2e7d32"><b>Successfully Added:</b> ${addedCount}</p>
          <p style="color:#0288d1"><b>Updated Existing:</b> ${updatedCount}</p>
          <p style="color:#ed6c02"><b>Duplicate / Skipped:</b> ${skippedCount}</p>
          ${invalidEmailCount > 0 ? `<p style="color:#ed6c02"><b>Invalid Email:</b> ${invalidEmailCount}</p>` : ''}
          ${duplicateEmailCount > 0 ? `<p style="color:#ed6c02"><b>Duplicate Email:</b> ${duplicateEmailCount}</p>` : ''}
          <p style="color:#d32f2f"><b>Failed:</b> ${failedCount}</p>
        </div>
        
        <details style="text-align:left;margin-bottom:15px">
          <summary style="cursor:pointer;font-weight:bold;margin-bottom:8px">View Row-Level Details (${rowDetails.length})</summary>
          <div style="max-height:180px;overflow-y:auto;background:#f8f9fa;padding:10px;border-radius:6px;font-size:13px">
            <ul style="margin:0;padding-left:18px">
              ${rowDetails.map(d => `<li>${esc(d)}</li>`).join("")}
            </ul>
          </div>
        </details>

        <button class="btn blue full" onclick="closeModal();route('users')">OK</button>
      </div>
    </div>
  `);
}

async function exportUsersToExcel(){
  try {
    if (typeof XLSX === "undefined") {
      return alert("XLSX library is not loaded. Please ensure index.html includes the SheetJS script.");
    }

    const r = await sb.from("profiles").select("*").eq("role","user").order("created_at",{ascending:false});
    if(r.error) return alert("Export error: " + r.error.message);

    const users = r.data || [];
    let exportData = [];

    if(users.length > 0){
      exportData = users.map(u => ({
        "Employee ID": cleanExcelVal(u.employee_id),
        "Name": u.name || "",
        "Department": u.department || "",
        "Designation": u.designation || "",
        "Company": u.company || "",
        "Status": u.active !== false ? "Active" : "Inactive",
        "Username/Email": u.username || ""
      }));
    } else {
      exportData = [{
        "Employee ID": "EMP001",
        "Name": "Sample Employee",
        "Department": "Electrical",
        "Designation": "Engineer",
        "Company": "Talwandi Sabo Thermal Plant",
        "Status": "Active",
        "Username/Email": "emp001@tsl.internal"
      }];
    }

    const worksheet = XLSX.utils.json_to_sheet(exportData, { header: USER_EXCEL_COLUMNS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");
    XLSX.writeFile(workbook, `STLP_Employee_Master_${Date.now()}.xlsx`);
  } catch (err) {
    alert("Export failed: " + err.message);
  }
}

// --- TRAINING MANAGER MODULE ---

let myTrainingsCache = null;
let userTrainingFilterKey = "ALL";
let adminTrainingDetailsCache = null;
let adminTrainingUserFilter = "ALL";

function confirmDeleteTraining(id, title) {
  if (profile.role !== "admin") return alert("Unauthorized action.");

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:450px">
        <h2>Delete Training?</h2>
        <p>Are you sure you want to permanently delete:</p>
        <p style="font-size:16px;font-weight:bold;margin:12px 0;color:#1f4d3a">"${esc(title)}"?</p>
        <p class="muted" style="font-size:13px">This action cannot be undone.</p>
        <div class="actions" style="justify-content:flex-end;margin-top:18px">
          <button class="btn light" onclick="closeModal()">Cancel</button>
          <button class="btn red" style="background:#d32f2f;color:#fff" onclick="executeDeleteTraining('${id}')">Delete Permanently</button>
        </div>
      </div>
    </div>
  `);
}

async function executeDeleteTraining(id) {
  if (profile.role !== "admin") return alert("Unauthorized action.");

  closeModal();

  try {
    // 1. Linked Records Check (training_progress & assessment_attempts)
    const [progCheck, attCheck] = await Promise.all([
      sb.from("training_progress").select("id", { count: "exact", head: true }).eq("training_id", id),
      sb.from("assessment_attempts").select("id", { count: "exact", head: true }).eq("training_id", id)
    ]);

    if (progCheck.error) console.error("Progress check error:", progCheck.error);
    if (attCheck.error) console.error("Attempts check error:", attCheck.error);

    const hasProgress = (progCheck.count || 0) > 0;
    const hasAttempts = (attCheck.count || 0) > 0;

    if (hasProgress || hasAttempts) {
      alert("Training cannot be permanently deleted because it has linked records. Please Archive the training instead.");
      return;
    }

    // 2. Safely clean up associated assessment questions before deleting the training module
    const qDelete = await sb.from("assessment_questions").delete().eq("training_id", id);
    if (qDelete.error) {
      console.error("Questions cleanup failed:", qDelete.error);
      alert("Training could not be deleted due to associated questions: " + qDelete.error.message);
      await route("train");
      return;
    }

    // 3. Perform DELETE on trainings table and verify modified row count via .select()
    const r = await sb.from("trainings").delete().eq("id", id).select();

    if (r.error) {
      console.error("Supabase DELETE error:", r.error);
      alert("Training could not be deleted: " + r.error.message);
      await route("train");
      return;
    }

    // Strict validation: Check if 0 rows were affected (e.g. missing RLS delete policy or permission failure)
    if (!r.data || r.data.length === 0) {
      console.error("DELETE returned 0 modified rows. Verify RLS DELETE policy for 'trainings' table.");
      alert("Training could not be deleted from database (0 rows affected). Please verify Supabase RLS DELETE permissions for the 'trainings' table.");
      await route("train");
      return;
    }

    // 4. Confirmed Success: Notify admin and re-fetch fresh training list from database
    alert("Training deleted successfully.");
    await route("train");

  } catch (err) {
    console.error("Unexpected error during training delete:", err);
    alert("An unexpected error occurred while deleting training: " + (err.message || err));
    await route("train");
  }
}

async function training(){
  const admin = profile.role === "admin";
  
  if (admin) {
    const [tRes, uRes, attRes, progRes] = await Promise.all([
      sb.from("trainings").select("*").order("created_at",{ascending:false}),
      sb.from("profiles").select("*").eq("role","user"),
      sb.from("assessment_attempts").select("*, trainings(title)"),
      sb.from("training_progress").select("*, trainings(title)")
    ]);

    if(tRes.error) return layout("train","Training",`<div class="card"><b>Error:</b> ${esc(tRes.error.message)}</div>`);
    
    const rows = tRes.data || [];
    const employees = uRes.data || [];
    const attempts = attRes.data || [];
    const progresses = progRes.data || [];
    const now = new Date();

    const totalTrainingsCount = rows.length;
    const publishedCount = rows.filter(t => t.published && !t.archived).length;
    const draftCount = rows.filter(t => !t.published && !t.archived).length;
    const archivedCount = rows.filter(t => t.archived).length;

    const getTrainingUserStats = (t) => {
      const tId = String(t.id || "").toLowerCase().trim();
      const tTitle = String(t.title || "").toLowerCase().trim();

      const matchTraining = (rec) => {
        if (!rec) return false;
        const recTId = String(rec.training_id || rec.training_title || "").toLowerCase().trim();
        const recRelTitle = String(rec.trainings?.title || "").toLowerCase().trim();
        return (
          (recTId !== "" && recTId === tId) ||
          (tTitle !== "" && recTId === tTitle) ||
          (tTitle !== "" && recRelTitle === tTitle)
        );
      };

      let assigned = employees.length;
      let completed = 0;
      let pending = 0;
      let expired = 0;

      employees.forEach(emp => {
        const empUuid = String(emp.id || "").toLowerCase().trim();
        const empCode = String(emp.employee_id || "").toLowerCase().trim();
        const empUser = String(emp.username || "").toLowerCase().trim();

        const matchUser = (rec) => {
          if (!rec) return false;
          const uVal = String(rec.user_id || rec.employee_id || rec.username || "").toLowerCase().trim();
          if (!uVal) return false;
          return uVal === empUuid || (empCode !== "" && uVal === empCode) || (empUser !== "" && uVal === empUser);
        };

        const userAttempts = attempts.filter(a => matchUser(a) && matchTraining(a));
        const passedAttempt = userAttempts.find(a => 
          a.passed === true || 
          String(a.passed).toLowerCase() === 'true' || 
          a.passed === 1 ||
          (a.score !== undefined && a.score !== null && t.passing_marks && Number(a.score) >= Number(t.passing_marks))
        );

        const prog = progresses.find(p => matchUser(p) && matchTraining(p));
        const isCompletedProg = prog && (
          prog.status === 'completed' || 
          String(prog.status).toLowerCase() === 'completed'
        );

        if (passedAttempt || isCompletedProg) {
          let completionDate = null;
          if (passedAttempt && passedAttempt.created_at) {
            completionDate = new Date(passedAttempt.created_at);
          } else if (prog && (prog.updated_at || prog.created_at)) {
            completionDate = new Date(prog.updated_at || prog.created_at);
          }

          if (completionDate && !isNaN(completionDate.getTime()) && t.validity) {
            const valStr = String(t.validity).toLowerCase().trim();
            const valNumMatch = valStr.match(/\d+/);
            const num = valNumMatch ? parseInt(valNumMatch[0], 10) : 1;

            const expiryDate = new Date(completionDate.getTime());
            if (valStr.includes("month")) {
              expiryDate.setMonth(expiryDate.getMonth() + num);
            } else if (valStr.includes("day")) {
              expiryDate.setDate(expiryDate.getDate() + num);
            } else {
              expiryDate.setFullYear(expiryDate.getFullYear() + num);
            }

            if (now > expiryDate) {
              expired++;
            } else {
              completed++;
            }
          } else {
            completed++;
          }
        } else {
          pending++;
        }
      });

      return { assigned, completed, pending, expired };
    };

    return layout("train", "Training Management", `
      <p class="muted">Create and manage training requirements, schedules & assigned employee metrics</p>
      
      <div class="grid" style="margin-bottom:20px">
        ${metric("Total Requirements", totalTrainingsCount)}
        ${metric("Published", publishedCount)}
        ${metric("Draft", draftCount)}
        ${metric("Archived", archivedCount)}
      </div>

      <div class="actions"><button class="btn blue" onclick="trainingForm()">+ Add Training</button></div>
      
      <div style="margin-top:16px">
      ${rows.map(t => {
        const stats = getTrainingUserStats(t);
        const tDateStr = t.created_at ? new Date(t.created_at).toLocaleDateString("en-IN") : "-";
        
        return `
          <div class="card item" style="margin-bottom:16px">
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
                <h3 style="margin:0">${esc(t.title)}</h3>
                <span class="badge ${t.archived ? "o" : t.published ? "g" : "o"}">${t.archived ? "Archived" : t.published ? "Published" : "Draft"}</span>
              </div>
              <p class="muted" style="margin:4px 0">${esc(t.category||"General")} · Duration: ${esc(t.duration||"1 Hour")} · Validity: ${esc(t.validity||"1 Year")}</p>
              <p style="margin:8px 0">${esc(t.description||"")}</p>
              
              <div style="display:flex;gap:16px;font-size:13px;margin-top:8px;color:#555">
                <div>📅 <b>Training Date:</b> ${tDateStr}</div>
                <div>🕐 <b>Duration:</b> ${esc(t.duration||"1 Hour")}</div>
              </div>

              <div style="display:flex;gap:12px;font-size:12px;margin-top:10px;background:#f8f9fa;padding:8px 12px;border-radius:6px;width:fit-content">
                <div>👥 <b>Assigned:</b> ${stats.assigned}</div>
                <div style="color:#2e7d32">🟢 <b>Completed:</b> ${stats.completed}</div>
                <div style="color:#ed6c02">🟡 <b>Pending:</b> ${stats.pending}</div>
                <div style="color:#d32f2f">🔴 <b>Expired:</b> ${stats.expired}</div>
              </div>
            </div>

            <div class="actions" style="align-self:center;flex-wrap:wrap;gap:6px">
              <button class="btn blue" onclick="viewTrainingDetailsModal('${t.id}')">👥 View Users & Stats</button>
              <button class="btn light" onclick="trainingForm('${t.id}')">Edit</button>
              <button class="btn light" onclick="togglePublish('${t.id}',${!t.published})">${t.published ? "Unpublish" : "Publish"}</button>
              <button class="btn light" onclick="toggleArchive('${t.id}',${!t.archived})">${t.archived ? "Unarchive" : "Archive"}</button>
              <button class="btn light" onclick="manageAssessment('${t.id}')">Assessment</button>
              <button class="btn light" style="color:#d32f2f;border-color:#f8d7da" onclick="confirmDeleteTraining('${t.id}', '${esc(t.title)}')">Delete</button>
            </div>
          </div>
        `;
      }).join("") || '<div class="card empty">No training found.</div>'}
      </div>
    `);
  }

  // --- USER SIDE "MY TRAININGS" VIEW ---
  const [tRes, attRes, progRes] = await Promise.all([
    sb.from("trainings").select("*").eq("published", true).eq("archived", false).order("created_at", { ascending: true }),
    sb.from("assessment_attempts").select("*, trainings(title)").eq("user_id", profile.id).order("created_at", { ascending: false }),
    sb.from("training_progress").select("*, trainings(title)").eq("user_id", profile.id)
  ]);

  const activeTrainings = tRes.data || [];
  const userAttempts = attRes.data || [];
  const userProgresses = progRes.data || [];
  const now = new Date();

  let completedCount = 0;
  let pendingCount = 0;
  let expiredCount = 0;

  const processedTrainings = activeTrainings.map(t => {
    const tId = String(t.id || "").toLowerCase().trim();
    const tTitle = String(t.title || "").toLowerCase().trim();

    const matchTraining = (rec) => {
      if (!rec) return false;
      const recTId = String(rec.training_id || rec.training_title || "").toLowerCase().trim();
      const recRelTitle = String(rec.trainings?.title || "").toLowerCase().trim();
      return (
        (recTId !== "" && recTId === tId) ||
        (tTitle !== "" && recTId === tTitle) ||
        (tTitle !== "" && recRelTitle === tTitle)
      );
    };

    const attemptsForT = userAttempts.filter(a => matchTraining(a));
    const passedAttempt = attemptsForT.find(a => 
      a.passed === true || 
      String(a.passed).toLowerCase() === 'true' || 
      a.passed === 1 ||
      (a.score !== undefined && a.score !== null && t.passing_marks && Number(a.score) >= Number(t.passing_marks))
    );

    const prog = userProgresses.find(p => matchTraining(p));
    const isCompletedProg = prog && (
      prog.status === 'completed' || 
      String(prog.status).toLowerCase() === 'completed'
    );

    let status = "PENDING";
    let completionDate = null;
    let expiryDate = null;
    let attemptId = passedAttempt ? passedAttempt.id : null;

    if (passedAttempt || isCompletedProg) {
      if (passedAttempt && passedAttempt.created_at) {
        completionDate = new Date(passedAttempt.created_at);
      } else if (prog && (prog.updated_at || prog.created_at)) {
        completionDate = new Date(prog.updated_at || prog.created_at);
      }

      if (completionDate && !isNaN(completionDate.getTime()) && t.validity) {
        const valStr = String(t.validity).toLowerCase().trim();
        const valNumMatch = valStr.match(/\d+/);
        const num = valNumMatch ? parseInt(valNumMatch[0], 10) : 1;

        expiryDate = new Date(completionDate.getTime());
        if (valStr.includes("month")) {
          expiryDate.setMonth(expiryDate.getMonth() + num);
        } else if (valStr.includes("day")) {
          expiryDate.setDate(expiryDate.getDate() + num);
        } else {
          expiryDate.setFullYear(expiryDate.getFullYear() + num);
        }

        if (now > expiryDate) {
          status = "EXPIRED";
        } else {
          status = "COMPLETED";
        }
      } else {
        status = "COMPLETED";
      }
    } else {
      status = "PENDING";
    }

    if (status === "COMPLETED") completedCount++;
    else if (status === "PENDING") pendingCount++;
    else if (status === "EXPIRED") expiredCount++;

    return {
      ...t,
      computedStatus: status,
      completionDate: completionDate,
      expiryDate: expiryDate,
      attemptId: attemptId
    };
  });

  myTrainingsCache = {
    trainings: processedTrainings,
    summary: {
      total: activeTrainings.length,
      pending: pendingCount,
      completed: completedCount,
      expired: expiredCount
    }
  };

  layout("train", "My Trainings", `
    <p class="muted">Available published trainings assigned to you</p>

    <div class="grid" style="margin-bottom:20px">
      ${metric("Total Assigned", myTrainingsCache.summary.total)}
      ${metric("Pending", myTrainingsCache.summary.pending)}
      ${metric("Completed", myTrainingsCache.summary.completed)}
      ${metric("Expired", myTrainingsCache.summary.expired)}
    </div>

    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button id="trFilterAllBtn" class="btn ${userTrainingFilterKey==='ALL'?'blue':'light'}" onclick="filterUserTrainings('ALL')">All (${myTrainingsCache.summary.total})</button>
      <button id="trFilterPendingBtn" class="btn ${userTrainingFilterKey==='PENDING'?'blue':'light'}" onclick="filterUserTrainings('PENDING')">Pending (${myTrainingsCache.summary.pending})</button>
      <button id="trFilterCompletedBtn" class="btn ${userTrainingFilterKey==='COMPLETED'?'blue':'light'}" onclick="filterUserTrainings('COMPLETED')">Completed (${myTrainingsCache.summary.completed})</button>
      <button id="trFilterExpiredBtn" class="btn ${userTrainingFilterKey==='EXPIRED'?'blue':'light'}" onclick="filterUserTrainings('EXPIRED')">Expired (${myTrainingsCache.summary.expired})</button>
    </div>

    <div id="userTrainingsCardsList"></div>
  `);

  renderUserTrainingsCards();
}

async function viewTrainingDetailsModal(trainingId) {
  const [tRes, uRes, attRes, progRes] = await Promise.all([
    sb.from("trainings").select("*").eq("id", trainingId).single(),
    sb.from("profiles").select("*").eq("role", "user").order("created_at", { ascending: false }),
    sb.from("assessment_attempts").select("*").eq("training_id", trainingId),
    sb.from("training_progress").select("*").eq("training_id", trainingId)
  ]);

  if (tRes.error) return alert("Error loading training details: " + tRes.error.message);

  const t = tRes.data;
  const employees = uRes.data || [];
  const attempts = attRes.data || [];
  const progresses = progRes.data || [];
  const now = new Date();

  let completeCount = 0;
  let pendingCount = 0;
  let expiredCount = 0;

  const userStatusList = employees.map(emp => {
    const empUuid = String(emp.id || "").toLowerCase().trim();
    const empCode = String(emp.employee_id || "").toLowerCase().trim();
    const empUser = String(emp.username || "").toLowerCase().trim();

    const matchUser = (rec) => {
      if (!rec) return false;
      const uVal = String(rec.user_id || rec.employee_id || rec.username || "").toLowerCase().trim();
      return uVal === empUuid || (empCode !== "" && uVal === empCode) || (empUser !== "" && uVal === empUser);
    };

    const passedAttempt = attempts.find(a => matchUser(a) && (
      a.passed === true || String(a.passed).toLowerCase() === 'true' || a.passed === 1 ||
      (a.score !== undefined && a.score !== null && t.passing_marks && Number(a.score) >= Number(t.passing_marks))
    ));

    const prog = progresses.find(p => matchUser(p) && (p.status === 'completed' || String(p.status).toLowerCase() === 'completed'));

    let status = "PENDING";
    let completionDate = null;
    let expiryDate = null;

    if (passedAttempt || prog) {
      if (passedAttempt && passedAttempt.created_at) {
        completionDate = new Date(passedAttempt.created_at);
      } else if (prog && (prog.updated_at || prog.created_at)) {
        completionDate = new Date(prog.updated_at || prog.created_at);
      }

      if (completionDate && !isNaN(completionDate.getTime()) && t.validity) {
        const valStr = String(t.validity).toLowerCase().trim();
        const valNumMatch = valStr.match(/\d+/);
        const num = valNumMatch ? parseInt(valNumMatch[0], 10) : 1;

        expiryDate = new Date(completionDate.getTime());
        if (valStr.includes("month")) {
          expiryDate.setMonth(expiryDate.getMonth() + num);
        } else if (valStr.includes("day")) {
          expiryDate.setDate(expiryDate.getDate() + num);
        } else {
          expiryDate.setFullYear(expiryDate.getFullYear() + num);
        }

        if (now > expiryDate) {
          status = "EXPIRED";
          expiredCount++;
        } else {
          status = "COMPLETE";
          completeCount++;
        }
      } else {
        status = "COMPLETE";
        completeCount++;
      }
    } else {
      status = "PENDING";
      pendingCount++;
    }

    return {
      empId: emp.employee_id || "-",
      name: emp.name || "Employee",
      dept: emp.department || "-",
      status: status,
      cDateStr: completionDate ? completionDate.toLocaleDateString("en-IN") : "-",
      eDateStr: expiryDate ? expiryDate.toLocaleDateString("en-IN") : "-"
    };
  });

  adminTrainingDetailsCache = {
    training: t,
    userList: userStatusList
  };
  adminTrainingUserFilter = "ALL";

  const tDateStr = t.created_at ? new Date(t.created_at).toLocaleDateString("en-IN") : "-";

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:950px">
        <h2>${esc(t.title)} — Training Details</h2>
        <p class="muted">${esc(t.category||"General")} · Duration: ${esc(t.duration||"1 Hour")} · Validity: ${esc(t.validity||"1 Year")}</p>
        
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;margin:15px 0">
          <div class="card" style="padding:10px">👥 <b>Total Assigned:</b> ${employees.length}</div>
          <div class="card" style="padding:10px;color:#2e7d32">🟢 <b>Complete:</b> ${completeCount}</div>
          <div class="card" style="padding:10px;color:#ed6c02">🟡 <b>Pending:</b> ${pendingCount}</div>
          <div class="card" style="padding:10px;color:#d32f2f">🔴 <b>Expired:</b> ${expiredCount}</div>
        </div>

        <div style="display:flex;gap:20px;font-size:13px;margin-bottom:15px;background:#f8f9fa;padding:10px;border-radius:6px">
          <div>📅 <b>Creation/Scheduled Date:</b> ${tDateStr}</div>
          <div>Status: <b>${t.published ? 'Published' : 'Draft'}</b></div>
          <div>Passing Marks: <b>${t.passing_marks||90}%</b></div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button id="trUserFAll" class="btn blue" onclick="filterTrainingUsersList('ALL')">All (${employees.length})</button>
          <button id="trUserFComp" class="btn light" onclick="filterTrainingUsersList('COMPLETE')">Complete (${completeCount})</button>
          <button id="trUserFPend" class="btn light" onclick="filterTrainingUsersList('PENDING')">Pending (${pendingCount})</button>
          <button id="trUserFExp" class="btn light" onclick="filterTrainingUsersList('EXPIRED')">Expired (${expiredCount})</button>
        </div>

        <div class="tablewrap" style="max-height:300px;overflow-y:auto;margin-bottom:15px">
          <table class="table" id="trainingUsersDetailsTable">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Department</th>
                <th>Status</th>
                <th>Completion Date</th>
                <th>Expiry Date</th>
              </tr>
            </thead>
            <tbody id="trainingUsersDetailsTableBody"></tbody>
          </table>
        </div>

        <div class="actions" style="justify-content:flex-end">
          <button class="btn light" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `);

  renderTrainingUsersDetailsTableBody();
}

function filterTrainingUsersList(filterKey) {
  adminTrainingUserFilter = filterKey;
  if ($("trUserFAll")) $("trUserFAll").className = filterKey === 'ALL' ? "btn blue" : "btn light";
  if ($("trUserFComp")) $("trUserFComp").className = filterKey === 'COMPLETE' ? "btn blue" : "btn light";
  if ($("trUserFPend")) $("trUserFPend").className = filterKey === 'PENDING' ? "btn blue" : "btn light";
  if ($("trUserFExp")) $("trUserFExp").className = filterKey === 'EXPIRED' ? "btn blue" : "btn light";

  renderTrainingUsersDetailsTableBody();
}

function renderTrainingUsersDetailsTableBody() {
  if (!adminTrainingDetailsCache) return;
  const tbody = $("trainingUsersDetailsTableBody");
  if (!tbody) return;

  let list = adminTrainingDetailsCache.userList;
  if (adminTrainingUserFilter !== "ALL") {
    list = list.filter(u => u.status === adminTrainingUserFilter);
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No employees found for status filter '${adminTrainingUserFilter}'.</td></tr>`;
    return;
  }

  const getBadge = (st) => {
    switch(st) {
      case "COMPLETE": return `<span class="badge g">✓ COMPLETE</span>`;
      case "PENDING": return `<span class="badge o" style="background:#fff3cd;color:#856404">⏳ PENDING</span>`;
      case "EXPIRED": return `<span class="badge o" style="background:#f8d7da;color:#721c24">⚠ EXPIRED</span>`;
      default: return `<span class="badge muted">${st}</span>`;
    }
  };

  tbody.innerHTML = list.map(u => `
    <tr>
      <td><b>${esc(u.empId)}</b></td>
      <td>${esc(u.name)}</td>
      <td>${esc(u.dept)}</td>
      <td>${getBadge(u.status)}</td>
      <td>${esc(u.cDateStr)}</td>
      <td>${esc(u.eDateStr)}</td>
    </tr>
  `).join("");
}

function filterUserTrainings(filterKey) {
  userTrainingFilterKey = filterKey;
  if ($("trFilterAllBtn")) $("trFilterAllBtn").className = filterKey === 'ALL' ? "btn blue" : "btn light";
  if ($("trFilterPendingBtn")) $("trFilterPendingBtn").className = filterKey === 'PENDING' ? "btn blue" : "btn light";
  if ($("trFilterCompletedBtn")) $("trFilterCompletedBtn").className = filterKey === 'COMPLETED' ? "btn blue" : "btn light";
  if ($("trFilterExpiredBtn")) $("trFilterExpiredBtn").className = filterKey === 'EXPIRED' ? "btn blue" : "btn light";

  renderUserTrainingsCards();
}

function renderUserTrainingsCards() {
  if (!myTrainingsCache) return;
  const container = $("userTrainingsCardsList");
  if (!container) return;

  let list = myTrainingsCache.trainings;
  if (userTrainingFilterKey !== "ALL") {
    list = list.filter(t => t.computedStatus === userTrainingFilterKey);
  }

  if (list.length === 0) {
    container.innerHTML = `<div class="card empty" style="text-align:center;padding:30px">No trainings found for status filter '${userTrainingFilterKey}'.</div>`;
    return;
  }

  const getStatusBadge = (st) => {
    switch(st) {
      case "COMPLETED": return `<span class="badge g" style="white-space:nowrap">✓ Completed</span>`;
      case "PENDING": return `<span class="badge o" style="white-space:nowrap;background:#fff3cd;color:#856404">⏳ Pending</span>`;
      case "EXPIRED": return `<span class="badge o" style="white-space:nowrap;background:#f8d7da;color:#721c24">⚠ Expired</span>`;
      default: return `<span class="badge muted">${st}</span>`;
    }
  };

  container.innerHTML = list.map(t => {
    const cDateStr = t.completionDate ? new Date(t.completionDate).toLocaleDateString("en-IN") : "-";
    const eDateStr = t.expiryDate ? new Date(t.expiryDate).toLocaleDateString("en-IN") : "-";

    let actionButtonHtml = "";
    if (t.computedStatus === "COMPLETED" && t.attemptId) {
      actionButtonHtml = `<button class="btn blue" onclick="showCertificate('${t.attemptId}')">View Certificate</button>`;
    } else if (t.computedStatus === "COMPLETED" && !t.assessment_required) {
      actionButtonHtml = `<button class="btn blue" onclick="showDeclarationCertificate('${t.id}')">View Certificate</button>`;
    } else if (t.computedStatus === "COMPLETED") {
      actionButtonHtml = `<button class="btn light" onclick="openTraining('${t.id}')">Review Material</button>`;
    } else {
      actionButtonHtml = `<button class="btn blue" onclick="openTraining('${t.id}')">Open / Start Training</button>`;
    }

    return `
      <div class="card item" style="margin-bottom:16px">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
            <h3 style="margin:0">${esc(t.title)}</h3>
            ${getStatusBadge(t.computedStatus)}
          </div>
          <p class="muted" style="margin:4px 0">${esc(t.category||"General")} · Duration: ${esc(t.duration||"N/A")} · Validity: ${esc(t.validity||"1 Year")}</p>
          <p style="margin:8px 0">${esc(t.description||"")}</p>
          
          <div style="display:flex;gap:20px;font-size:13px;margin-top:10px;color:#555">
            ${t.computedStatus === 'COMPLETED' ? `<div><b>Completed:</b> ${cDateStr}</div><div><b>Expiry:</b> ${eDateStr}</div>` : ''}
            ${t.computedStatus === 'EXPIRED' ? `<div><b>Last Completed:</b> ${cDateStr}</div><div style="color:#d32f2f"><b>Expired On:</b> ${eDateStr}</div>` : ''}
            ${t.computedStatus === 'PENDING' ? `<div><b>Status:</b> Pending Completion</div>` : ''}
          </div>
        </div>
        <div class="actions" style="align-self:center">
          ${actionButtonHtml}
        </div>
      </div>
    `;
  }).join("");
}

async function trainingForm(id){
  let t = {
    title:"", category:"", description:"", duration:"", validity:"1 Year",
    material_url:"", assessment_required:false, passing_marks:90,
    allowed_attempts:1, published:false
  };

  if(id){
    const r = await sb.from("trainings").select("*").eq("id",id).single();
    if(r.error) return alert(r.error.message);
    t = r.data;
  }

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal">
        <h2>${id ? "Edit Training" : "Add Training"}</h2>
        <div class="formgrid">
          <div class="fullfield"><label>Training Title *</label><input id="tt" value="${esc(t.title)}"></div>
          <div><label>Category</label><input id="tc" value="${esc(t.category||"")}"></div>
          <div><label>Duration</label><input id="td" value="${esc(t.duration||"")}"></div>
          <div class="fullfield"><label>Description</label><textarea id="tdesc" rows="4">${esc(t.description||"")}</textarea></div>
          <div><label>Validity</label><input id="tv" value="${esc(t.validity||"1 Year")}"></div>
          <div class="fullfield">
            <label>Training Material File</label>
            <input id="tfile" type="file" accept=".ppt,.pptx,.pdf,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov">
          </div>
          <div class="fullfield"><label>YouTube / External Material URL</label><input id="tm" value="${esc((t.material_url||"").startsWith("storage:")?"":(t.material_url||""))}"></div>
          <div>
            <label>Assessment Required</label>
            <select id="ta">
              <option value="false" ${!t.assessment_required?"selected":""}>No</option>
              <option value="true" ${t.assessment_required?"selected":""}>Yes</option>
            </select>
          </div>
          <div><label>Passing Marks (%)</label><input id="tp" type="number" min="1" max="100" value="${t.passing_marks||90}"></div>
          <div><label>Allowed Attempts</label><input id="tatt" type="number" min="1" value="${t.allowed_attempts||1}"></div>
          <div>
            <label>Status</label>
            <select id="tpub">
              <option value="false" ${!t.published?"selected":""}>Draft</option>
              <option value="true" ${t.published?"selected":""}>Publish</option>
            </select>
          </div>
        </div>
        <div class="actions" style="margin-top:15px">
          <button class="btn blue" onclick="saveTraining('${id||""}')">Save Training</button>
          <button class="btn light" onclick="closeModal()">Cancel</button>
        </div>
      </div>
    </div>
  `);
}

async function saveTraining(id){
  const file = $("tfile").files[0];
  const external = $("tm").value.trim();

  const payload = {
    title: $("tt").value.trim(),
    category: $("tc").value.trim(),
    description: $("tdesc").value.trim(),
    duration: $("td").value.trim(),
    validity: $("tv").value.trim() || "1 Year",
    material_url: external,
    assessment_required: $("ta").value === "true",
    passing_marks: Math.max(1, Math.min(100, parseInt($("tp").value||90))),
    allowed_attempts: Math.max(1, parseInt($("tatt").value||1)),
    published: $("tpub").value === "true",
    updated_at: new Date().toISOString()
  };

  if(!payload.title) return alert("Training Title is required.");

  let trainingId = id;
  let r;

  if(id){
    r = await sb.from("trainings").update(payload).eq("id",id);
  } else {
    payload.created_by = profile.id;
    r = await sb.from("trainings").insert(payload).select("id").single();
    if(!r.error) trainingId = r.data.id;
  }

  if(r.error) return alert(r.error.message);

  if(file){
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const path = `training/${trainingId}/${Date.now()}_${safe}`;
    const up = await sb.storage.from("training-materials").upload(path, file, {upsert:false});
    if(up.error) return alert("Training saved, but file upload failed: "+up.error.message);

    await sb.from("trainings")
      .update({material_url:`storage:training-materials/${path}`, updated_at:new Date().toISOString()})
      .eq("id", trainingId);
  }

  closeModal();
  route("train");
}

async function togglePublish(id, value){
  const r = await sb.from("trainings").update({published:value, updated_at:new Date().toISOString()}).eq("id",id);
  if(r.error) return alert(r.error.message);
  route("train");
}

async function toggleArchive(id, value){
  const r = await sb.from("trainings").update({archived:value, updated_at:new Date().toISOString()}).eq("id",id);
  if(r.error) return alert(r.error.message);
  route("train");
}

async function openTraining(id){
  const r = await sb.from("trainings").select("*").eq("id",id).single();
  if(r.error) return alert(r.error.message);
  const t = r.data;
  let material = "<p class=muted>No training material added yet.</p>";

  if(t.material_url){
    let url = t.material_url;
    if(url.startsWith("storage:")){
      const raw = url.substring("storage:".length);
      const slash = raw.indexOf("/");
      const bucket = raw.substring(0, slash);
      const path = raw.substring(slash + 1);
      const sr = await sb.storage.from(bucket).createSignedUrl(path, 3600);
      if(!sr.error){
        url = sr.data.signedUrl;
        const lower = path.toLowerCase();
        if(lower.endsWith(".pdf")){
          material = `<h3>Training Material</h3><iframe src="${esc(url)}" style="width:100%;height:600px;border:1px solid #ddd;border-radius:10px"></iframe>`;
        } else if(/\.(png|jpg|jpeg|webp|gif)$/i.test(lower)){
          material = `<h3>Training Material</h3><img src="${esc(url)}" style="max-width:100%;max-height:600px;display:block;margin:auto;border-radius:10px">`;
        } else if(/\.(mp4|webm|mov)$/i.test(lower)){
          material = `<h3>Training Material</h3><video controls style="width:100%;max-height:600px" src="${esc(url)}"></video>`;
        } else if(/\.(ppt|pptx)$/i.test(lower)){
          const viewer = "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(url);
          material = `<h3>Training Material</h3><iframe src="${viewer}" style="width:100%;height:650px;border:1px solid #ddd;border-radius:10px" allowfullscreen></iframe>`;
        } else {
          material = `<h3>Training Material</h3><iframe src="${esc(url)}" style="width:100%;height:600px;border:1px solid #ddd;border-radius:10px"></iframe>`;
        }
      }
    } else if(/youtube\.com|youtu\.be/i.test(url)){
      let vid = "";
      const m = url.match(/(?:v=|youtu\.be\/|embed\/)([^&?\/]+)/i);
      if(m) vid = m[1];
      material = vid ? `<h3>Training Material</h3><iframe width="100%" height="500" src="https://www.youtube.com/embed/${esc(vid)}" frameborder="0" allowfullscreen></iframe>` : `<p><a href="${esc(url)}" target="_blank">Open YouTube Material</a></p>`;
    } else {
      material = `<h3>Training Material</h3><iframe src="${esc(url)}" style="width:100%;height:600px;border:1px solid #ddd;border-radius:10px"></iframe>`;
    }
  }

  let assess = "";
  if(t.assessment_required){
    const a = await sb.from("assessment_attempts").select("id,score,passed,created_at").eq("training_id",id).eq("user_id",profile.id).order("created_at",{ascending:false}).limit(1);
    const last = (a.data||[])[0];
    assess = `<div class="card" style="margin-top:16px">
      <h3>Assessment Required</h3>
      <p class="muted">Passing marks: ${t.passing_marks||90}% · Allowed attempts: ${t.allowed_attempts||1}</p>
      ${last ? `<p>Last result: <b>${last.score}%</b> — ${last.passed ? "Passed" : "Failed"}</p>` : "<p class=muted>Not attempted yet.</p>"}
      ${last && last.passed
        ? `<button class="btn blue" onclick="showCertificate('${last.id}')">View Certificate</button>`
        : `<button class="btn blue" onclick="startAssessment('${id}')">Start Assessment</button>`}
    </div>`;
  }

  // Declaration-based completion — only for trainings that do not have an assessment,
  // since without an assessment there was previously no way to mark them completed.
  let declaration = "";
  if(!t.assessment_required){
    const pr = await sb.from("training_progress").select("*").eq("training_id",id).eq("user_id",profile.id).order("created_at",{ascending:false}).limit(1);
    const prog = (pr.data||[])[0];
    const isDone = prog && (prog.status==="completed" || String(prog.status).toLowerCase()==="completed");
    if(isDone){
      const doneDate = prog.updated_at || prog.created_at;
      declaration = `<div class="card" style="margin-top:16px;border-left:4px solid var(--green-600,#1f9d55)">
        <h3>✅ Training Completed</h3>
        <p class="muted">You declared this training read and completed${doneDate ? " on "+new Date(doneDate).toLocaleDateString("en-IN") : ""}.</p>
        <button class="btn blue" onclick="showDeclarationCertificate('${id}')">View Certificate</button>
      </div>`;
    } else {
      declaration = `<div class="card" style="margin-top:16px">
        <h3>Declaration</h3>
        <label style="display:flex;align-items:flex-start;gap:10px;font-weight:500;margin:10px 0">
          <input type="checkbox" id="declareCheck" style="width:auto;margin-top:3px" onchange="$('declareBtn').disabled=!this.checked">
          <span>I confirm that I have read and gone through this training material carefully and understood its content.</span>
        </label>
        <button id="declareBtn" class="btn blue" disabled onclick="markTrainingComplete('${id}')">OK · Mark Training as Complete</button>
      </div>`;
    }
  }

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:1000px">
        <h2>${esc(t.title)}</h2>
        <p>${esc(t.description||"")}</p>
        ${material}${assess}${declaration}
        <div class="actions"><button class="btn light" onclick="closeModal()">Close</button></div>
      </div>
    </div>
  `);
}

async function markTrainingComplete(trainingId){
  const chk = $("declareCheck");
  if(!chk || !chk.checked){
    return alert("Please tick the declaration checkbox to confirm you have read the training material.");
  }
  const btn = $("declareBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Saving..."; }

  const existing = await sb.from("training_progress").select("id").eq("training_id",trainingId).eq("user_id",profile.id).limit(1);

  // Note: training_progress has no updated_at column (see README V8 fix) — only status/created_at are written.
  let r;
  if(existing.data && existing.data.length){
    r = await sb.from("training_progress").update({ status:"completed" }).eq("id", existing.data[0].id);
  } else {
    r = await sb.from("training_progress").insert({ training_id: trainingId, user_id: profile.id, status:"completed" });
  }

  if(r.error){
    if(btn){ btn.disabled = false; btn.textContent = "OK · Mark Training as Complete"; }
    return alert(r.error.message);
  }

  closeModal();
  showDeclarationCertificate(trainingId);
}

// --- ASSESSMENT MODULE ---

async function manageAssessment(trainingId){
  const tr = await sb.from("trainings").select("*").eq("id",trainingId).single();
  if(tr.error) return alert(tr.error.message);
  if(!tr.data.assessment_required) return alert("Enable 'Assessment Required' in Edit Training first.");

  const r = await sb.from("assessment_questions").select("*").eq("training_id",trainingId).order("question_no",{ascending:true});
  const qs = r.data || [];

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:900px">
        <h2>Assessment — ${esc(tr.data.title)}</h2>
        <div class="actions"><button class="btn blue" onclick="questionForm('${trainingId}')">+ Add Question</button><button class="btn light" onclick="closeModal()">Close</button></div>
        <div style="margin-top:16px">${qs.map(q => `
          <div class="card" style="margin-bottom:10px">
            <b>Q${q.question_no}. ${esc(q.question_text)}</b>
            <ol type="A">${[q.option_a, q.option_b, q.option_c, q.option_d].map((o,i) => `<li>${esc(o)} ${q.correct_option===String.fromCharCode(65+i) ? "<b>(Correct)</b>" : ""}</li>`).join("")}</ol>
            <div class="actions"><button class="btn light" onclick="questionForm('${trainingId}','${q.id}')">Edit</button><button class="btn light" onclick="deleteQuestion('${q.id}','${trainingId}')">Delete</button></div>
          </div>`).join("") || '<div class="card empty">No questions added yet.</div>'}</div>
      </div>
    </div>
  `);
}

async function questionForm(trainingId, id){
  let q = {question_text:"", option_a:"", option_b:"", option_c:"", option_d:"", correct_option:"A", question_no:1};
  if(id){
    const r = await sb.from("assessment_questions").select("*").eq("id",id).single();
    if(!r.error) q = r.data;
  } else {
    const r = await sb.from("assessment_questions").select("question_no").eq("training_id",trainingId).order("question_no",{ascending:false}).limit(1);
    q.question_no = ((r.data||[])[0]?.question_no || 0) + 1;
  }

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal2">
      <div class="modal">
        <h2>${id ? "Edit" : "Add"} Question</h2>
        <label>Question *</label><textarea id="qtext" rows="3">${esc(q.question_text)}</textarea>
        <div class="formgrid">
          <div><label>Option A *</label><input id="qa" value="${esc(q.option_a)}"></div>
          <div><label>Option B *</label><input id="qb" value="${esc(q.option_b)}"></div>
          <div><label>Option C *</label><input id="qc" value="${esc(q.option_c)}"></div>
          <div><label>Option D *</label><input id="qd" value="${esc(q.option_d)}"></div>
          <div>
            <label>Correct Answer</label>
            <select id="qcorrect">
              ${["A","B","C","D"].map(x => `<option value="${x}" ${q.correct_option===x?"selected":""}>${x}</option>`).join("")}
            </select>
          </div>
          <div><label>Question No.</label><input id="qno" type="number" min="1" value="${q.question_no}"></div>
        </div>
        <div class="actions" style="margin-top:15px">
          <button class="btn blue" onclick="saveQuestion('${trainingId}','${id||""}')">Save Question</button>
          <button class="btn light" onclick="closeQuestionModal()">Cancel</button>
        </div>
      </div>
    </div>
  `);
}

function closeQuestionModal(){ $("modal2")?.remove(); }

async function saveQuestion(trainingId, id){
  const payload = {
    training_id: trainingId,
    question_text: $("qtext").value.trim(),
    option_a: $("qa").value.trim(),
    option_b: $("qb").value.trim(),
    option_c: $("qc").value.trim(),
    option_d: $("qd").value.trim(),
    correct_option: $("qcorrect").value,
    question_no: parseInt($("qno").value || 1)
  };

  if(!payload.question_text || !payload.option_a || !payload.option_b || !payload.option_c || !payload.option_d){
    return alert("Question and all options are required.");
  }

  const r = id ? await sb.from("assessment_questions").update(payload).eq("id",id) : await sb.from("assessment_questions").insert(payload);
  if(r.error) return alert(r.error.message);

  closeQuestionModal();
  closeModal();
  manageAssessment(trainingId);
}

async function deleteQuestion(id, trainingId){
  if(!confirm("Delete this question?")) return;
  await sb.from("assessment_questions").delete().eq("id",id);
  closeModal();
  manageAssessment(trainingId);
}

async function startAssessment(trainingId){
  closeModal();
  const tr = await sb.from("trainings").select("*").eq("id",trainingId).single();
  const t = tr.data;
  const qr = await sb.from("assessment_questions").select("*").eq("training_id",trainingId).order("question_no",{ascending:true});
  const qs = qr.data || [];
  if(!qs.length) return alert("No questions available.");

  const ar = await sb.from("assessment_attempts").select("*").eq("training_id",trainingId).eq("user_id",profile.id).order("created_at",{ascending:false});
  const attempts = ar.data || [];
  const last = attempts[0];
  if(last?.passed) return showCertificate(last.id);

  if(attempts.length >= (t.allowed_attempts || 1) && !attempts.some(x => x.retry_allowed)){
    return alert("Allowed attempts exhausted. Contact Admin.");
  }

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:900px">
        <h2>${esc(t.title)} — Assessment</h2>
        <form id="assessmentForm">${qs.map((q,i) => `
          <div class="card" style="margin-bottom:12px">
            <b>Q${i+1}. ${esc(q.question_text)}</b>
            ${["A","B","C","D"].map(o => `<label style="display:block;margin:8px 0">
              <input type="radio" name="q${q.id}" value="${o}" required> ${o}. ${esc(q["option_"+o.toLowerCase()])}
            </label>`).join("")}
          </div>`).join("")}
        </form>
        <div class="actions">
          <button class="btn blue" onclick="submitAssessment('${trainingId}')">Submit Assessment</button>
          <button class="btn light" onclick="closeModal()">Cancel</button>
        </div>
      </div>
    </div>
  `);
}

async function submitAssessment(trainingId){
  const form = $("assessmentForm");
  if(!form || !form.reportValidity()) return;

  const qr = await sb.from("assessment_questions").select("id").eq("training_id",trainingId);
  const answers = {};
  qr.data.forEach(q => {
    const el = document.querySelector(`input[name="q${q.id}"]:checked`);
    if(el) answers[q.id] = el.value;
  });

  const res = await sb.rpc("submit_assessment", { p_training_id: trainingId, p_answers: answers });
  if(res.error) return alert(res.error.message);

  const d = res.data;
  closeModal();

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:650px;text-align:center">
        <h2>${d.passed ? "Assessment Passed" : "Assessment Failed"}</h2>
        <p style="font-size:42px;font-weight:700;margin:15px 0">${d.score}%</p>
        <p>${d.correct} of ${d.total} correct.</p>
        <div class="actions" style="justify-content:center">
          ${d.passed ? `<button class="btn blue" onclick="showCertificate('${d.attempt_id}')">View Certificate</button>` : ""}
          <button class="btn light" onclick="closeModal();route('results')">View Results</button>
        </div>
      </div>
    </div>
  `);
}

async function showCertificate(attemptId){
  closeModal();
  const r = await sb.from("assessment_attempts")
    .select("id,training_id,score,passed,created_at,trainings(title),profiles(name,employee_id)")
    .eq("id",attemptId).single();

  if(r.error) return alert(r.error.message);
  const a = r.data;
  const certNo = "STLP-" + String(a.id).replace(/-/g,"").substring(0,10).toUpperCase();

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:900px">
        <div id="certificate" style="border:8px double #1f4d3a;padding:55px 45px;text-align:center;background:#fff">
          <div style="font-size:18px;font-weight:700">TALWANDI SABO THERMAL PLANT</div>
          <h1 style="font-size:38px;margin:30px 0 10px">CERTIFICATE OF COMPLETION</h1>
          <p>This is to certify that</p>
          <h2 style="font-size:28px;margin:10px 0">${esc(a.profiles?.name||"")}</h2>
          <p>Employee ID: <b>${esc(a.profiles?.employee_id||"-")}</b></p>
          <p>has successfully completed training</p>
          <h2>${esc(a.trainings?.title||"")}</h2>
          <p>Score: <b>${a.score}%</b></p>
          <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px">
            <div>Cert No: <b>${certNo}</b></div>
            <div>Date: <b>${new Date(a.created_at).toLocaleDateString("en-IN")}</b></div>
          </div>
        </div>
        <div class="actions" style="justify-content:center;margin-top:15px">
          <button class="btn blue" onclick="printCertificate()">Print / Save PDF</button>
          <button class="btn light" onclick="maybeShowFeedback('${a.training_id}')">Close</button>
        </div>
      </div>
    </div>
  `);
}

// Certificate for trainings completed via the read-and-declare flow (no assessment attached).
async function showDeclarationCertificate(trainingId){
  closeModal();
  const [tRes, pRes] = await Promise.all([
    sb.from("trainings").select("title").eq("id",trainingId).single(),
    sb.from("training_progress").select("id,created_at").eq("training_id",trainingId).eq("user_id",profile.id).order("created_at",{ascending:false}).limit(1)
  ]);

  if(tRes.error) return alert(tRes.error.message);
  if(pRes.error) return alert(pRes.error.message);
  const prog = (pRes.data||[])[0];
  if(!prog) return alert("No completion record found for this training yet.");

  const dateVal = prog.created_at;
  const certNo = "STLP-" + String(prog.id).replace(/-/g,"").substring(0,10).toUpperCase();

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:900px">
        <div id="certificate" style="border:8px double #1f4d3a;padding:55px 45px;text-align:center;background:#fff">
          <div style="font-size:18px;font-weight:700">TALWANDI SABO THERMAL PLANT</div>
          <h1 style="font-size:38px;margin:30px 0 10px">CERTIFICATE OF COMPLETION</h1>
          <p>This is to certify that</p>
          <h2 style="font-size:28px;margin:10px 0">${esc(profile.name||"")}</h2>
          <p>Employee ID: <b>${esc(profile.employee_id||"-")}</b></p>
          <p>has successfully completed training</p>
          <h2>${esc(tRes.data.title||"")}</h2>
          <p class="muted">Completed via read &amp; declaration acknowledgement</p>
          <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px">
            <div>Cert No: <b>${certNo}</b></div>
            <div>Date: <b>${dateVal ? new Date(dateVal).toLocaleDateString("en-IN") : "-"}</b></div>
          </div>
        </div>
        <div class="actions" style="justify-content:center;margin-top:15px">
          <button class="btn blue" onclick="printCertificate()">Print / Save PDF</button>
          <button class="btn light" onclick="maybeShowFeedback('${trainingId}', true)">Close</button>
        </div>
      </div>
    </div>
  `);
}

function printCertificate(){
  const cert = $("certificate");
  if(!cert) return;
  const w = window.open("","_blank","width=1000,height=800");
  w.document.write(`<html><head><title>Certificate</title><style>body{font-family:Arial;margin:40px}</style></head><body>${cert.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(),400);
}

// --- FEEDBACK MODULE ---
// Feedback popup shown once, right after a user first views their certificate for a
// completed training (assessment-passed or declaration-based). If feedback was already
// given for this training, re-viewing the certificate later no longer prompts again.
let _feedbackStarSel = 0;

async function maybeShowFeedback(trainingId, thenGoToTraining){
  closeModal();
  const existing = await sb.from("training_feedback").select("id").eq("training_id",trainingId).eq("user_id",profile.id).limit(1);
  if(existing.error){
    // If the check itself fails, don't block the user's normal flow.
    if(thenGoToTraining) training();
    return;
  }
  if(existing.data && existing.data.length){
    if(thenGoToTraining) training();
    return;
  }
  showFeedbackPopup(trainingId, thenGoToTraining);
}

async function showFeedbackPopup(trainingId, thenGoToTraining){
  const tr = await sb.from("trainings").select("title").eq("id",trainingId).single();
  const tTitle = tr.data?.title || "";
  _feedbackStarSel = 0;

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:520px">
        <h2>Training Feedback</h2>
        <p class="muted">${esc(tTitle)}</p>
        <p>Please rate this training *</p>
        <div id="fbStars" style="font-size:34px;letter-spacing:6px;cursor:pointer;margin:8px 0 18px">
          ${[1,2,3,4,5].map(n=>`<span data-n="${n}" onclick="setFeedbackStar(${n})" style="color:#d9d9d9">★</span>`).join("")}
        </div>
        <label>Comments (optional)</label>
        <textarea id="fbComments" rows="4" placeholder="Any suggestions or comments about this training..."></textarea>
        <div class="actions" style="margin-top:15px">
          <button class="btn blue" onclick="submitFeedback('${trainingId}', ${thenGoToTraining ? "true" : "false"})">Submit Feedback</button>
          <button class="btn light" onclick="skipFeedback(${thenGoToTraining ? "true" : "false"})">Skip</button>
        </div>
      </div>
    </div>
  `);
}

function setFeedbackStar(n){
  _feedbackStarSel = n;
  document.querySelectorAll("#fbStars span").forEach(s => {
    s.style.color = parseInt(s.dataset.n) <= n ? "#e8912c" : "#d9d9d9";
  });
}

function skipFeedback(thenGoToTraining){
  closeModal();
  if(thenGoToTraining) training();
}

async function submitFeedback(trainingId, thenGoToTraining){
  if(!_feedbackStarSel){
    return alert("Please select a star rating before submitting.");
  }
  const btn = document.querySelector("#modal .btn.blue");
  if(btn){ btn.disabled = true; btn.textContent = "Submitting..."; }

  const r = await sb.from("training_feedback").insert({
    training_id: trainingId,
    user_id: profile.id,
    rating: _feedbackStarSel,
    comments: ($("fbComments")?.value || "").trim() || null
  });

  if(r.error){
    if(btn){ btn.disabled = false; btn.textContent = "Submit Feedback"; }
    return alert(r.error.message);
  }

  closeModal();
  if(thenGoToTraining) training();
}

async function feedbackPage(){
  const [fRes, tRes, uRes] = await Promise.all([
    sb.from("training_feedback").select("*, trainings(title), profiles(name,employee_id)").order("created_at",{ascending:false}),
    sb.from("trainings").select("id,title").order("title",{ascending:true}),
    sb.from("profiles").select("id,name,employee_id").eq("role","user").order("name",{ascending:true})
  ]);

  if(fRes.error) return layout("feedback","Feedback",`<div class="card"><b>Error:</b> ${esc(fRes.error.message)}</div>`);

  window._feedbackCache = fRes.data || [];
  const trainingsList = tRes.data || [];
  const usersList = uRes.data || [];

  const total = window._feedbackCache.length;
  const avgRating = total ? (window._feedbackCache.reduce((s,f)=>s+(f.rating||0),0)/total).toFixed(1) : "-";

  layout("feedback","Feedback",`
    <div class="grid" style="margin-bottom:20px">
      ${metric("Total Feedback", total)}
      ${metric("Average Rating", total ? avgRating+" / 5" : "-")}
    </div>

    <div class="card" style="margin-bottom:16px;padding:16px">
      <h3 style="margin-top:0;margin-bottom:12px;font-size:16px">Filters</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(170px, 1fr));gap:12px;align-items:end">
        <div>
          <label style="font-size:12px;font-weight:bold">Search Keyword</label>
          <input id="fbSearch" placeholder="Search user, training, comments..." oninput="renderFeedbackTable()" style="width:100%;margin:4px 0 0">
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Training</label>
          <select id="fbFilterTraining" onchange="renderFeedbackTable()" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Trainings</option>
            ${trainingsList.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">User</label>
          <select id="fbFilterUser" onchange="renderFeedbackTable()" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Users</option>
            ${usersList.map(u=>`<option value="${u.id}">${esc(u.name)} (${esc(u.employee_id||"-")})</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Rating</label>
          <select id="fbFilterRating" onchange="renderFeedbackTable()" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Ratings</option>
            ${[5,4,3,2,1].map(n=>`<option value="${n}">${n} Star${n>1?"s":""}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Date From</label>
          <input type="date" id="fbFilterDateFrom" onchange="renderFeedbackTable()" style="width:100%;margin:4px 0 0">
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Date To</label>
          <input type="date" id="fbFilterDateTo" onchange="renderFeedbackTable()" style="width:100%;margin:4px 0 0">
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px">
      <div id="feedbackTableContent"></div>
    </div>
  `);

  renderFeedbackTable();
}

function renderFeedbackTable(){
  const container = $("feedbackTableContent");
  if(!container) return;

  const searchQ = ($("fbSearch")?.value || "").toLowerCase().trim();
  const trainingF = $("fbFilterTraining")?.value || "ALL";
  const userF = $("fbFilterUser")?.value || "ALL";
  const ratingF = $("fbFilterRating")?.value || "ALL";
  const dateFromVal = $("fbFilterDateFrom")?.value || "";
  const dateToVal = $("fbFilterDateTo")?.value || "";

  const dFrom = dateFromVal ? new Date(dateFromVal + "T00:00:00") : null;
  const dTo = dateToVal ? new Date(dateToVal + "T23:59:59") : null;

  const filtered = (window._feedbackCache || []).filter(f => {
    if(trainingF !== "ALL" && f.training_id !== trainingF) return false;
    if(userF !== "ALL" && f.user_id !== userF) return false;
    if(ratingF !== "ALL" && String(f.rating) !== ratingF) return false;

    const ts = new Date(f.created_at);
    if(dFrom && ts < dFrom) return false;
    if(dTo && ts > dTo) return false;

    if(searchQ){
      const haystack = `${f.profiles?.name||""} ${f.profiles?.employee_id||""} ${f.trainings?.title||""} ${f.comments||""}`.toLowerCase();
      if(!haystack.includes(searchQ)) return false;
    }
    return true;
  });

  if(!filtered.length){
    container.innerHTML = `<div class="card empty" style="text-align:center;padding:30px">No feedback found.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="tablewrap" style="overflow-x:auto">
      <table class="table">
        <thead>
          <tr>
            <th style="white-space:nowrap">Date</th>
            <th style="white-space:nowrap">User</th>
            <th style="white-space:nowrap">Training</th>
            <th style="white-space:nowrap">Rating</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(f => `
            <tr>
              <td style="white-space:nowrap">${new Date(f.created_at).toLocaleDateString("en-IN")}</td>
              <td><b>${esc(f.profiles?.name||"")}</b><br><span class="muted" style="font-size:12px">${esc(f.profiles?.employee_id||"-")}</span></td>
              <td>${esc(f.trainings?.title||"")}</td>
              <td style="white-space:nowrap;color:#e8912c">${"★".repeat(f.rating||0)}${"☆".repeat(5-(f.rating||0))}</td>
              <td>${esc(f.comments||"-")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// --- OTHER SYSTEM MODULES ---

async function assessmentResults(){
  if(profile.role==="admin"){
    const r = await sb.from("assessment_attempts").select("*, trainings(title), profiles(name,employee_id)").order("created_at",{ascending:false});
    layout("results","Assessment Results",`<div class=tablewrap><table class=table><tr><th>User</th><th>Emp ID</th><th>Training</th><th>Score</th><th>Status</th><th>Date</th></tr>${(r.data||[]).map(a=>`<tr><td>${esc(a.profiles?.name||"")}</td><td>${esc(a.profiles?.employee_id||"")}</td><td>${esc(a.trainings?.title||"")}</td><td>${a.score}%</td><td><span class="badge ${a.passed?"g":"o"}">${a.passed?"Passed":"Failed"}</span></td><td>${new Date(a.created_at).toLocaleString()}</td></tr>`).join("")||'<tr><td colspan=6 class=empty>No attempts.</td></tr>'}</table></div>`);
  } else {
    const r = await sb.from("assessment_attempts").select("*, trainings(title)").eq("user_id",profile.id).order("created_at",{ascending:false});
    layout("results","My Assessments",`<div class=tablewrap><table class=table><tr><th>Training</th><th>Score</th><th>Status</th><th>Date</th></tr>${(r.data||[]).map(a=>`<tr><td>${esc(a.trainings?.title||"")}</td><td>${a.score}%</td><td><span class="badge ${a.passed?"g":"o"}">${a.passed?"Passed":"Failed"}</span></td><td>${new Date(a.created_at).toLocaleString()}</td></tr>`).join("")||'<tr><td colspan=4 class=empty>No attempts.</td></tr>'}</table></div>`);
  }
}

async function notifications(){
  const admin = profile.role === "admin";
  const r = await sb.from("notifications").select("*").order("created_at",{ascending:false});
  layout("notes","Notifications",`
    ${admin ? `<div class="actions"><button class="btn blue" onclick="addNotificationForm()">+ Add Notification</button></div>` : ""}
    <div style="margin-top:16px">${(r.data||[]).map(n=>`
      <div class="card" style="margin-bottom:12px">
        <h3>${esc(n.title)}</h3><p>${esc(n.message)}</p>
      </div>`).join("")||'<div class="card empty">No notifications.</div>'}</div>
  `);
}

function addNotificationForm(){
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal"><div class="modal">
      <h2>Add Notification</h2>
      <label>Title</label><input id="ntitle">
      <label>Message</label><textarea id="nmsg" rows="4"></textarea>
      <div class="actions" style="margin-top:15px"><button class="btn blue" onclick="saveNotification()">Publish</button><button class="btn light" onclick="closeModal()">Cancel</button></div>
    </div></div>
  `);
}

async function saveNotification(){
  await sb.from("notifications").insert({ title: $("ntitle").value.trim(), message: $("nmsg").value.trim() });
  closeModal();
  notifications();
}

async function progress(){
  const admin = profile.role === "admin";
  
  if(!admin){
    return layout("progress","My Progress",`<div class="card"><p class="muted">Check "My Trainings" or "Assessments" for your personal progress.</p></div>`);
  }

  const [uRes, tRes, attRes, progRes] = await Promise.all([
    sb.from("profiles").select("*").eq("role","user").order("created_at",{ascending:false}),
    sb.from("trainings").select("*").order("created_at",{ascending:true}),
    sb.from("assessment_attempts").select("*, trainings(title)"),
    sb.from("training_progress").select("*, trainings(title)")
  ]);

  const employees = uRes.data || [];
  const rawTrainings = tRes.data || [];
  const attempts = attRes.data || [];
  const progresses = progRes.data || [];

  const activeTrainings = rawTrainings.filter(t => t.archived !== true);
  const now = new Date();

  const getItemStatus = (emp, training) => {
    if (!training) return "MISSING";

    const empUuid = String(emp.id || "").toLowerCase().trim();
    const empCode = String(emp.employee_id || "").toLowerCase().trim();
    const empUser = String(emp.username || "").toLowerCase().trim();
    const tId = String(training.id || "").toLowerCase().trim();
    const tTitle = String(training.title || "").toLowerCase().trim();

    const matchUser = (rec) => {
      if (!rec) return false;
      const uVal = String(rec.user_id || rec.employee_id || rec.username || "").toLowerCase().trim();
      if (!uVal) return false;
      return uVal === empUuid || (empCode !== "" && uVal === empCode) || (empUser !== "" && uVal === empUser);
    };

    const matchTraining = (rec) => {
      if (!rec) return false;
      const recTId = String(rec.training_id || rec.training_title || "").toLowerCase().trim();
      const recRelTitle = String(rec.trainings?.title || "").toLowerCase().trim();
      
      return (
        (recTId !== "" && recTId === tId) ||
        (tTitle !== "" && recTId === tTitle) ||
        (tTitle !== "" && recRelTitle === tTitle)
      );
    };

    const userAttempts = attempts.filter(a => matchUser(a) && matchTraining(a));
    const passedAttempt = userAttempts.find(a => 
      a.passed === true || 
      String(a.passed).toLowerCase() === 'true' || 
      a.passed === 1 ||
      (a.score !== undefined && a.score !== null && training.passing_marks && Number(a.score) >= Number(training.passing_marks))
    );

    const prog = progresses.find(p => matchUser(p) && matchTraining(p));
    const isCompletedProg = prog && (
      prog.status === 'completed' || 
      String(prog.status).toLowerCase() === 'completed'
    );

    if (passedAttempt || isCompletedProg) {
      let completionDate = null;
      if (passedAttempt && passedAttempt.created_at) {
        completionDate = new Date(passedAttempt.created_at);
      } else if (prog && (prog.updated_at || prog.created_at)) {
        completionDate = new Date(prog.updated_at || prog.created_at);
      }

      if (completionDate && !isNaN(completionDate.getTime()) && training.validity) {
        const valStr = String(training.validity).toLowerCase().trim();
        const valNumMatch = valStr.match(/\d+/);
        const num = valNumMatch ? parseInt(valNumMatch[0], 10) : 1;

        const expiryDate = new Date(completionDate.getTime());
        if (valStr.includes("month")) {
          expiryDate.setMonth(expiryDate.getMonth() + num);
        } else if (valStr.includes("day")) {
          expiryDate.setDate(expiryDate.getDate() + num);
        } else {
          expiryDate.setFullYear(expiryDate.getFullYear() + num);
        }

        if (now > expiryDate) {
          return "EXPIRED";
        }
      }
      return "COMPLETE";
    }

    return "PENDING";
  };

  let totalCompliantCount = 0;
  let totalPendingCount = 0;
  let totalExpiredCount = 0;
  let totalMissingCount = 0;

  const matrixData = employees.map(emp => {
    let empCompliant = 0;
    let empPending = 0;
    let empExpired = 0;
    let empMissing = 0;

    const items = activeTrainings.map(t => {
      const st = getItemStatus(emp, t);
      if (st === "COMPLETE" || st === "COMPLIANT") empCompliant++;
      else if (st === "PENDING") empPending++;
      else if (st === "EXPIRED") empExpired++;
      else if (st === "MISSING") empMissing++;
      return { trainingId: t.id, title: t.title, status: st };
    });

    const totalReqs = activeTrainings.length;
    const progressPct = totalReqs > 0 ? Math.round((empCompliant / totalReqs) * 100) : 0;

    let overallStatus = "COMPLETE";
    if (totalReqs === 0) {
      overallStatus = "COMPLETE";
    } else if (empExpired > 0) {
      overallStatus = "EXPIRED";
    } else if (empPending > 0) {
      overallStatus = "PENDING";
    } else if (empMissing > 0 && empCompliant < totalReqs) {
      overallStatus = "MISSING";
    }

    if (overallStatus === "COMPLETE" || overallStatus === "COMPLIANT") totalCompliantCount++;
    else if (overallStatus === "PENDING") totalPendingCount++;
    else if (overallStatus === "EXPIRED") totalExpiredCount++;
    else if (overallStatus === "MISSING") totalMissingCount++;

    return {
      empId: emp.employee_id || "-",
      name: emp.name || "Employee",
      department: emp.department || "-",
      overallStatus: overallStatus,
      progressPct: progressPct,
      items: items
    };
  });

  const getStatusBadge = (st) => {
    switch(st) {
      case "COMPLETE":
      case "COMPLIANT": return `<span class="badge g" style="white-space:nowrap">✓ COMPLETE</span>`;
      case "PENDING": return `<span class="badge o" style="white-space:nowrap;background:#fff3cd;color:#856404">⏳ PENDING</span>`;
      case "EXPIRED": return `<span class="badge o" style="white-space:nowrap">⚠ EXPIRED</span>`;
      case "MISSING": return `<span class="badge r" style="white-space:nowrap;background:#f8d7da;color:#721c24">✕ MISSING</span>`;
      default: return `<span class="badge muted">${st}</span>`;
    }
  };

  const getIconStatus = (st) => {
    switch(st) {
      case "COMPLETE":
      case "COMPLIANT": return `<span title="COMPLETE" style="color:#2e7d32;font-weight:bold;font-size:16px">✓</span>`;
      case "PENDING": return `<span title="PENDING" style="color:#ed6c02;font-weight:bold;font-size:16px">⏳</span>`;
      case "EXPIRED": return `<span title="EXPIRED" style="color:#d32f2f;font-weight:bold;font-size:16px">⚠</span>`;
      case "MISSING": return `<span title="MISSING" style="color:#c62828;font-weight:bold;font-size:16px">✕</span>`;
      default: return `-`;
    }
  };

  layout("progress", "Detailed Progress", `
    <p class="muted">Users Compliance Matrix</p>
    
    <div class="grid" style="margin-bottom:20px">
      ${metric("Total Managed Employees", employees.length)}
      ${metric("Complete", totalCompliantCount)}
      ${metric("Pending", totalPendingCount)}
      ${metric("Expired", totalExpiredCount)}
      ${metric("Missing", totalMissingCount)}
    </div>

    <div class="card" style="margin-bottom:16px;padding:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <div style="flex:1;min-width:200px">
        <input id="matrixSearch" placeholder="Search Employee ID or Name..." oninput="filterMatrix()" style="margin:0;width:100%">
      </div>
      <div>
        <select id="matrixFilter" onchange="filterMatrix()" style="margin:0">
          <option value="ALL">Filter: All Statuses</option>
          <option value="COMPLETE">Complete</option>
          <option value="PENDING">Pending</option>
          <option value="EXPIRED">Expired</option>
          <option value="MISSING">Missing</option>
        </select>
      </div>
    </div>

    <div class="tablewrap" style="overflow-x:auto;max-width:100%">
      <table class="table" id="matrixTable">
        <thead>
          <tr>
            <th style="white-space:nowrap">Employee ID</th>
            <th style="white-space:nowrap">Employee Name</th>
            <th style="white-space:nowrap">Overall Progress</th>
            <th style="white-space:nowrap">Overall Status</th>
            ${activeTrainings.map(t => `<th style="white-space:nowrap;text-align:center" title="${esc(t.title)}">${esc(t.title.length > 20 ? t.title.substring(0,18)+'...' : t.title)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${matrixData.map(r => `
            <tr data-status="${r.overallStatus}" data-search="${esc(r.empId.toLowerCase() + ' ' + r.name.toLowerCase())}">
              <td><b>${esc(r.empId)}</b></td>
              <td>${esc(r.name)}</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="flex:1;background:#eee;height:8px;border-radius:4px;overflow:hidden;min-width:60px">
                    <div style="width:${r.progressPct}%;background:${r.progressPct===100?'#2e7d32':'#0288d1'};height:100%"></div>
                  </div>
                  <span style="font-size:12px;font-weight:bold">${r.progressPct}%</span>
                </div>
              </td>
              <td>${getStatusBadge(r.overallStatus)}</td>
              ${r.items.map(it => `<td style="text-align:center">${getIconStatus(it.status)}</td>`).join("")}
            </tr>
          `).join("") || '<tr><td colspan="' + (4 + activeTrainings.length) + '" class="empty">No employee progress data available.</td></tr>'}
        </tbody>
      </table>
    </div>
  `);
}

function filterMatrix(){
  const q = ($("matrixSearch")?.value || "").toLowerCase().trim();
  const st = $("matrixFilter")?.value || "ALL";
  const rows = document.querySelectorAll("#matrixTable tbody tr");

  rows.forEach(r => {
    const rowStatus = r.getAttribute("data-status");
    const rowSearch = r.getAttribute("data-search") || "";

    const matchesSearch = !q || rowSearch.includes(q);
    const matchesFilter = st === "ALL" || rowStatus === st || (st === "COMPLETE" && (rowStatus === "COMPLIANT" || rowStatus === "COMPLETE"));

    if (matchesSearch && matchesFilter) {
      r.style.display = "";
    } else {
      r.style.display = "none";
    }
  });
}

// Global cached dataset for Reports & Analytics
let reportsDataCache = null;

async function reports(){
  const admin = profile.role === "admin";
  
  if(!admin){
    return layout("reports", "Reports & Analytics", `<div class="card"><p class="muted">Reports and export functionality are accessible to Administrators.</p></div>`);
  }

  const [uRes, tRes, attRes, progRes] = await Promise.all([
    sb.from("profiles").select("*").eq("role","user").order("created_at",{ascending:false}),
    sb.from("trainings").select("*").order("created_at",{ascending:true}),
    sb.from("assessment_attempts").select("*, trainings(title)"),
    sb.from("training_progress").select("*, trainings(title)")
  ]);

  const employees = uRes.data || [];
  const rawTrainings = tRes.data || [];
  const attempts = attRes.data || [];
  const progresses = progRes.data || [];

  const activeTrainings = rawTrainings.filter(t => t.archived !== true);
  const now = new Date();

  const getItemStatusDetail = (emp, training) => {
    if (!training) return { status: "MISSING", completionDate: null, expiryDate: null };

    const empUuid = String(emp.id || "").toLowerCase().trim();
    const empCode = String(emp.employee_id || "").toLowerCase().trim();
    const empUser = String(emp.username || "").toLowerCase().trim();
    const tId = String(training.id || "").toLowerCase().trim();
    const tTitle = String(training.title || "").toLowerCase().trim();

    const matchUser = (rec) => {
      if (!rec) return false;
      const uVal = String(rec.user_id || rec.employee_id || rec.username || "").toLowerCase().trim();
      if (!uVal) return false;
      return uVal === empUuid || (empCode !== "" && uVal === empCode) || (empUser !== "" && uVal === empUser);
    };

    const matchTraining = (rec) => {
      if (!rec) return false;
      const recTId = String(rec.training_id || rec.training_title || "").toLowerCase().trim();
      const recRelTitle = String(rec.trainings?.title || "").toLowerCase().trim();
      return (
        (recTId !== "" && recTId === tId) ||
        (tTitle !== "" && recTId === tTitle) ||
        (tTitle !== "" && recRelTitle === tTitle)
      );
    };

    const userAttempts = attempts.filter(a => matchUser(a) && matchTraining(a));
    const passedAttempt = userAttempts.find(a => 
      a.passed === true || 
      String(a.passed).toLowerCase() === 'true' || 
      a.passed === 1 ||
      (a.score !== undefined && a.score !== null && training.passing_marks && Number(a.score) >= Number(training.passing_marks))
    );

    const prog = progresses.find(p => matchUser(p) && matchTraining(p));
    const isCompletedProg = prog && (
      prog.status === 'completed' || 
      String(prog.status).toLowerCase() === 'completed'
    );

    if (passedAttempt || isCompletedProg) {
      let completionDate = null;
      if (passedAttempt && passedAttempt.created_at) {
        completionDate = new Date(passedAttempt.created_at);
      } else if (prog && (prog.updated_at || prog.created_at)) {
        completionDate = new Date(prog.updated_at || prog.created_at);
      }

      let expiryDate = null;
      if (completionDate && !isNaN(completionDate.getTime()) && training.validity) {
        const valStr = String(training.validity).toLowerCase().trim();
        const valNumMatch = valStr.match(/\d+/);
        const num = valNumMatch ? parseInt(valNumMatch[0], 10) : 1;

        expiryDate = new Date(completionDate.getTime());
        if (valStr.includes("month")) {
          expiryDate.setMonth(expiryDate.getMonth() + num);
        } else if (valStr.includes("day")) {
          expiryDate.setDate(expiryDate.getDate() + num);
        } else {
          expiryDate.setFullYear(expiryDate.getFullYear() + num);
        }

        if (now > expiryDate) {
          return { status: "EXPIRED", completionDate, expiryDate };
        }
      }
      return { status: "COMPLETE", completionDate, expiryDate };
    }

    return { status: "PENDING", completionDate: null, expiryDate: null };
  };

  let summaryComplete = 0;
  let summaryPending = 0;
  let summaryExpired = 0;
  let summaryMissing = 0;

  const compiledEmployees = employees.map(emp => {
    let empComplete = 0;
    let empPending = 0;
    let empExpired = 0;
    let empMissing = 0;

    const items = activeTrainings.map(t => {
      const detail = getItemStatusDetail(emp, t);
      if (detail.status === "COMPLETE" || detail.status === "COMPLIANT") empComplete++;
      else if (detail.status === "PENDING") empPending++;
      else if (detail.status === "EXPIRED") empExpired++;
      else if (detail.status === "MISSING") empMissing++;

      return {
        trainingId: t.id,
        trainingTitle: t.title,
        status: detail.status,
        completionDate: detail.completionDate,
        expiryDate: detail.expiryDate
      };
    });

    const totalReqs = activeTrainings.length;
    const progressPct = totalReqs > 0 ? Math.round((empComplete / totalReqs) * 100) : 0;

    let overallStatus = "COMPLETE";
    if (totalReqs === 0) {
      overallStatus = "COMPLETE";
    } else if (empExpired > 0) {
      overallStatus = "EXPIRED";
    } else if (empPending > 0) {
      overallStatus = "PENDING";
    } else if (empMissing > 0 && empComplete < totalReqs) {
      overallStatus = "MISSING";
    }

    if (overallStatus === "COMPLETE" || overallStatus === "COMPLIANT") summaryComplete++;
    else if (overallStatus === "PENDING") summaryPending++;
    else if (overallStatus === "EXPIRED") summaryExpired++;
    else if (overallStatus === "MISSING") summaryMissing++;

    return {
      id: emp.id,
      empId: emp.employee_id || "-",
      name: emp.name || "Employee",
      department: emp.department || "-",
      designation: emp.designation || "-",
      company: emp.company || "-",
      overallStatus: overallStatus,
      progressPct: progressPct,
      items: items
    };
  });

  reportsDataCache = {
    employees: compiledEmployees,
    activeTrainings: activeTrainings,
    summary: {
      totalEmployees: employees.length,
      complete: summaryComplete,
      pending: summaryPending,
      expired: summaryExpired,
      missing: summaryMissing
    },
    activeTab: 'emp'
  };

  layout("reports", "Reports & Analytics", `
    <p class="muted">Detailed Compliance Metrics, Auditing Preview & Filtered Export Options</p>
    
    <div class="grid" style="margin-bottom:20px">
      ${metric("Total Managed Employees", reportsDataCache.summary.totalEmployees)}
      ${metric("Complete", reportsDataCache.summary.complete)}
      ${metric("Pending", reportsDataCache.summary.pending)}
      ${metric("Expired", reportsDataCache.summary.expired)}
      ${metric("Missing", reportsDataCache.summary.missing)}
    </div>

    <div class="card" style="margin-bottom:16px;padding:16px">
      <h3 style="margin-top:0;margin-bottom:12px;font-size:16px">Report Filters</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;align-items:end">
        <div>
          <label style="font-size:12px;font-weight:bold">Employee</label>
          <select id="rptFilterEmp" onchange="renderReportTab()" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Employees</option>
            ${compiledEmployees.map(e => `<option value="${esc(e.id)}">${esc(e.empId)} - ${esc(e.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Training Requirement</label>
          <select id="rptFilterTraining" onchange="renderReportTab()" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Trainings</option>
            ${activeTrainings.map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Status</label>
          <select id="rptFilterStatus" onchange="renderReportTab()" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Statuses</option>
            <option value="COMPLETE">Complete</option>
            <option value="PENDING">Pending</option>
            <option value="EXPIRED">Expired</option>
            <option value="MISSING">Missing</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Date From</label>
          <input type="date" id="rptFilterDateFrom" onchange="renderReportTab()" style="width:100%;margin:4px 0 0">
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Date To</label>
          <input type="date" id="rptFilterDateTo" onchange="renderReportTab()" style="width:100%;margin:4px 0 0">
        </div>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
      <div style="display:flex;gap:8px">
        <button id="rptTabEmpBtn" class="btn blue" onclick="switchReportTab('emp')">Employee Compliance Report</button>
        <button id="rptTabStatusBtn" class="btn light" onclick="switchReportTab('status')">Training Status Report</button>
        <button id="rptTabSummaryBtn" class="btn light" onclick="switchReportTab('summary')">Training Summary Report</button>
      </div>
      <div>
        <button id="rptExportBtn" class="btn blue" onclick="exportSelectedReport()">📥 Export Report (CSV)</button>
      </div>
    </div>

    <div class="card" style="padding:16px">
      <div id="reportPreviewContent"></div>
    </div>
  `);

  renderReportTab();
}

function switchReportTab(tabKey) {
  if (!reportsDataCache) return;
  reportsDataCache.activeTab = tabKey;

  $("rptTabEmpBtn").className = tabKey === 'emp' ? "btn blue" : "btn light";
  $("rptTabStatusBtn").className = tabKey === 'status' ? "btn blue" : "btn light";
  $("rptTabSummaryBtn").className = tabKey === 'summary' ? "btn blue" : "btn light";

  renderReportTab();
}

function filterReportRecords() {
  if (!reportsDataCache) return { employees: [], trainings: [] };

  const empFilter = $("rptFilterEmp")?.value || "ALL";
  const trainingFilter = $("rptFilterTraining")?.value || "ALL";
  const statusFilter = $("rptFilterStatus")?.value || "ALL";
  const dateFromVal = $("rptFilterDateFrom")?.value || "";
  const dateToVal = $("rptFilterDateTo")?.value || "";

  const dFrom = dateFromVal ? new Date(dateFromVal + "T00:00:00") : null;
  const dTo = dateToVal ? new Date(dateToVal + "T23:59:59") : null;

  let activeTrainings = reportsDataCache.activeTrainings;
  if (trainingFilter !== "ALL") {
    activeTrainings = activeTrainings.filter(t => String(t.id) === String(trainingFilter));
  }

  let employees = reportsDataCache.employees;
  if (empFilter !== "ALL") {
    employees = employees.filter(e => String(e.id) === String(empFilter));
  }

  const processedEmployees = employees.map(emp => {
    let items = emp.items;

    if (trainingFilter !== "ALL") {
      items = items.filter(it => String(it.trainingId) === String(trainingFilter));
    }

    if (statusFilter !== "ALL") {
      items = items.filter(it => {
        if (statusFilter === "COMPLETE" || statusFilter === "COMPLIANT") {
          return it.status === "COMPLETE" || it.status === "COMPLIANT";
        }
        return it.status === statusFilter;
      });
    }

    if (dFrom || dTo) {
      items = items.filter(it => {
        if (!it.completionDate) return false;
        const cDate = new Date(it.completionDate);
        if (dFrom && cDate < dFrom) return false;
        if (dTo && cDate > dTo) return false;
        return true;
      });
    }

    return { ...emp, items: items };
  }).filter(emp => {
    if (statusFilter !== "ALL") {
      const matchesOverall = statusFilter === "COMPLETE" 
        ? (emp.overallStatus === "COMPLETE" || emp.overallStatus === "COMPLIANT") 
        : emp.overallStatus === statusFilter;
      return matchesOverall || emp.items.length > 0;
    }
    return emp.items.length > 0 || trainingFilter === "ALL";
  });

  return { employees: processedEmployees, trainings: activeTrainings };
}

function renderReportTab() {
  if (!reportsDataCache) return;

  const tab = reportsDataCache.activeTab;
  const container = $("reportPreviewContent");
  if (!container) return;

  const { employees, trainings } = filterReportRecords();
  const getBadge = (st) => {
    switch(st) {
      case "COMPLETE":
      case "COMPLIANT": return `<span class="badge g">✓ COMPLETE</span>`;
      case "PENDING": return `<span class="badge o" style="background:#fff3cd;color:#856404">⏳ PENDING</span>`;
      case "EXPIRED": return `<span class="badge o">⚠ EXPIRED</span>`;
      case "MISSING": return `<span class="badge r" style="background:#f8d7da;color:#721c24">✕ MISSING</span>`;
      default: return `<span class="badge muted">${st}</span>`;
    }
  };

  if (tab === 'emp') {
    $("rptExportBtn").innerText = "📥 Export Employee Compliance CSV";
    container.innerHTML = `
      <h4 style="margin-top:0;margin-bottom:12px">Report Preview — Employee Compliance (${employees.length} Records)</h4>
      <div class="tablewrap" style="overflow-x:auto">
        <table class="table">
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Employee Name</th>
              <th>Department</th>
              <th>Overall Progress</th>
              <th>Overall Status</th>
              ${trainings.map(t => `<th style="text-align:center">${esc(t.title)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${employees.map(e => `
              <tr>
                <td><b>${esc(e.empId)}</b></td>
                <td>${esc(e.name)}</td>
                <td>${esc(e.department)}</td>
                <td><b>${e.progressPct}%</b></td>
                <td>${getBadge(e.overallStatus)}</td>
                ${trainings.map(t => {
                  const rawEmp = reportsDataCache.employees.find(rE => String(rE.id) === String(e.id));
                  const it = rawEmp ? rawEmp.items.find(i => String(i.trainingId) === String(t.id)) : null;
                  return `<td style="text-align:center">${it ? getBadge(it.status) : '<span class="badge muted">-</span>'}</td>`;
                }).join("")}
              </tr>
            `).join("") || '<tr><td colspan="' + (5 + trainings.length) + '" class="empty">No matching records found for selected filters.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } else if (tab === 'status') {
    $("rptExportBtn").innerText = "📥 Export Training Status CSV";
    let statusRows = [];
    employees.forEach(e => {
      const rawEmp = reportsDataCache.employees.find(rE => String(rE.id) === String(e.id));
      const targetItems = ($("rptFilterStatus")?.value !== "ALL" || $("rptFilterTraining")?.value !== "ALL") ? e.items : (rawEmp ? rawEmp.items : e.items);

      targetItems.forEach(it => {
        statusRows.push({
          empId: e.empId,
          name: e.name,
          dept: e.department,
          trainingTitle: it.trainingTitle,
          status: it.status,
          completionDate: it.completionDate ? new Date(it.completionDate).toLocaleDateString("en-IN") : "-",
          expiryDate: it.expiryDate ? new Date(it.expiryDate).toLocaleDateString("en-IN") : "-"
        });
      });
    });

    container.innerHTML = `
      <h4 style="margin-top:0;margin-bottom:12px">Report Preview — Training Status (${statusRows.length} Items)</h4>
      <div class="tablewrap" style="overflow-x:auto">
        <table class="table">
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Employee Name</th>
              <th>Department</th>
              <th>Training Requirement</th>
              <th>Status</th>
              <th>Completion Date</th>
              <th>Expiry Date</th>
            </tr>
          </thead>
          <tbody>
            ${statusRows.map(r => `
              <tr>
                <td><b>${esc(r.empId)}</b></td>
                <td>${esc(r.name)}</td>
                <td>${esc(r.dept)}</td>
                <td>${esc(r.trainingTitle)}</td>
                <td>${getBadge(r.status)}</td>
                <td>${esc(r.completionDate)}</td>
                <td>${esc(r.expiryDate)}</td>
              </tr>
            `).join("") || '<tr><td colspan="7" class="empty">No matching training status items found for selected filters.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } else if (tab === 'summary') {
    $("rptExportBtn").innerText = "📥 Export Training Summary CSV";
    const summaryRows = trainings.map(t => {
      let assigned = 0, complete = 0, pending = 0, expired = 0, missing = 0;
      reportsDataCache.employees.forEach(e => {
        const it = e.items.find(i => String(i.trainingId) === String(t.id));
        if (it) {
          assigned++;
          if (it.status === "COMPLETE" || it.status === "COMPLIANT") complete++;
          else if (it.status === "PENDING") pending++;
          else if (it.status === "EXPIRED") expired++;
          else if (it.status === "MISSING") missing++;
        }
      });

      const compPct = assigned > 0 ? Math.round((complete / assigned) * 100) : 0;
      return { title: t.title, assigned, complete, pending, expired, missing, compPct };
    });

    container.innerHTML = `
      <h4 style="margin-top:0;margin-bottom:12px">Report Preview — Training Requirements Summary (${summaryRows.length} Modules)</h4>
      <div class="tablewrap" style="overflow-x:auto">
        <table class="table">
          <thead>
            <tr>
              <th>Training Name</th>
              <th>Total Assigned</th>
              <th>Complete</th>
              <th>Pending</th>
              <th>Expired</th>
              <th>Missing</th>
              <th>Completion Rate</th>
            </tr>
          </thead>
          <tbody>
            ${summaryRows.map(s => `
              <tr>
                <td><b>${esc(s.title)}</b></td>
                <td>${s.assigned}</td>
                <td><b style="color:#2e7d32">${s.complete}</b></td>
                <td><b style="color:#ed6c02">${s.pending}</b></td>
                <td><b style="color:#d32f2f">${s.expired}</b></td>
                <td><b style="color:#c62828">${s.missing}</b></td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;background:#eee;height:8px;border-radius:4px;overflow:hidden;min-width:60px">
                      <div style="width:${s.compPct}%;background:${s.compPct===100?'#2e7d32':'#0288d1'};height:100%"></div>
                    </div>
                    <span style="font-size:12px;font-weight:bold">${s.compPct}%</span>
                  </div>
                </td>
              </tr>
            `).join("") || '<tr><td colspan="7" class="empty">No active training requirements available.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }
}

function exportSelectedReport() {
  if (!reportsDataCache) return alert("Report data is not ready.");

  const tab = reportsDataCache.activeTab;
  const { employees, trainings } = filterReportRecords();
  let csv = "";

  if (tab === 'emp') {
    csv += "Employee ID,Employee Name,Department,Designation,Company,Overall Progress %,Overall Status";
    trainings.forEach(t => { csv += `,"${t.title.replace(/"/g, '""')}"`; });
    csv += "\n";

    employees.forEach(e => {
      csv += `"${e.empId}","${e.name.replace(/"/g, '""')}","${e.department.replace(/"/g, '""')}","${e.designation.replace(/"/g, '""')}","${e.company.replace(/"/g, '""')}",${e.progressPct}%,"${e.overallStatus}"`;
      trainings.forEach(t => {
        const rawEmp = reportsDataCache.employees.find(rE => String(rE.id) === String(e.id));
        const it = rawEmp ? rawEmp.items.find(i => String(i.trainingId) === String(t.id)) : null;
        csv += `,"${it ? it.status : '-'}"`;
      });
      csv += "\n";
    });
  } else if (tab === 'status') {
    csv += "Employee ID,Employee Name,Department,Training Name,Status,Completion Date,Expiry Date\n";
    employees.forEach(e => {
      const rawEmp = reportsDataCache.employees.find(rE => String(rE.id) === String(e.id));
      const targetItems = ($("rptFilterStatus")?.value !== "ALL" || $("rptFilterTraining")?.value !== "ALL") ? e.items : (rawEmp ? rawEmp.items : e.items);

      targetItems.forEach(it => {
        const cDate = it.completionDate ? new Date(it.completionDate).toLocaleDateString("en-IN") : "-";
        const eDate = it.expiryDate ? new Date(it.expiryDate).toLocaleDateString("en-IN") : "-";
        csv += `"${e.empId}","${e.name.replace(/"/g, '""')}","${e.department.replace(/"/g, '""')}","${it.trainingTitle.replace(/"/g, '""')}","${it.status}","${cDate}","${eDate}"\n`;
      });
    });
  } else if (tab === 'summary') {
    csv += "Training Name,Total Assigned,Complete,Pending,Expired,Missing,Completion Rate %\n";
    trainings.forEach(t => {
      let assigned = 0, complete = 0, pending = 0, expired = 0, missing = 0;
      reportsDataCache.employees.forEach(e => {
        const it = e.items.find(i => String(i.trainingId) === String(t.id));
        if (it) {
          assigned++;
          if (it.status === "COMPLETE" || it.status === "COMPLIANT") complete++;
          else if (it.status === "PENDING") pending++;
          else if (it.status === "EXPIRED") expired++;
          else if (it.status === "MISSING") missing++;
        }
      });
      const compPct = assigned > 0 ? Math.round((complete / assigned) * 100) : 0;
      csv += `"${t.title.replace(/"/g, '""')}",${assigned},${complete},${pending},${expired},${missing},${compPct}%\n`;
    });
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `STLP_${tab.toUpperCase()}_Report_${Date.now()}.csv`;
  a.click();
}

async function exportProgressReport(){
  exportSelectedReport();
}

// Global cached dataset for History Log
let historyLogCache = null;
let historyCurrentPage = 1;
const HISTORY_PAGE_SIZE = 15;

async function history(){
  const admin = profile.role === "admin";

  let attQuery = sb.from("assessment_attempts").select("*, trainings(title), profiles(name, employee_id, username)").order("created_at", { ascending: false });
  // Note: training_progress has no defined FK relationship to profiles, so it cannot be embedded
  // in the select (that silently fails the whole query). User names are resolved below via profilesById instead.
  let progQuery = sb.from("training_progress").select("*, trainings(title)").order("created_at", { ascending: false });
  let trQuery = sb.from("trainings").select("*, profiles(name, employee_id)").order("updated_at", { ascending: false });
  let profQuery = sb.from("profiles").select("*").order("created_at", { ascending: false });

  if (!admin) {
    attQuery = attQuery.eq("user_id", profile.id);
    progQuery = progQuery.eq("user_id", profile.id);
    trQuery = trQuery.eq("created_by", profile.id);
    profQuery = profQuery.eq("id", profile.id);
  }

  const [attRes, progRes, trRes, profRes] = await Promise.all([
    attQuery,
    progQuery,
    trQuery,
    profQuery
  ]);

  const attempts = attRes.data || [];
  const progresses = progRes.data || [];
  const trainingsList = trRes.data || [];
  const profilesList = profRes.data || [];

  const profilesById = {};
  profilesList.forEach(pr => { if(pr.id) profilesById[String(pr.id).toLowerCase()] = pr; });

  let auditRecords = [];

  attempts.forEach(a => {
    const isPassed = a.passed === true || String(a.passed).toLowerCase() === 'true' || a.passed === 1;
    auditRecords.push({
      id: `att_${a.id}`,
      timestamp: new Date(a.created_at || Date.now()),
      user: a.profiles?.name ? `${a.profiles.name} (${a.profiles.employee_id || '-'})` : (a.user_id || "User"),
      action: "Assessment Submitted",
      module: "Assessments",
      target: a.trainings?.title || "Assessment Requirement",
      details: `Submitted score: ${a.score !== undefined ? a.score + '%' : 'N/A'}. ${isPassed ? 'Passed assessment requirements.' : 'Failed assessment threshold.'}`,
      status: isPassed ? "Success" : "Failed",
      raw: a
    });
  });

  progresses.forEach(p => {
    const isCompleted = p.status === 'completed' || String(p.status).toLowerCase() === 'completed';
    const pProfile = profilesById[String(p.user_id || "").toLowerCase()];
    auditRecords.push({
      id: `prog_${p.id}`,
      timestamp: new Date(p.created_at || Date.now()),
      user: pProfile?.name ? `${pProfile.name} (${pProfile.employee_id || '-'})` : (p.user_id || "User"),
      action: isCompleted ? "Training Completed" : "Training Started",
      module: "Training",
      target: p.trainings?.title || "Training Module",
      details: `Module status updated to '${p.status || 'in_progress'}'.`,
      status: "Success",
      raw: p
    });
  });

  trainingsList.forEach(t => {
    auditRecords.push({
      id: `tr_${t.id}`,
      timestamp: new Date(t.updated_at || t.created_at || Date.now()),
      user: t.profiles?.name ? `${t.profiles.name}` : "Admin",
      action: "Training Created / Modified",
      module: "Training",
      target: t.title || "Training Requirement",
      details: `Category: ${t.category || 'General'} | Duration: ${t.duration || 'N/A'} | Published: ${t.published ? 'Yes' : 'No'}`,
      status: "Success",
      raw: t
    });
  });

  profilesList.forEach(pr => {
    auditRecords.push({
      id: `prof_${pr.id}`,
      timestamp: new Date(pr.created_at || Date.now()),
      user: pr.role === 'admin' ? "System Admin" : "Admin / Excel Import",
      action: "Employee Account Created",
      module: "Users / Profiles",
      target: `${pr.name || 'User'} (${pr.employee_id || '-'})`,
      details: `Account registered for department '${pr.department || 'N/A'}' with designation '${pr.designation || 'N/A'}'. Active status: ${pr.active !== false ? 'Active' : 'Inactive'}.`,
      status: "Success",
      raw: pr
    });
  });

  auditRecords.sort((a, b) => b.timestamp - a.timestamp);

  const totalCount = auditRecords.length;
  const successCount = auditRecords.filter(r => r.status === "Success").length;
  const failedCount = auditRecords.filter(r => r.status === "Failed").length;

  historyLogCache = {
    allRecords: auditRecords,
    summary: { total: totalCount, success: successCount, failed: failedCount }
  };
  historyCurrentPage = 1;

  layout("history", "History Log", `
    <p class="muted">Audit Trail & System Activity History Log</p>
    
    <div class="grid" style="margin-bottom:20px">
      ${metric("Total Activities", historyLogCache.summary.total)}
      ${metric("Successful", historyLogCache.summary.success)}
      ${metric("Failed / Unsuccessful", historyLogCache.summary.failed)}
    </div>

    <div class="card" style="margin-bottom:16px;padding:16px">
      <h3 style="margin-top:0;margin-bottom:12px;font-size:16px">Audit Log Filters</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(170px, 1fr));gap:12px;align-items:end">
        <div>
          <label style="font-size:12px;font-weight:bold">Search Keyword</label>
          <input id="histSearch" placeholder="Search User, Target or Details..." oninput="renderHistoryLog(1)" style="width:100%;margin:4px 0 0">
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Action</label>
          <select id="histFilterAction" onchange="renderHistoryLog(1)" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Actions</option>
            <option value="Assessment Submitted">Assessment Submitted</option>
            <option value="Training Completed">Training Completed</option>
            <option value="Training Started">Training Started</option>
            <option value="Training Created / Modified">Training Created / Modified</option>
            <option value="Employee Account Created">Employee Account Created</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Module</label>
          <select id="histFilterModule" onchange="renderHistoryLog(1)" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Modules</option>
            <option value="Assessments">Assessments</option>
            <option value="Training">Training</option>
            <option value="Users / Profiles">Users / Profiles</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Status</label>
          <select id="histFilterStatus" onchange="renderHistoryLog(1)" style="width:100%;margin:4px 0 0">
            <option value="ALL">All Statuses</option>
            <option value="Success">Success</option>
            <option value="Failed">Failed</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Date From</label>
          <input type="date" id="histFilterDateFrom" onchange="renderHistoryLog(1)" style="width:100%;margin:4px 0 0">
        </div>
        <div>
          <label style="font-size:12px;font-weight:bold">Date To</label>
          <input type="date" id="histFilterDateTo" onchange="renderHistoryLog(1)" style="width:100%;margin:4px 0 0">
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px">
      <div id="historyTableContent"></div>
      <div id="historyPaginationContent" style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:8px"></div>
    </div>
  `);

  renderHistoryLog(1);
}

function renderHistoryLog(page = 1) {
  if (!historyLogCache) return;
  historyCurrentPage = page;

  const searchQ = ($("histSearch")?.value || "").toLowerCase().trim();
  const actionF = $("histFilterAction")?.value || "ALL";
  const moduleF = $("histFilterModule")?.value || "ALL";
  const statusF = $("histFilterStatus")?.value || "ALL";
  const dateFromVal = $("histFilterDateFrom")?.value || "";
  const dateToVal = $("histFilterDateTo")?.value || "";

  const dFrom = dateFromVal ? new Date(dateFromVal + "T00:00:00") : null;
  const dTo = dateToVal ? new Date(dateToVal + "T23:59:59") : null;

  let filtered = historyLogCache.allRecords.filter(r => {
    if (actionF !== "ALL" && r.action !== actionF) return false;
    if (moduleF !== "ALL" && r.module !== moduleF) return false;
    if (statusF !== "ALL" && r.status !== statusF) return false;

    if (dFrom && r.timestamp < dFrom) return false;
    if (dTo && r.timestamp > dTo) return false;

    if (searchQ) {
      const haystack = (r.user + " " + r.action + " " + r.module + " " + r.target + " " + r.details).toLowerCase();
      if (!haystack.includes(searchQ)) return false;
    }

    return true;
  });

  const totalFiltered = filtered.length;
  const totalPages = Math.ceil(totalFiltered / HISTORY_PAGE_SIZE) || 1;
  if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;

  const startIndex = (historyCurrentPage - 1) * HISTORY_PAGE_SIZE;
  const pageRecords = filtered.slice(startIndex, startIndex + HISTORY_PAGE_SIZE);

  const container = $("historyTableContent");
  const paginationContainer = $("historyPaginationContent");

  if (totalFiltered === 0) {
    container.innerHTML = `<div class="card empty" style="text-align:center;padding:30px">No activity history found.</div>`;
    paginationContainer.innerHTML = "";
    return;
  }

  const getBadge = (st) => {
    return st === "Success" 
      ? `<span class="badge g">✓ Success</span>` 
      : `<span class="badge r" style="background:#f8d7da;color:#721c24">✕ Failed</span>`;
  };

  container.innerHTML = `
    <div class="tablewrap" style="overflow-x:auto">
      <table class="table">
        <thead>
          <tr>
            <th style="white-space:nowrap">Date & Time</th>
            <th style="white-space:nowrap">User / Initiator</th>
            <th style="white-space:nowrap">Action</th>
            <th style="white-space:nowrap">Module</th>
            <th style="white-space:nowrap">Target / Employee</th>
            <th style="white-space:nowrap">Details</th>
            <th style="white-space:nowrap">Status</th>
            <th style="white-space:nowrap;text-align:center">Action</th>
          </tr>
        </thead>
        <tbody>
          ${pageRecords.map(r => `
            <tr>
              <td style="white-space:nowrap">${r.timestamp.toLocaleDateString("en-IN")} ${r.timestamp.toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'})}</td>
              <td><b>${esc(r.user)}</b></td>
              <td>${esc(r.action)}</td>
              <td><span class="badge muted">${esc(r.module)}</span></td>
              <td>${esc(r.target)}</td>
              <td style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.details)}">${esc(r.details)}</td>
              <td>${getBadge(r.status)}</td>
              <td style="text-align:center"><button class="btn light" style="padding:2px 8px;font-size:12px" onclick="viewActivityDetail('${r.id}')">View</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  paginationContainer.innerHTML = `
    <span class="muted" style="font-size:13px">Showing <b>${startIndex + 1}</b> - <b>${Math.min(startIndex + HISTORY_PAGE_SIZE, totalFiltered)}</b> of <b>${totalFiltered}</b> activities</span>
    <div style="display:flex;gap:6px">
      <button class="btn light" ${historyCurrentPage === 1 ? 'disabled style="opacity:0.5"' : ''} onclick="renderHistoryLog(${historyCurrentPage - 1})">Previous</button>
      <span class="chip" style="align-self:center">${historyCurrentPage} / ${totalPages}</span>
      <button class="btn light" ${historyCurrentPage === totalPages ? 'disabled style="opacity:0.5"' : ''} onclick="renderHistoryLog(${historyCurrentPage + 1})">Next</button>
    </div>
  `;
}

function viewActivityDetail(recordId) {
  if (!historyLogCache) return;
  const rec = historyLogCache.allRecords.find(r => r.id === recordId);
  if (!rec) return;

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal" style="max-width:550px">
        <h2>Activity Audit Detail</h2>
        <div class="card" style="margin:15px 0;background:#f8f9fa">
          <p><b>Date & Time:</b> ${rec.timestamp.toLocaleString("en-IN")}</p>
          <p><b>User / Initiator:</b> ${esc(rec.user)}</p>
          <p><b>Action:</b> ${esc(rec.action)}</p>
          <p><b>Module:</b> ${esc(rec.module)}</p>
          <p><b>Target:</b> ${esc(rec.target)}</p>
          <p><b>Status:</b> ${rec.status}</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:10px 0">
          <p><b>Details:</b></p>
          <p class="muted" style="white-space:pre-wrap;margin-top:4px">${esc(rec.details)}</p>
        </div>
        <div class="actions" style="justify-content:flex-end">
          <button class="btn light" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `);
}

function closeModal(){ $("modal")?.remove(); }

async function route(x){
  if(!configured) return loginPage();
  if(!profile) return start();
  return ({dash, users, train:training, notes:notifications, results:assessmentResults, progress, reports, history, feedback:feedbackPage}[x] || dash)();
}

(async()=>{
  if(configured){
    let r = await sb.auth.getSession();
    r.data.session ? start() : loginPage();
  } else loginPage();
})();

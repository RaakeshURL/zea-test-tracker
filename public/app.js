let testCases = [];
let results = {};
let openCards = new Set();
let saveTimers = {};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel = s => s === "NOT_APPLICABLE" ? "N/A" : s.replaceAll("_"," ");

let adminToken = "";
try { adminToken = sessionStorage.getItem("adminToken") || ""; } catch {}
function setAdminToken(t){
  adminToken = t || "";
  try { adminToken ? sessionStorage.setItem("adminToken", adminToken) : sessionStorage.removeItem("adminToken"); } catch {}
}
const isAdmin = () => !!adminToken;

async function api(url, options={}) {
  if (adminToken) options = {...options, headers:{...(options.headers||{}), "x-admin-token":adminToken}};
  const r = await fetch(url, options);
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
function toast(msg) {
  const t=$("#toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>t.classList.remove("show"),2200);
}
function currentStatus(id){ return (results[id]||{}).status || "NOT_TESTED"; }

function renderStats(){
  const counts={PASS:0,FAIL:0,NOT_TESTED:0,SKIPPED:0,NOT_APPLICABLE:0};
  testCases.forEach(c=>counts[currentStatus(c.id)]++);
  const total=testCases.length, done=total-counts.NOT_TESTED, rate=done?Math.round(counts.PASS/done*100):0, progress=total?Math.round(done/total*100):0;
  $("#stats").innerHTML = [
    ["Total",total],["Pass",counts.PASS],["Fail",counts.FAIL],["Pending",counts.NOT_TESTED],["Skipped",counts.SKIPPED],["N/A",counts.NOT_APPLICABLE]
  ].map(x=>`<div class="stat"><div class="num">${x[1]}</div><div class="label">${x[0]}</div></div>`).join("") +
  `<div class="stat" style="grid-column:1/-1"><b>Execution Progress: ${progress}%</b><div class="progress-wrap"><div class="progress" style="width:${progress}%"></div></div><div class="label" style="margin-top:8px">Pass Rate: ${rate}% of executed tests</div></div>`;
}
function fillModules(){
  const modules=[...new Set(testCases.map(c=>c.module))].sort();
  $("#moduleFilter").innerHTML='<option value="">All Modules</option>'+modules.map(m=>`<option>${esc(m)}</option>`).join("");
}
function filtered(){
  const q=$("#search").value.toLowerCase().trim(), m=$("#moduleFilter").value, d=$("#difficultyFilter").value, s=$("#statusFilter").value;
  return testCases.filter(c=>{
    const hay=[c.id,c.module,c.feature,c.title,c.description,c.expectedResult].join(" ").toLowerCase();
    return (!q||hay.includes(q))&&(!m||c.module===m)&&(!d||c.difficulty===d)&&(!s||currentStatus(c.id)===s);
  });
}
function render(){
  renderStats();
  const list=filtered();
  $("#resultCount").textContent=`Showing ${list.length} of ${testCases.length} test cases`;
  if(!list.length){$("#testList").innerHTML='<div class="empty">No test cases match the current filters.</div>';return;}
  $("#testList").innerHTML=list.map(c=>{
    const r=results[c.id]||{}, st=currentStatus(c.id), open=openCards.has(c.id);
    return `<article class="card ${open?'open':''}" data-id="${esc(c.id)}">
      <div class="card-head">
        <span class="id">${esc(c.id)}</span>
        <span class="title">${esc(c.title)}</span>
        <span class="meta">${esc(c.module)} · ${esc(c.difficulty)}</span>
        <span class="badge ${st}">${esc(statusLabel(st))}</span>
      </div>
      <div class="card-body">
        <div class="info-grid">
          <div class="info"><b>Module</b>${esc(c.module)}</div>
          <div class="info"><b>Feature</b>${esc(c.feature)}</div>
          <div class="info"><b>Difficulty</b>${esc(c.difficulty)}</div>
          <div class="info"><b>Priority</b>${esc(c.priority)}</div>
          <div class="info"><b>Severity</b>${esc(c.severity)}</div>
          <div class="info"><b>Test ID</b>${esc(c.id)}</div>
        </div>
        <p><b>Description:</b> ${esc(c.description)}</p>
        <p><b>Preconditions:</b></p><ul>${c.preconditions.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
        <p><b>Steps:</b></p><ol class="steps">${c.steps.map(x=>`<li>${esc(x)}</li>`).join("")}</ol>
        <div class="expected"><b>Expected Result</b><br>${esc(c.expectedResult)}</div>
        <div class="status-buttons">
          <button class="status-btn pass" data-action="status" data-status="PASS">✓ PASS</button>
          <button class="status-btn fail" data-action="status" data-status="FAIL">✕ FAIL</button>
          <button class="status-btn skip" data-action="status" data-status="SKIPPED">⏭ SKIP</button>
          <button class="status-btn na" data-action="status" data-status="NOT_APPLICABLE">N/A</button>
        </div>
        <div class="fields">
          <div class="field full"><label>Actual Result</label><textarea data-field="actualResult">${esc(r.actualResult)}</textarea></div>
          <div class="field full"><label>Remarks</label><textarea data-field="remarks">${esc(r.remarks)}</textarea></div>
          <div class="field full"><label>Steps to Reproduce / Bug Details</label><textarea data-field="stepsToReproduce">${esc(r.stepsToReproduce)}</textarea></div>
          <div class="field"><label>Bug ID</label><input data-field="bugId" value="${esc(r.bugId)}"></div>
          <div class="field"><label>Severity</label><select data-field="severity">${["","Critical","High","Medium","Low"].map(v=>`<option ${r.severity===v?"selected":""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>Priority</label><select data-field="priority">${["","High","Medium","Low"].map(v=>`<option ${r.priority===v?"selected":""}>${v}</option>`).join("")}</select></div>
          <div class="field full"><label>Evidence / Screenshots</label>
            <div class="evidence">
              <input type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" multiple data-upload>
              <div class="evidence-list">${(r.evidence||[]).map(p=>`<a href="/${encodeURI(p)}" target="_blank"><img class="thumb" src="/${encodeURI(p)}"></a>`).join("")}</div>
            </div>
          </div>
        </div>
        <div class="save-row"><span class="save-state">Last tested: ${esc(r.testedAt ? new Date(r.testedAt).toLocaleString() : "Not yet")}</span><button class="save" data-action="save">Save</button></div>
        ${isAdmin()?`<div class="admin-row"><button class="secondary" data-action="edit-case">Edit Test Case</button><button class="danger" data-action="delete-case">Delete Test Case</button></div>`:""}
      </div>
    </article>`;
  }).join("");
}
function collect(card){
  const id=card.dataset.id, old=results[id]||{};
  const obj={...old};
  card.querySelectorAll("[data-field]").forEach(el=>obj[el.dataset.field]=el.value);
  obj.status=currentStatus(id);
  obj.evidence=old.evidence||[];
  return obj;
}
async function saveCard(card, silent=false){
  const id=card.dataset.id, obj=collect(card);
  if(obj.status==="FAIL" && !obj.actualResult.trim() && !silent){
    toast("Enter the actual result for a failed test.");
    return;
  }
  obj.testedAt=new Date().toISOString();
  try{
    const data=await api(`/api/results/${encodeURIComponent(id)}`,{
      method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(obj)
    });
    results[id]=data.result;
    render();
    openCards.add(id);
    if(!silent) toast("Saved to execution-results.json");
  }catch(e){toast(e.message);}
}
function scheduleSave(card){
  const id=card.dataset.id;
  clearTimeout(saveTimers[id]);
  saveTimers[id]=setTimeout(()=>saveCard(card,true),600);
}
document.addEventListener("click", async e=>{
  const card=e.target.closest(".card");
  if(card && e.target.closest(".card-head")){
    const id=card.dataset.id;
    openCards.has(id)?openCards.delete(id):openCards.add(id); render(); return;
  }
  if(!card) return;
  const status=e.target.closest("[data-action=status]");
  if(status){
    const id=card.dataset.id;
    results[id]={...(results[id]||{}),status:status.dataset.status,evidence:(results[id]||{}).evidence||[]};
    openCards.add(id); render();
    const fresh=document.querySelector(`.card[data-id="${id}"]`);
    await saveCard(fresh,true);
    toast("Status saved");
    return;
  }
  if(e.target.closest("[data-action=save]")) await saveCard(card);
  if(e.target.closest("[data-action=edit-case]")) openCaseForm(testCases.find(c=>c.id===card.dataset.id));
  if(e.target.closest("[data-action=delete-case]")){
    const id=card.dataset.id;
    if(!confirm(`Delete ${id} and its execution result? A backup of the test case list is created first.`)) return;
    try{
      await api(`/api/test-cases/${encodeURIComponent(id)}`,{method:"DELETE"});
      testCases=testCases.filter(c=>c.id!==id); delete results[id]; openCards.delete(id);
      fillModules(); render(); toast(`${id} deleted`);
    }catch(err){handleAdminError(err);}
  }
});
document.addEventListener("input",e=>{
  if(e.target.matches("[data-field]")) scheduleSave(e.target.closest(".card"));
});
document.addEventListener("change",async e=>{
  if(e.target.matches("[data-field]")) scheduleSave(e.target.closest(".card"));
  if(e.target.matches("[data-upload]")){
    const card=e.target.closest(".card"), id=card.dataset.id, files=[...e.target.files];
    for(const file of files){
      const fd=new FormData(); fd.append("evidence",file);
      try{
        const data=await api("/api/upload-evidence",{method:"POST",body:fd});
        results[id]={...(results[id]||{}),evidence:[...((results[id]||{}).evidence||[]),data.path]};
      }catch(err){toast(err.message);}
    }
    await saveCard(card,true); render(); openCards.add(id); toast("Evidence uploaded");
  }
});
["search","moduleFilter","difficultyFilter","statusFilter"].forEach(id=>$( "#"+id).addEventListener("input",render));
$("#clearFilters").onclick=()=>{$("#search").value="";$("#moduleFilter").value="";$("#difficultyFilter").value="";$("#statusFilter").value="";render();};
$("#backupBtn").onclick=async()=>{try{const d=await api("/api/backup",{method:"POST"});toast(`Backup created: ${d.file}`)}catch(e){toast(e.message)}};
$("#resetBtn").onclick=async()=>{
  if(!confirm("Reset ALL execution results? A backup will be created first.")) return;
  try{await api("/api/reset-results",{method:"POST"});results={};openCards.clear();render();toast("All results reset. Backup created.");}catch(e){toast(e.message)}
};
// ---------- Admin ----------
function updateAdminUi(){
  $("#adminTools").hidden=!isAdmin();
  $("#adminBtn").textContent=isAdmin()?"Admin Logout":"Admin Login";
  render();
}
function handleAdminError(err){
  if(/Admin login required/.test(err.message)){ setAdminToken(""); updateAdminUi(); toast("Admin session expired. Log in again."); }
  else toast(err.message);
}
$("#adminBtn").onclick=async()=>{
  if(isAdmin()){
    try{await api("/api/admin/logout",{method:"POST"});}catch{}
    setAdminToken(""); updateAdminUi(); toast("Logged out"); return;
  }
  const password=prompt("Admin password:");
  if(!password) return;
  try{
    const d=await api("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});
    setAdminToken(d.token); updateAdminUi(); toast("Admin mode enabled");
  }catch(e){toast(e.message);}
};

const FORM_OPTIONS={
  difficulty:["Beginner","Intermediate","Advanced","Expert"],
  priority:["High","Medium","Low"],
  severity:["Critical","High","Medium","Low"]
};
function closeModal(){ $("#modal").hidden=true; $("#modalForm").innerHTML=""; $("#modalForm").onsubmit=null; }
function openCaseForm(tc){
  const editing=!!tc; tc=tc||{difficulty:"Beginner",priority:"Medium",severity:"Medium"};
  const input=(name,label,full)=>`<div class="field ${full?"full":""}"><label>${label}</label><input name="${name}" value="${esc(tc[name])}"></div>`;
  const area=(name,label,val)=>`<div class="field full"><label>${label}</label><textarea name="${name}">${esc(val)}</textarea></div>`;
  const select=name=>`<div class="field"><label>${name[0].toUpperCase()+name.slice(1)}</label><select name="${name}">${FORM_OPTIONS[name].map(o=>`<option ${tc[name]===o?"selected":""}>${o}</option>`).join("")}</select></div>`;
  const form=$("#modalForm");
  form.innerHTML=`<h2>${editing?`Edit ${esc(tc.id)}`:"Add Test Case"}</h2>
    <div class="fields">
      <div class="field"><label>Test ID ${editing?"":"(blank = auto)"}</label><input name="id" value="${esc(tc.id)}" ${editing?"readonly":""}></div>
      ${input("module","Module *")}${input("feature","Feature")}${input("title","Title *")}
      ${area("description","Description",tc.description)}
      ${area("preconditions","Preconditions (one per line)",(tc.preconditions||[]).join("\n"))}
      ${area("steps","Steps (one per line)",(tc.steps||[]).join("\n"))}
      ${area("expectedResult","Expected Result",tc.expectedResult)}
      ${select("difficulty")}${select("priority")}${select("severity")}
    </div>
    <div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">${editing?"Save Changes":"Create"}</button></div>`;
  form.querySelector("[data-close]").onclick=closeModal;
  form.onsubmit=async e=>{
    e.preventDefault();
    const body=Object.fromEntries(new FormData(form));
    try{
      const d=await api(editing?`/api/test-cases/${encodeURIComponent(tc.id)}`:"/api/test-cases",{
        method:editing?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(editing) testCases=testCases.map(c=>c.id===tc.id?d.testCase:c); else testCases.push(d.testCase);
      openCards.add(d.testCase.id); closeModal(); fillModules(); render(); toast(editing?"Test case updated":`${d.testCase.id} created`);
    }catch(err){handleAdminError(err);}
  };
  $("#modal").hidden=false;
}
$("#addCaseBtn").onclick=()=>openCaseForm();
$("#modal").addEventListener("mousedown",e=>{ if(e.target.id==="modal") closeModal(); });

$("#importBtn").onclick=()=>$("#importFile").click();
$("#importFile").onchange=async e=>{
  const file=e.target.files[0]; e.target.value="";
  if(!file) return;
  const mode=await new Promise(resolve=>{
    const form=$("#modalForm");
    form.innerHTML=`<h2>Import "${esc(file.name)}"</h2>
      <p><b>Add to existing</b> (recommended): keeps your current test cases. Rows with an existing Test ID are updated; all other rows are added.</p>
      <p><b>Replace all</b>: deletes every current test case and uses only this file. A backup is made first.</p>
      <div class="modal-actions">
        <button type="button" class="secondary" data-mode="">Cancel</button>
        <button type="button" class="danger" data-mode="replace">Replace all</button>
        <button type="button" class="primary" data-mode="merge">Add to existing</button>
      </div>`;
    form.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{closeModal();resolve(b.dataset.mode);});
    $("#modal").hidden=false;
  });
  if(!mode) return;
  const fd=new FormData(); fd.append("file",file); fd.append("mode",mode);
  try{
    const d=await api("/api/test-cases/import",{method:"POST",body:fd});
    testCases=await api("/api/test-cases");
    fillModules(); render();
    const form=$("#modalForm");
    form.innerHTML=`<h2>Import complete</h2>
      <p>Mode: <b>${esc(d.mode)}</b> · Added: <b>${d.added}</b> · Updated: <b>${d.updated}</b> · Skipped: <b>${d.skipped}</b></p>
      ${d.errors.length?`<div class="import-result">${d.errors.map(esc).join("<br>")}</div>`:""}
      <p class="save-state">Previous list backed up to ${esc(d.backup)}</p>
      <div class="modal-actions"><button type="button" class="primary" data-close>Close</button></div>`;
    form.querySelector("[data-close]").onclick=closeModal;
    $("#modal").hidden=false;
  }catch(err){handleAdminError(err);}
};

document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && !$("#modal").hidden) closeModal();
  const tag=document.activeElement?.tagName;
  if(["INPUT","TEXTAREA","SELECT"].includes(tag)) return;
  if(e.ctrlKey && e.key.toLowerCase()==="k"){e.preventDefault();$("#search").focus();}
});

(async function init(){
  try{
    [testCases,results]=await Promise.all([api("/api/test-cases"),api("/api/results")]);
    if(adminToken){ const s=await api("/api/admin/status").catch(()=>({})); if(!s.admin) setAdminToken(""); }
    $("#adminTools").hidden=!isAdmin(); $("#adminBtn").textContent=isAdmin()?"Admin Logout":"Admin Login";
    fillModules();render();
  }catch(e){$("#testList").innerHTML=`<div class="empty">Could not load application data: ${esc(e.message)}</div>`;}
})();

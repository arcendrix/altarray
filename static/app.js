const state = { role: null, customers: [], jobs: [], estimates: [], invoices: [], view: "overview", weekOffset: 0 };
const labels = { admin: "Administrator", dispatcher: "Dispatcher", technician: "Technician", office: "Office" };
const canWrite = { admin: ["customers", "jobs", "estimates", "invoices"], dispatcher: ["customers", "jobs"], technician: ["jobs"], office: ["customers", "estimates", "invoices"] };
const $ = (s) => document.querySelector(s);
const money = (v) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(v || 0));
const localYmd = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const customer = (id) => state.customers.find(c => c.id === id)?.name || "Unassigned customer";
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...options });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}
function toast(text, bad = false) { const el = $("#toast"); el.textContent = text; el.classList.toggle("bad", bad); el.classList.remove("hidden"); setTimeout(() => el.classList.add("hidden"), 3200); }
function setupRole() { $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#role-label").textContent = labels[state.role]; document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("hidden", state.role === "technician" && ["estimates", "invoices"].includes(el.dataset.view))); document.querySelectorAll("[data-create]").forEach(el => el.classList.toggle("hidden", !(canWrite[state.role] || []).includes(el.dataset.create))); navigate(state.view); }
async function load() {
  const resources = ["customers", "jobs", "estimates", "invoices"];
  for (const key of resources) { try { state[key] = await api(key); } catch { state[key] = []; } }
  render();
}
function badge(text) { return `<span class="badge ${String(text).toLowerCase().replaceAll(" ", "-")}"><i></i>${esc(text || "Draft")}</span>`; }
function renderWeek() {
  const monday = new Date(); monday.setHours(0,0,0,0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + state.weekOffset * 7);
  const days = Array.from({length:5}, (_,i) => { const d=new Date(monday); d.setDate(monday.getDate()+i); return d; });
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  $("#week-label").textContent = `${days[0].toLocaleDateString("en-CA",{month:"short",day:"numeric"})} – ${days[4].toLocaleDateString("en-CA",{month:"short",day:"numeric",year:"numeric"})}`;
  const techs = [...new Set(state.jobs.map(j=>j.technician).filter(Boolean))].sort();
  if (!techs.length) techs.push("No technicians assigned");
  techs.push("Unassigned");
  $("#week-grid").innerHTML = `<div class="week-cell week-corner">TEAM</div>${days.map(d=>`<div class="week-cell week-day"><b>${d.toLocaleDateString("en-CA",{weekday:"short"}).toUpperCase()}</b><span>${d.toLocaleDateString("en-CA",{month:"short",day:"numeric"})}</span></div>`).join("")}${techs.map(tech=>`<div class="week-cell week-tech"><b>${esc(tech)}</b><span>${tech==="Unassigned"?state.jobs.filter(j=>!j.technician).length:state.jobs.filter(j=>j.technician===tech).length} jobs</span></div>${days.map(d=>{const dayJobs=state.jobs.filter(j=>j.scheduled_for===iso(d)&&(tech==="Unassigned"?!j.technician:j.technician===tech));return `<div class="week-cell week-slot">${dayJobs.map(j=>`<div class="week-job ${String(j.status).toLowerCase().replaceAll(" ","-")}"><b>${esc(j.window||"Flexible")}</b><span>${esc(j.title)}</span><small>${esc(customer(j.customer_id))}</small></div>`).join("")||`<span class="slot-empty">—</span>`}</div>`}).join("")}`).join("")}`;
}
function render() {
  const today = new Date();
  $("#today").textContent = today.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  $("#welcome-line").textContent = today.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
  const todayKey = localYmd(today), monthKey = todayKey.slice(0,7);
  $("#metric-jobs").textContent = state.jobs.filter(j => j.scheduled_for === todayKey && j.status !== "Cancelled").length;
  $("#metric-estimates").textContent = state.estimates.filter(e => ["Draft", "Sent"].includes(e.status)).length;
  $("#metric-invoices").textContent = money(state.invoices.filter(i => i.status !== "Paid").reduce((a, i) => a + Number(i.amount), 0));
  $("#metric-revenue").textContent = money(state.invoices.filter(i => i.status === "Paid" && (i.paid_at || "").slice(0,7) === monthKey).reduce((a, i) => a + Number(i.amount), 0));
  $("#jobs-count").textContent = state.jobs.filter(j => j.status !== "Completed" && j.status !== "Cancelled").length;
  const scheduled = [...state.jobs].sort((a,b) => `${a.scheduled_for}${a.window}`.localeCompare(`${b.scheduled_for}${b.window}`));
  $("#schedule-list").innerHTML = scheduled.slice(0, 4).map(j => `<div class="schedule-row"><div class="time-tag">${esc(j.window || "Flexible")}</div><span class="timeline-dot"></span><div class="schedule-info"><b>${esc(j.title)}</b><p>${esc(customer(j.customer_id))} · ${esc(j.technician || "Unassigned")}</p></div>${badge(j.status)}</div>`).join("") || `<div class="empty">No jobs scheduled yet.</div>`;
  $("#upcoming-table").innerHTML = scheduled.slice(0, 5).map(j => `<tr><td><b>${esc(j.title)}</b><small>JOB-${String(j.id).padStart(4,"0")}</small></td><td>${esc(customer(j.customer_id))}</td><td>${esc(j.technician || "Unassigned")}</td><td>${esc(j.scheduled_for || "Not scheduled")}<small>${esc(j.window || "")}</small></td><td>${badge(j.status)}</td><td>${(canWrite[state.role]||[]).includes("jobs")?`<button class="text-button" data-edit-job="${j.id}">Edit</button>`:""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Create your first job to fill the schedule.</td></tr>`;
  const term = (id) => $(`#${id}`)?.value?.toLowerCase() || "";
  $("#customers-table").innerHTML = state.customers.filter(c => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(term("customer-search"))).map(c => `<tr><td><span class="person"><span class="avatar mini">${esc(c.name.split(" ").map(x=>x[0]).slice(0,2).join(""))}</span><b>${esc(c.name)}</b></span></td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td><td>${esc(c.address)}</td><td>${esc((c.created_at||"").slice(0,10))}</td><td>${(canWrite[state.role]||[]).includes("customers")?`<button class="text-button" data-edit-customer="${c.id}">Edit</button>`:""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No customers match your search.</td></tr>`;
  $("#jobs-table").innerHTML = state.jobs.filter(j => `${j.title} ${customer(j.customer_id)} ${j.technician}`.toLowerCase().includes(term("job-search")) && (!$(`#job-filter`).value || j.status === $("#job-filter").value)).map(j => `<tr><td><b>${esc(j.title)}</b><small>JOB-${String(j.id).padStart(4,"0")}</small></td><td>${esc(customer(j.customer_id))}</td><td>${esc(j.technician || "Unassigned")}</td><td>${esc(j.scheduled_for || "Not scheduled")}<small>${esc(j.window)}</small></td><td>${badge(j.priority || "Normal")}</td><td>${(canWrite[state.role]||[]).includes("jobs")?`<select class="status-select" data-status="jobs:${j.id}">${["Scheduled","In progress","Completed","Cancelled"].map(x=>`<option ${j.status===x?"selected":""}>${x}</option>`).join("")}</select>`:badge(j.status)}</td><td>${(canWrite[state.role]||[]).includes("jobs")?`<button class="text-button" data-edit-job="${j.id}">Edit</button>`:""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No jobs found.</td></tr>`;
  $("#estimates-table").innerHTML = state.estimates.filter(e => `${customer(e.customer_id)} ${e.description}`.toLowerCase().includes(term("estimate-search"))).map(e => `<tr><td><b>EST-${String(e.id).padStart(4,"0")}</b></td><td>${esc(customer(e.customer_id))}</td><td>${esc(e.description)}</td><td><b>${money(e.amount)}</b></td><td>${esc(e.valid_until || "—")}</td><td>${(canWrite[state.role]||[]).includes("estimates")&&e.status!=="Invoiced"?`<select class="status-select" data-status="estimates:${e.id}">${["Draft","Sent","Approved","Declined"].map(x=>`<option ${e.status===x?"selected":""}>${x}</option>`).join("")}</select>`:badge(e.status)}</td><td>${e.status==="Approved"&&(canWrite[state.role]||[]).includes("invoices")?`<button class="text-button" data-convert-estimate="${e.id}">Create invoice →</button>`:""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No estimates found.</td></tr>`;
  $("#invoices-table").innerHTML = state.invoices.filter(i => `${customer(i.customer_id)} ${i.status}`.toLowerCase().includes(term("invoice-search"))).map(i => `<tr><td><b>INV-${String(i.id).padStart(4,"0")}</b><small>${i.paid_at?`Paid ${esc(i.paid_at.slice(0,10))}`:""}</small></td><td>${esc(customer(i.customer_id))}</td><td>${i.job_id ? `JOB-${String(i.job_id).padStart(4,"0")}` : "—"}</td><td><b>${money(i.amount)}</b></td><td>${esc(i.due_date || "—")}</td><td>${badge(i.status)}</td><td>${i.status!=="Paid"&&(canWrite[state.role]||[]).includes("invoices")?`<button class="text-button" data-invoice-payment="${i.id}">Mark paid</button>`:""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No invoices found.</td></tr>`;
  renderWeek();
}
function navigate(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach(el => el.classList.toggle("hidden", el.id !== view));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  const titles = { overview: ["Overview", "Good morning, Alex", "Here’s your service operation at a glance."], jobs: ["Dispatch", "Dispatch board", "Schedule and track work across your team."], customers: ["Customers", "Customer directory", "Keep every customer detail in one place."], estimates: ["Estimates", "Estimates", "Prepare and follow up on service proposals."], invoices: ["Invoices", "Invoices", "Track billing and payment status."] };
  $("#crumb").textContent = titles[view][0]; $("#page-title").textContent = titles[view][1]; $("#page-subtitle").textContent = titles[view][2];
  $("#primary-action span").textContent = view === "customers" ? "New customer" : view === "estimates" ? "New estimate" : view === "invoices" ? "New invoice" : "New job";
  $("#primary-action").classList.toggle("hidden", !(canWrite[state.role] || []).includes(view === "overview" ? "jobs" : view));
}
function openForm(resource, record = null) {
  const selects = (name, rows) => `<label>${name}<select name="${name === "Customer" ? "customer_id" : "job_id"}">${rows.map(r=>`<option value="${r.id}">${esc(r.name || r.title)}</option>`).join("")}</select></label>`;
  const fields = {
    customers: `<label>Customer name *<input name="name" required placeholder="e.g. Taylor Morgan"></label><div class="field-row"><label>Phone<input name="phone" placeholder="(416) 555-0100"></label><label>Email<input name="email" type="email" placeholder="name@example.com"></label></div><label>Service address<input name="address" placeholder="Street, city, postal code"></label><label>Notes<textarea name="notes" placeholder="Access details or preferences"></textarea></label>`,
    jobs: `${selects("Customer",state.customers)}<label>Job title *<input name="title" required placeholder="e.g. Annual furnace service"></label><div class="field-row"><label>Technician<input name="technician" placeholder="Assign a technician"></label><label>Priority<select name="priority"><option>Normal</option><option>High</option><option>Urgent</option></select></label></div><div class="field-row"><label>Date<input name="scheduled_for" type="date"></label><label>Time window<input name="window" placeholder="9:00–11:00"></label></div><label>Notes<textarea name="notes" placeholder="Job details"></textarea></label>`,
    estimates: `${selects("Customer",state.customers)}${selects("Job",[{id:"",title:"No linked job"},...state.jobs])}<label>Description *<input name="description" required placeholder="Service or materials"></label><div class="field-row"><label>Amount (CAD) *<input name="amount" type="number" min="0" step="0.01" required></label><label>Valid until<input name="valid_until" type="date"></label></div>`,
    invoices: `${selects("Customer",state.customers)}${selects("Job",[{id:"",title:"No linked job"},...state.jobs])}<div class="field-row"><label>Amount (CAD) *<input name="amount" type="number" min="0" step="0.01" required></label><label>Due date<input name="due_date" type="date"></label></div>`
  };
  if (["jobs","estimates","invoices"].includes(resource) && !state.customers.length) return toast("Add a customer first.", true);
  $("#dialog-title").textContent = `${record ? "Edit" : "New"} ${resource.slice(0,-1)}`; $("#form-fields").innerHTML = fields[resource]; $("#record-dialog").dataset.resource = resource; $("#record-dialog").dataset.recordId = record?.id || "";
  if (record) for (const [key, value] of Object.entries(record)) { const input = $(`#form-fields [name="${key}"]`); if (input && value != null) input.value = value; }
  $("#record-dialog").showModal();
}
document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => navigate(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.go)));
document.querySelectorAll("[data-create]").forEach(b => b.addEventListener("click", () => openForm(b.dataset.create)));
$("#primary-action").addEventListener("click", () => openForm(({ overview:"jobs", jobs:"jobs", customers:"customers", estimates:"estimates", invoices:"invoices" })[state.view]));
$("#record-form").addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const form = new FormData(event.currentTarget), payload = Object.fromEntries(form.entries()), resource = $("#record-dialog").dataset.resource;
  for (const key of ["customer_id","job_id"]) if (payload[key]) payload[key] = Number(payload[key]); else if (key === "job_id") payload[key] = null;
  const recordId = $("#record-dialog").dataset.recordId;
  try { await api(recordId ? `${resource}/${recordId}` : resource, { method:recordId ? "PATCH" : "POST", body:JSON.stringify(payload) }); $("#record-dialog").close(); event.currentTarget.reset(); $("#record-dialog").dataset.recordId = ""; await load(); toast(recordId ? "Changes saved." : "Record created successfully."); } catch (e) { toast(e.message, true); }
});
document.addEventListener("change", async (event) => { if (!event.target.matches("[data-status]")) return; const [resource,id] = event.target.dataset.status.split(":"); try { await api(`${resource}/${id}`, {method:"PATCH",body:JSON.stringify({status:event.target.value})}); await load(); toast("Status updated."); } catch(e) { toast(e.message,true); await load(); } });
document.addEventListener("click", async (event) => {
  const customerEdit = event.target.closest("[data-edit-customer]");
  if (customerEdit) return openForm("customers", state.customers.find(c => c.id === Number(customerEdit.dataset.editCustomer)));
  const jobEdit = event.target.closest("[data-edit-job]");
  if (jobEdit) return openForm("jobs", state.jobs.find(j => j.id === Number(jobEdit.dataset.editJob)));
  const payment = event.target.closest("[data-invoice-payment]");
  if (payment) { payment.disabled = true; try { await api(`invoices/${payment.dataset.invoicePayment}/payment`, {method:"POST",body:JSON.stringify({})}); await load(); toast("Payment recorded."); } catch(e) { toast(e.message,true); await load(); } return; }
});
["customer-search","job-search","estimate-search","invoice-search","job-filter"].forEach(id=>document.getElementById(id).addEventListener("input",render));
$("#logout").addEventListener("click",async()=>{await api("logout",{method:"POST"});state.role=null;$("#app").classList.add("hidden");$("#login").classList.remove("hidden");});
document.querySelectorAll("[data-role]").forEach(button=>button.addEventListener("click",async()=>{try{const data=await api("session",{method:"POST",body:JSON.stringify({role:button.dataset.role})});state.role=data.role;setupRole();await load();}catch(e){toast(e.message,true);}}));
$("#previous-week").addEventListener("click",()=>{state.weekOffset--;renderWeek();});
$("#next-week").addEventListener("click",()=>{state.weekOffset++;renderWeek();});
document.addEventListener("click",async(event)=>{const button=event.target.closest("[data-convert-estimate]");if(!button)return;button.disabled=true;try{await api(`estimates/${button.dataset.convertEstimate}/invoice`,{method:"POST",body:JSON.stringify({})});await load();navigate("invoices");toast("Invoice created from approved estimate.");}catch(e){button.disabled=false;toast(e.message,true);}});
(async()=>{const session=await api("session");if(session.role){state.role=session.role;setupRole();await load();}else $("#login").classList.remove("hidden");})();


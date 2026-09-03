// ============================================================
// STLP Certificates Module — certificates.js
// Isolated, additive module. Does NOT modify any function in app.js.
// Phase: Certificate Format Designer — Upload Template (Admin only).
// No drag-and-drop canvas, no employee photo, no QR code in this module.
// ============================================================

const CERT_TEMPLATE_BUCKET = "certificate_templates";

let _certTemplatesCache = [];

// Entry point wired from app.js route dispatcher: certificates: certificatesPage
async function certificatesPage(){
  const admin = profile.role === "admin";
  if(!admin){
    return layout("certificates", "My Certificates", `
      <div class="card">
        <p class="muted">Your certificates will appear here once this section is enabled. Please check back soon.</p>
      </div>
    `);
  }
  return certificateTemplatesTab();
}

async function certificateTemplatesTab(){
  const [tplRes, trainRes] = await Promise.all([
    sb.from("certificate_templates").select("*").order("created_at",{ascending:false}),
    sb.from("trainings").select("id,title").order("title")
  ]);

  if(tplRes.error){
    return layout("certificates","Certificates",`<div class="card"><b>Error:</b> ${esc(tplRes.error.message)}</div>`);
  }

  const templates = tplRes.data || [];
  const trainingsList = trainRes.data || [];
  _certTemplatesCache = templates;
  window._certTrainingsCache = trainingsList;

  const trainingName = (id) => trainingsList.find(t=>t.id===id)?.title || "";

  const rows = templates.length ? templates.map(tpl => `
    <tr>
      <td>${esc(tpl.template_name)}</td>
      <td>${tpl.training_id ? esc(trainingName(tpl.training_id)) : '<span class="muted">Reusable (any training)</span>'}</td>
      <td>${esc((tpl.template_type||"").toUpperCase())}</td>
      <td>${esc(tpl.orientation||"-")} / ${esc(tpl.page_size||"-")}</td>
      <td>${tpl.is_default ? '<span class="badge o">Default</span>' : ""}</td>
      <td>${tpl.created_at ? new Date(tpl.created_at).toLocaleString("en-IN") : "-"}</td>
      <td>
        <button class="btn light" onclick="previewCertificateTemplate('${tpl.id}')">Preview</button>
        <button class="btn light" style="color:#d32f2f" onclick="deleteCertificateTemplate('${tpl.id}')">Delete</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty">No certificate templates uploaded yet.</td></tr>`;

  return layout("certificates", "Certificates", `
    <div class="card" style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h3 style="margin:0 0 4px">Certificate Format Designer</h3>
          <p class="muted" style="margin:0">Upload a certificate background (PDF, JPG or PNG) that trainings can use to generate certificates.</p>
        </div>
        <button class="btn blue" id="certificate-generate-btn" onclick="openUploadCertificateTemplateModal()">⬆️ Upload Certificate Template</button>
      </div>
    </div>

    <div class="tablewrap">
      <table class="table">
        <thead>
          <tr>
            <th>Template Name</th>
            <th>Training</th>
            <th>Type</th>
            <th>Orientation / Size</th>
            <th>Default</th>
            <th>Uploaded</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
}

function openUploadCertificateTemplateModal(){
  const trainingsList = window._certTrainingsCache || [];

  document.body.insertAdjacentHTML("beforeend", `
    <div class="modalbg" id="modal">
      <div class="modal">
        <h2>Upload Certificate Template</h2>
        <div class="formgrid">
          <div class="fullfield"><label>Template Name *</label><input id="ctname" placeholder="e.g. Safety Training Certificate"></div>

          <div class="fullfield">
            <label>Applies To</label>
            <select id="cttraining">
              <option value="">Reusable — not tied to a specific training</option>
              ${trainingsList.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Orientation</label>
            <select id="ctorient">
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>
          <div>
            <label>Page Size</label>
            <select id="ctpagesize">
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
          </div>

          <div class="fullfield" style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="ctdefault" style="width:auto">
            <label style="margin:0" for="ctdefault">Set as Default Template</label>
          </div>

          <div class="fullfield">
            <label>Template File * (PDF, JPG or PNG)</label>
            <input id="ctfile" type="file" accept=".pdf,.jpg,.jpeg,.png">
          </div>
        </div>
        <div class="actions" style="margin-top:15px">
          <button class="btn blue" id="ctSaveBtn" onclick="saveCertificateTemplate()">Save Template</button>
          <button class="btn light" onclick="closeModal()">Cancel</button>
        </div>
      </div>
    </div>
  `);
}

async function saveCertificateTemplate(){
  const name = $("ctname").value.trim();
  const trainingId = $("cttraining").value || null;
  const orientation = $("ctorient").value;
  const pageSize = $("ctpagesize").value;
  const isDefault = $("ctdefault").checked;
  const file = $("ctfile").files[0];

  if(!name) return alert("Template Name is required.");
  if(!file) return alert("Please choose a template file (PDF, JPG or PNG).");

  const ext = (file.name.split(".").pop()||"").toLowerCase();
  const templateType = ext === "pdf" ? "pdf" : (ext === "png" ? "png" : "jpg");

  const btn = $("ctSaveBtn");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Uploading...";

  try{
    const templateId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const storagePath = `${templateId}/${safeName}`;

    const up = await sb.storage.from(CERT_TEMPLATE_BUCKET).upload(storagePath, file, { upsert:true });
    if(up.error){
      alert("Upload failed: " + up.error.message);
      return;
    }

    // If this is being set as default, clear any existing default in the same scope
    // (same training_id, or the reusable/global scope when training_id is null).
    if(isDefault){
      let clearQuery = sb.from("certificate_templates").update({ is_default:false });
      clearQuery = trainingId ? clearQuery.eq("training_id", trainingId) : clearQuery.is("training_id", null);
      await clearQuery;
    }

    const insertRes = await sb.from("certificate_templates").insert({
      id: templateId,
      template_name: name,
      training_id: trainingId,
      template_type: templateType,
      storage_path: storagePath,
      orientation: orientation,
      page_size: pageSize,
      is_default: isDefault,
      field_positions: {},
      created_by: profile.id
    });

    if(insertRes.error){
      alert("Could not save template: " + insertRes.error.message);
      return;
    }

    closeModal();
    route("certificates");
  }catch(e){
    alert("Unexpected error: " + e.message);
  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function previewCertificateTemplate(templateId){
  const tpl = _certTemplatesCache.find(t=>t.id===templateId);
  if(!tpl) return;
  const signed = await sb.storage.from(CERT_TEMPLATE_BUCKET).createSignedUrl(tpl.storage_path, 3600);
  if(signed.error) return alert("Could not open preview: " + signed.error.message);
  window.open(signed.data.signedUrl, "_blank");
}

async function deleteCertificateTemplate(templateId){
  const tpl = _certTemplatesCache.find(t=>t.id===templateId);
  if(!tpl) return;
  if(!confirm(`Delete template "${tpl.template_name}"? Trainings using it as their certificate format will need a new template assigned.`)) return;

  const delFile = await sb.storage.from(CERT_TEMPLATE_BUCKET).remove([tpl.storage_path]);
  if(delFile.error){
    alert("Could not delete template file: " + delFile.error.message);
    return;
  }
  const delRow = await sb.from("certificate_templates").delete().eq("id", templateId);
  if(delRow.error){
    alert("Could not delete template record: " + delRow.error.message);
    return;
  }
  route("certificates");
}

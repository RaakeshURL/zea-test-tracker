const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const ExcelJS = require("exceljs");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// Set STORAGE_DIR to a persistent disk (e.g. /var/data on Render) to keep data across restarts.
const STORE = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : ROOT;
const DATA_DIR = path.join(STORE, "data");
const ATTACH_DIR = path.join(STORE, "attachments");
const REPORT_DIR = path.join(STORE, "reports");
const BACKUP_DIR = path.join(REPORT_DIR, "backups");

const TEST_CASES = path.join(DATA_DIR, "test-cases.json");
const RESULTS = path.join(DATA_DIR, "execution-results.json");

for (const dir of [DATA_DIR, ATTACH_DIR, REPORT_DIR, BACKUP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
const SEED_CASES = path.join(ROOT, "data", "test-cases.json");
if (!fs.existsSync(TEST_CASES)) {
  if (TEST_CASES !== SEED_CASES && fs.existsSync(SEED_CASES)) fs.copyFileSync(SEED_CASES, TEST_CASES);
  else fs.writeFileSync(TEST_CASES, "[]\n");
}
if (!fs.existsSync(RESULTS)) fs.writeFileSync(RESULTS, "{}\n");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, "public")));
app.use("/attachments", express.static(ATTACH_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, ATTACH_DIR),
    filename: (_, file, cb) => {
      const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      cb(null, `${stamp}_${safe}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\/(png|jpeg|jpg|gif|webp)$/.test(file.mimetype)) cb(null, true); else cb(new Error("Only image files are allowed."));
  }
});

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

let writeQueue = Promise.resolve();
function atomicWriteJson(file, data) {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await fs.promises.rename(tmp, file);
  });
  return writeQueue;
}

function validStatus(s) {
  return ["NOT_TESTED", "PASS", "FAIL", "SKIPPED", "NOT_APPLICABLE"].includes(s);
}

function getResults() {
  return readJson(RESULTS, {});
}

// ---------- Admin auth ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const adminTokens = new Set();

function requireAdmin(req, res, next) {
  if (adminTokens.has(req.get("x-admin-token"))) return next();
  res.status(401).json({ error: "Admin login required." });
}

app.post("/api/admin/login", (req, res) => {
  const given = Buffer.from(String((req.body || {}).password || ""));
  const expected = Buffer.from(ADMIN_PASSWORD);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: "Incorrect admin password." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  adminTokens.add(token);
  res.json({ ok: true, token });
});

app.post("/api/admin/logout", (req, res) => {
  adminTokens.delete(req.get("x-admin-token"));
  res.json({ ok: true });
});

app.get("/api/admin/status", (req, res) => res.json({ admin: adminTokens.has(req.get("x-admin-token")) }));

// ---------- Test case CRUD ----------
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced", "Expert"];
const PRIORITIES = ["High", "Medium", "Low"];
const SEVERITIES = ["Critical", "High", "Medium", "Low"];

function toLines(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v ?? "").split(/\r?\n/).map(x => x.replace(/^\s*(\d+[.)]|[-*•])\s+/, "").trim()).filter(Boolean);
}

function pickOption(v, options, fallback) {
  const hit = options.find(o => o.toLowerCase() === String(v ?? "").trim().toLowerCase());
  return hit || fallback;
}

function normalizeCase(raw, id) {
  return {
    id,
    module: String(raw.module || "").trim(),
    feature: String(raw.feature || "").trim(),
    title: String(raw.title || "").trim(),
    description: String(raw.description || "").trim(),
    preconditions: toLines(raw.preconditions),
    steps: toLines(raw.steps),
    expectedResult: String(raw.expectedResult || "").trim(),
    difficulty: pickOption(raw.difficulty, DIFFICULTIES, "Beginner"),
    priority: pickOption(raw.priority, PRIORITIES, "Medium"),
    severity: pickOption(raw.severity, SEVERITIES, "Medium")
  };
}

function nextId(cases, extraIds = []) {
  const used = new Set([...cases.map(c => c.id), ...extraIds]);
  let max = 0;
  for (const id of used) {
    const m = /^TC-(\d+)$/i.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1, id;
  do { id = `TC-${String(n++).padStart(3, "0")}`; } while (used.has(id));
  return id;
}

async function backupTestCases(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(BACKUP_DIR, `test-cases-${label}_${stamp}.json`);
  await fs.promises.copyFile(TEST_CASES, target);
  return path.relative(ROOT, target);
}

app.get("/api/health", (_, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get("/api/test-cases", (_, res) => res.json(readJson(TEST_CASES, [])));

app.post("/api/test-cases", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const cases = readJson(TEST_CASES, []);
  const id = String(body.id || "").trim() || nextId(cases);
  if (cases.some(c => c.id === id)) return res.status(409).json({ error: `Test ID ${id} already exists.` });
  const tc = normalizeCase(body, id);
  if (!tc.title || !tc.module) return res.status(400).json({ error: "Module and Title are required." });
  cases.push(tc);
  try {
    await atomicWriteJson(TEST_CASES, cases);
    res.json({ ok: true, testCase: tc });
  } catch (e) {
    res.status(500).json({ error: "Could not save test case.", detail: e.message });
  }
});

app.put("/api/test-cases/:id", requireAdmin, async (req, res) => {
  const cases = readJson(TEST_CASES, []);
  const idx = cases.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Test case not found." });
  const tc = normalizeCase(req.body || {}, req.params.id);
  if (!tc.title || !tc.module) return res.status(400).json({ error: "Module and Title are required." });
  cases[idx] = tc;
  try {
    await atomicWriteJson(TEST_CASES, cases);
    res.json({ ok: true, testCase: tc });
  } catch (e) {
    res.status(500).json({ error: "Could not save test case.", detail: e.message });
  }
});

app.delete("/api/test-cases/:id", requireAdmin, async (req, res) => {
  const cases = readJson(TEST_CASES, []);
  if (!cases.some(c => c.id === req.params.id)) return res.status(404).json({ error: "Test case not found." });
  try {
    await backupTestCases("before-delete");
    await atomicWriteJson(TEST_CASES, cases.filter(c => c.id !== req.params.id));
    const results = getResults();
    if (results[req.params.id]) {
      delete results[req.params.id];
      await atomicWriteJson(RESULTS, results);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not delete test case.", detail: e.message });
  }
});

// ---------- Excel import / template ----------
const IMPORT_COLUMNS = [
  ["id", "Test ID", 12], ["module", "Module", 18], ["feature", "Feature", 20], ["title", "Title", 40],
  ["description", "Description", 45], ["preconditions", "Preconditions", 40], ["steps", "Steps", 50],
  ["expectedResult", "Expected Result", 45], ["difficulty", "Difficulty", 14], ["priority", "Priority", 12], ["severity", "Severity", 12]
];
const HEADER_ALIASES = {
  id: ["testid", "id", "tcid", "testcaseid"], module: ["module"], feature: ["feature"],
  title: ["title", "testcasetitle", "testcasename", "name", "testcase"], description: ["description", "summary"],
  preconditions: ["preconditions", "precondition", "prerequisites"], steps: ["steps", "teststeps"],
  expectedResult: ["expectedresult", "expected", "expectedoutcome"], difficulty: ["difficulty", "level"],
  priority: ["priority"], severity: ["severity"]
};

function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join("");
    if ("result" in v) return cellText(v.result);
    if ("text" in v) return cellText(v.text);
    return "";
  }
  return String(v);
}

app.get("/api/test-cases-template", async (_, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Test Cases");
  ws.columns = IMPORT_COLUMNS.map(([key, header, width]) => ({ key, header, width }));
  ws.getRow(1).font = { bold: true };
  ws.addRow({
    id: "", module: "Login", feature: "Authentication", title: "Login with valid credentials",
    description: "Verify that a user can log in using valid credentials.",
    preconditions: "User account exists\nCRM URL is reachable",
    steps: "Open the login page\nEnter valid username and password\nClick Login",
    expectedResult: "User lands on the dashboard.", difficulty: "Beginner", priority: "High", severity: "High"
  });
  ws.eachRow(r => r.eachCell(c => { c.alignment = { wrapText: true, vertical: "top" }; }));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="test-cases-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post("/api/test-cases/import", requireAdmin, importUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No Excel file uploaded." });
  const mode = req.body.mode === "replace" ? "replace" : "merge";

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: "Could not read the file. Upload a valid .xlsx workbook." });
  }
  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ error: "The workbook has no sheets." });

  const colIndex = {};
  ws.getRow(1).eachCell((cell, col) => {
    const key = cellText(cell.value).toLowerCase().replace(/[^a-z]/g, "");
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && !(field in colIndex)) colIndex[field] = col;
    }
  });
  const missing = ["module", "title"].filter(f => !(f in colIndex));
  if (missing.length) return res.status(400).json({ error: `Missing required column(s): ${missing.join(", ")}. First row must be headers (see template).` });

  const existing = mode === "replace" ? [] : readJson(TEST_CASES, []);
  const byId = new Map(existing.map(c => [c.id, c]));
  const order = existing.map(c => c.id);
  const seenInFile = new Set();
  const errors = [];
  let added = 0, updated = 0;

  // Reserve explicit IDs first so auto-generated ones never collide with later rows.
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const raw = {};
    for (const field of Object.keys(colIndex)) raw[field] = cellText(row.getCell(colIndex[field]).value);
    if (!Object.values(raw).some(v => String(v).trim())) return;
    rows.push({ n, raw });
  });
  const explicit = rows.map(r => String(r.raw.id || "").trim()).filter(Boolean);

  for (const { n, raw } of rows) {
    const tc0 = normalizeCase(raw, "");
    if (!tc0.module || !tc0.title) { errors.push(`Row ${n}: Module and Title are required — skipped.`); continue; }
    let id = String(raw.id || "").trim();
    if (id && seenInFile.has(id)) { errors.push(`Row ${n}: duplicate Test ID ${id} in file — skipped.`); continue; }
    if (!id) id = nextId([...byId.values()], [...explicit, ...seenInFile]);
    seenInFile.add(id);
    const tc = { ...tc0, id };
    if (byId.has(id)) updated++; else { added++; order.push(id); }
    byId.set(id, tc);
  }

  if (!added && !updated) return res.status(400).json({ error: "No valid test cases found in the file.", errors });

  try {
    const backup = await backupTestCases(`before-import-${mode}`);
    await atomicWriteJson(TEST_CASES, order.map(id => byId.get(id)));
    res.json({ ok: true, mode, added, updated, skipped: errors.length, errors: errors.slice(0, 20), backup });
  } catch (e) {
    res.status(500).json({ error: "Could not save imported test cases.", detail: e.message });
  }
});
app.get("/api/results", (_, res) => res.json(getResults()));

app.put("/api/results/:testId", async (req, res) => {
  const testId = req.params.testId;
  const cases = readJson(TEST_CASES, []);
  if (!cases.some(c => c.id === testId)) return res.status(404).json({ error: "Test case not found." });

  const body = req.body || {};
  if (!validStatus(body.status)) return res.status(400).json({ error: "Invalid status." });

  const results = getResults();
  const previous = results[testId] || {};
  results[testId] = {
    ...previous,
    status: body.status,
    actualResult: String(body.actualResult || ""),
    remarks: String(body.remarks || ""),
    stepsToReproduce: String(body.stepsToReproduce || ""),
    bugId: String(body.bugId || ""),
    severity: String(body.severity || ""),
    priority: String(body.priority || ""),
    evidence: Array.isArray(body.evidence) ? body.evidence : (previous.evidence || []),
    testedAt: body.testedAt || new Date().toISOString()
  };

  try {
    await atomicWriteJson(RESULTS, results);
    res.json({ ok: true, result: results[testId] });
  } catch (e) {
    res.status(500).json({ error: "Could not save result.", detail: e.message });
  }
});

app.delete("/api/results/:testId", async (req, res) => {
  const results = getResults();
  delete results[req.params.testId];
  try {
    await atomicWriteJson(RESULTS, results);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not reset test case." });
  }
});

app.post("/api/reset-results", async (_, res) => {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(BACKUP_DIR, `execution-results-before-reset_${stamp}.json`);
    await fs.promises.copyFile(RESULTS, backup);
    await atomicWriteJson(RESULTS, {});
    res.json({ ok: true, backup: path.relative(ROOT, backup) });
  } catch (e) {
    res.status(500).json({ error: "Could not reset results.", detail: e.message });
  }
});

app.post("/api/backup", async (_, res) => {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(BACKUP_DIR, `execution-results_${stamp}.json`);
    await fs.promises.copyFile(RESULTS, target);
    res.json({ ok: true, file: path.relative(ROOT, target) });
  } catch (e) {
    res.status(500).json({ error: "Backup failed.", detail: e.message });
  }
});

app.post("/api/upload-evidence", upload.single("evidence"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  res.json({ ok: true, path: `attachments/${req.file.filename}` });
});

app.get("/api/export/json", (_, res) => {
  res.download(RESULTS, "zea-crm-test-results.json");
});

app.get("/api/export/csv", (_, res) => {
  const cases = readJson(TEST_CASES, []);
  const results = getResults();
  const esc = v => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const header = ["Test ID", "Module", "Title", "Status", "Expected Result", "Actual Result", "Remarks", "Steps to Reproduce", "Bug ID", "Severity", "Priority", "Tested At"];
  const lines = [header.map(esc).join(",")];
  for (const c of cases) {
    const r = results[c.id] || {};
    lines.push([
      c.id, c.module, c.title, r.status || "NOT_TESTED", c.expectedResult, r.actualResult, r.remarks,
      r.stepsToReproduce, r.bugId, r.severity, r.priority, r.testedAt
    ].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="zea-crm-test-results.csv"');
  res.send("\ufeff" + lines.join("\n"));
});

app.get("/api/export/html", (_, res) => {
  const cases = readJson(TEST_CASES, []);
  const results = getResults();
  const esc = v => String(v ?? "").replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const counts = { PASS: 0, FAIL: 0, NOT_TESTED: 0, SKIPPED: 0, NOT_APPLICABLE: 0 };
  cases.forEach(c => counts[(results[c.id] || {}).status || "NOT_TESTED"]++);
  let rows = "";
  for (const c of cases) {
    const r = results[c.id] || {};
    rows += `<tr><td>${esc(c.id)}</td><td>${esc(c.module)}</td><td>${esc(c.title)}</td><td>${esc(r.status || "NOT_TESTED")}</td><td>${esc(c.expectedResult)}</td><td>${esc(r.actualResult)}</td><td>${esc(r.remarks)}</td><td>${esc(r.stepsToReproduce)}</td><td>${esc(r.bugId)}</td><td>${esc(r.severity)}</td><td>${esc(r.priority)}</td><td>${esc(r.testedAt)}</td></tr>`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ZEA CRM Test Report</title>
  <style>body{font-family:Arial,sans-serif;margin:30px;color:#222}h1{margin-bottom:4px}.summary{display:flex;gap:12px;flex-wrap:wrap}.box{border:1px solid #ddd;border-radius:8px;padding:12px 16px}table{border-collapse:collapse;width:100%;font-size:12px;margin-top:20px}th,td{border:1px solid #ddd;padding:7px;vertical-align:top}th{background:#f3f4f6;text-align:left}</style>
  </head><body><h1>ZEA CRM Test Execution Report</h1><p>Generated: ${esc(new Date().toLocaleString())}</p>
  <div class="summary">${Object.entries(counts).map(([k, v]) => `<div class="box"><b>${esc(k)}</b><br>${v}</div>`).join("")}</div>
  <table><thead><tr><th>Test ID</th><th>Module</th><th>Title</th><th>Status</th><th>Expected</th><th>Actual</th><th>Remarks</th><th>Reproduce</th><th>Bug ID</th><th>Severity</th><th>Priority</th><th>Tested At</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="zea-crm-test-report.html"');
  res.send(html);
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) return res.status(400).json({ error: err.message || "Request failed." });
  next();
});

app.get("*", (_, res) => res.sendFile(path.join(ROOT, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`ZEA CRM Test Tracker running at http://localhost:${PORT}`);
});

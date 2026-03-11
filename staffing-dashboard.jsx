import { useState, useMemo, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, Legend
} from "recharts";

/* ─── PERSISTENT STORAGE HELPERS ─────────────────────────────────────────── */
const STORAGE_KEY = "uss_weekly_uploads";

async function loadStoredData() {
  try {
    const result = await window.storage.get(STORAGE_KEY);
    return result ? JSON.parse(result.value) : [];
  } catch { return []; }
}

async function saveStoredData(data) {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify(data));
  } catch (e) { console.error("Storage save failed", e); }
}

/* ─── BULLHORN XLSX PARSER ───────────────────────────────────────────────── */
function parseBullhornXLSX(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: "" });

  const records = [];
  for (const row of rows) {
    const branch = (row["Branch"] || "").trim();
    const candidate = (row["Candidate Name"] || "").trim();
    if (!branch || !candidate) continue;

    const periodRaw = row["Billing Period End Date"];
    let periodDate = null;
    if (periodRaw) {
      const d = new Date(periodRaw);
      if (!isNaN(d)) periodDate = d.toISOString().split("T")[0];
    }

    records.push({
      branch,
      customer: (row["Customer"] || "").trim(),
      periodEnd: periodDate,
      candidateName: candidate,
      employeeType: (row["Employee Type"] || "").trim(),
      jobTitle: (row["Job Title"] || "").trim(),
      placementId: row["Placement ID"] || "",
      payRate: parseFloat(row["Pay Rate_"]) || 0,
      billRate: parseFloat(row["Bill Rate_"]) || 0,
      regBillAmt: parseFloat(row["Reg Bill Amount"]) || 0,
      regHoursBilled: parseFloat(row["Reg Hours Billed"]) || 0,
      otBillAmt: parseFloat(row["OT Bill Amount"]) || 0,
      otHoursBilled: parseFloat(row["OT Hours Billed"]) || 0,
      regPayAmt: parseFloat(row["Reg Pay Amount"]) || 0,
      regHoursPaid: parseFloat(row["Reg Hours Paid"]) || 0,
      otPayAmt: parseFloat(row["OT Pay Amount"]) || 0,
      otHoursPaid: parseFloat(row["OT Hours Paid"]) || 0,
      grossSales: parseFloat(row["Gross Sales Amount"]) || 0,
      grossWages: parseFloat(row["Gross Wages Amount"]) || 0,
      burdenPct: parseFloat(row["Assignment Burden (%)"]) || 0,
      burdenAmt: parseFloat(row["Assignment Burden ($)"]) || 0,
      agentProfit: parseFloat(row["Staffing Agent Profit"]) || 0,
    });
  }
  return records;
}

/* ─── UTILITIES ──────────────────────────────────────────────────────────── */
const fmt = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => "$" + ((Number(n) || 0) / 1000).toFixed(1) + "k";
const totalHours = (r) => r.regHoursBilled + r.otHoursBilled;

function groupByAgent(records) {
  const map = {};
  for (const r of records) {
    if (!map[r.branch]) map[r.branch] = [];
    map[r.branch].push(r);
  }
  return map;
}

function weekLabel(dateStr) {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  return `WE ${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}/${d.getFullYear()}`;
}

/* ─── SUB-COMPONENTS ─────────────────────────────────────────────────────── */

const Pill = ({ label, color }) => (
  <span style={{
    display: "inline-block", padding: "2px 10px", borderRadius: 20,
    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
    background: color + "22", color, border: `1px solid ${color}44`,
  }}>{label}</span>
);

const StatCard = ({ label, value, sub, accent, icon }) => (
  <div style={{
    background: "#0f1923", border: `1px solid ${accent}33`,
    borderTop: `3px solid ${accent}`, borderRadius: 8,
    padding: "18px 22px", flex: 1, minWidth: 150,
  }}>
    <div style={{ fontSize: 10, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a8fa6", marginBottom: 6 }}>
      {icon && <span style={{ marginRight: 5 }}>{icon}</span>}{label}
    </div>
    <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Barlow Condensed',sans-serif", color: "#f0f6ff", letterSpacing: "-0.5px" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#4a6680", marginTop: 3 }}>{sub}</div>}
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0a1a2a", border: "1px solid #1e3a55", borderRadius: 8, padding: "12px 16px", fontFamily: "'Barlow',sans-serif", fontSize: 12 }}>
      <div style={{ color: "#60a8d8", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

/* ─── UPLOAD PANEL ───────────────────────────────────────────────────────── */
function UploadPanel({ onUpload, uploadHistory }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");

  const processFile = useCallback((file) => {
    if (!file) return;
    setStatus("Parsing…");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const records = parseBullhornXLSX(new Uint8Array(e.target.result));
        if (!records.length) { setStatus("⚠ No valid rows found."); return; }
        const periods = [...new Set(records.map(r => r.periodEnd))];
        onUpload(records, file.name, periods[0]);
        setStatus(`✓ ${records.length} records imported for ${periods.map(weekLabel).join(", ")}`);
      } catch (err) {
        setStatus("⚠ Parse error: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [onUpload]);

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    processFile(e.dataTransfer.files[0]);
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 700, color: "#cce4ff", marginBottom: 6 }}>Upload Weekly BullhornONE Report</div>
      <div style={{ fontSize: 12, color: "#4a6680", marginBottom: 20 }}>Upload the standardized XLSX export each week. Past data is preserved automatically.</div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById("xlsxUpload").click()}
        style={{
          border: `2px dashed ${dragging ? "#4a8fb8" : "#1e3a55"}`,
          borderRadius: 12, padding: "48px 32px", textAlign: "center",
          cursor: "pointer", background: dragging ? "#0e2035" : "#0a1520",
          transition: "all 0.2s",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 12 }}>──</div>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, color: "#8ab0cc", marginBottom: 6 }}>
          Drop BullhornONE XLSX here or click to browse
        </div>
        <div style={{ fontSize: 11, color: "#4a6680" }}>Accepts: SA_data_WE_[date].xlsx</div>
        <input id="xlsxUpload" type="file" accept=".xlsx,.xls" style={{ display: "none" }}
          onChange={e => processFile(e.target.files[0])} />
      </div>

      {status && (
        <div style={{
          marginTop: 16, padding: "12px 16px", borderRadius: 8,
          background: status.startsWith("✓") ? "#0a2a1a" : "#2a1a0a",
          border: `1px solid ${status.startsWith("✓") ? "#40e09040" : "#e0a04040"}`,
          color: status.startsWith("✓") ? "#40e090" : "#e0a040", fontSize: 13,
        }}>{status}</div>
      )}

      {uploadHistory.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 700, color: "#8ab0cc", marginBottom: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>Upload History</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {uploadHistory.slice().reverse().map((h, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 8, padding: "12px 16px" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#cce4ff", fontWeight: 600 }}>{weekLabel(h.periodEnd)}</div>
                  <div style={{ fontSize: 11, color: "#4a6680", marginTop: 2 }}>{h.filename} · {h.recordCount} records · {h.agentCount} agents</div>
                </div>
                <div style={{ fontSize: 11, color: "#4a6680" }}>{h.uploadedAt}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── WORKER TABLE ───────────────────────────────────────────────────────── */
function WorkerTable({ records }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'Barlow',sans-serif" }}>
        <thead>
          <tr style={{ background: "#0a1520" }}>
            {["Worker", "Customer", "Title", "Pay Rate", "Bill Rate", "Reg Hrs", "OT Hrs", "Total Hrs", "Gross Sales", "Gross Wages", "Profit"].map(h => (
              <th key={h} style={{ padding: "9px 12px", textAlign: "left", color: "#4a8fb8", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.07em", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #1a2d40", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#0d1e2e" : "#0f2133", borderBottom: "1px solid #142030" }}>
              <td style={{ padding: "10px 12px", color: "#cce4ff", fontWeight: 600, whiteSpace: "nowrap" }}>{r.candidateName}</td>
              <td style={{ padding: "10px 12px", color: "#8ab0cc", whiteSpace: "nowrap" }}>{r.customer}</td>
              <td style={{ padding: "10px 12px", color: "#6890a8", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{r.jobTitle}</td>
              <td style={{ padding: "10px 12px", color: "#f0c060", whiteSpace: "nowrap" }}>${r.payRate}/hr</td>
              <td style={{ padding: "10px 12px", color: "#d0a040", whiteSpace: "nowrap" }}>${r.billRate}/hr</td>
              <td style={{ padding: "10px 12px", color: "#8ab0cc" }}>{r.regHoursBilled.toFixed(2)}</td>
              <td style={{ padding: "10px 12px", color: r.otHoursBilled > 0 ? "#e09040" : "#4a6680" }}>{r.otHoursBilled.toFixed(2)}</td>
              <td style={{ padding: "10px 12px", color: "#a0c8e0", fontWeight: 600 }}>{totalHours(r).toFixed(2)}</td>
              <td style={{ padding: "10px 12px", color: "#60c8f8" }}>{fmt(r.grossSales)}</td>
              <td style={{ padding: "10px 12px", color: "#f0c060" }}>{fmt(r.grossWages)}</td>
              <td style={{ padding: "10px 12px", color: "#40e090", fontWeight: 700 }}>{fmt(r.agentProfit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── MAIN APP ───────────────────────────────────────────────────────────── */
export default function StaffingDashboard() {
  // Auth
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentAgent, setCurrentAgent] = useState(null); // null = admin
  const [loginInput, setLoginInput] = useState({ id: "", pass: "" });
  const [loginError, setLoginError] = useState("");

  // Data
  const [allUploads, setAllUploads] = useState([]); // array of { periodEnd, records, filename, uploadedAt, agentCount, recordCount }
  const [uploadHistory, setUploadHistory] = useState([]);
  const [storageLoaded, setStorageLoaded] = useState(false);

  // UI
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [timeView, setTimeView] = useState("weekly");
  const [agentFilter, setAgentFilter] = useState(null); // for admin view

  // Load from storage on mount
  useEffect(() => {
    loadStoredData().then(stored => {
      if (stored && stored.uploads) {
        setAllUploads(stored.uploads);
        setUploadHistory(stored.history || []);
      }
      setStorageLoaded(true);
    });
  }, []);

  // Derive available weeks and agents from all uploads
  const allWeeks = useMemo(() => {
    const weeks = [...new Set(allUploads.map(u => u.periodEnd))].sort();
    return weeks;
  }, [allUploads]);

  const latestWeek = allWeeks[allWeeks.length - 1] || null;
  const displayWeek = selectedWeek || latestWeek;

  const currentWeekRecords = useMemo(() => {
    if (!displayWeek) return [];
    const upload = allUploads.find(u => u.periodEnd === displayWeek);
    return upload ? upload.records : [];
  }, [allUploads, displayWeek]);

  // Agents visible to this login
  const allAgentNames = useMemo(() => {
    const names = new Set();
    for (const u of allUploads) for (const r of u.records) names.add(r.branch);
    return [...names].sort();
  }, [allUploads]);

  // Filter records by logged-in agent
  const agentRecords = useMemo(() => {
    if (!currentAgent) return currentWeekRecords; // admin sees all
    return currentWeekRecords.filter(r => r.branch === currentAgent);
  }, [currentWeekRecords, currentAgent]);

  const displayRecords = agentFilter
    ? agentRecords.filter(r => r.branch === agentFilter)
    : agentRecords;

  // KPIs for current week
  const kpi = useMemo(() => {
    const records = displayRecords;
    return {
      workers: records.length,
      revenue: records.reduce((s, r) => s + r.grossSales, 0),
      payroll: records.reduce((s, r) => s + r.grossWages, 0),
      profit: records.reduce((s, r) => s + r.agentProfit, 0),
      customers: new Set(records.map(r => r.customer)).size,
      totalHours: records.reduce((s, r) => s + totalHours(r), 0),
    };
  }, [displayRecords]);

  // Historical chart data across all weeks
  const historicalData = useMemo(() => {
    return allWeeks.map(week => {
      const upload = allUploads.find(u => u.periodEnd === week);
      const recs = upload ? upload.records.filter(r => !currentAgent || r.branch === currentAgent) : [];
      return {
        period: weekLabel(week),
        revenue: recs.reduce((s, r) => s + r.grossSales, 0),
        payroll: recs.reduce((s, r) => s + r.grossWages, 0),
        profit: recs.reduce((s, r) => s + r.agentProfit, 0),
        workers: recs.length,
      };
    });
  }, [allUploads, allWeeks, currentAgent]);

  // Per-customer breakdown
  const customerBreakdown = useMemo(() => {
    const map = {};
    for (const r of displayRecords) {
      if (!map[r.customer]) map[r.customer] = { customer: r.customer, workers: [], revenue: 0, payroll: 0, profit: 0 };
      map[r.customer].workers.push(r);
      map[r.customer].revenue += r.grossSales;
      map[r.customer].payroll += r.grossWages;
      map[r.customer].profit += r.agentProfit;
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [displayRecords]);

  // Per-worker profit chart
  const workerProfitData = useMemo(() => {
    return displayRecords
      .slice()
      .sort((a, b) => b.agentProfit - a.agentProfit)
      .slice(0, 20)
      .map(r => ({ name: r.candidateName.split(" ")[0] + " " + r.candidateName.split(" ").slice(-1)[0], profit: r.agentProfit }));
  }, [displayRecords]);

  // Handle new upload
  const handleUpload = useCallback(async (records, filename, periodEnd) => {
    setAllUploads(prev => {
      // Replace existing upload for same week, or add new
      const existing = prev.findIndex(u => u.periodEnd === periodEnd);
      const newEntry = { periodEnd, records, filename };
      const updated = existing >= 0
        ? prev.map((u, i) => i === existing ? newEntry : u)
        : [...prev, newEntry];
      // Persist
      const histEntry = {
        periodEnd, filename,
        recordCount: records.length,
        agentCount: new Set(records.map(r => r.branch)).size,
        uploadedAt: new Date().toLocaleDateString(),
      };
      const newHistory = [...uploadHistory, histEntry];
      setUploadHistory(newHistory);
      saveStoredData({ uploads: updated, history: newHistory });
      setSelectedWeek(periodEnd);
      return updated;
    });
  }, [uploadHistory]);

  // LOGIN
  const handleLogin = () => {
    // Admin
    if (loginInput.id.toUpperCase() === "ADMIN" && loginInput.pass === "uss2026!") {
      setCurrentAgent(null); setLoggedIn(true); setLoginError(""); return;
    }
    // Agent login — match by branch name slug or exact
    const match = allAgentNames.find(n =>
      n.toLowerCase().replace(/\s+/g, "") === loginInput.id.toLowerCase().replace(/\s+/g, "")
    );
    if (match && loginInput.pass === "staffing123") {
      setCurrentAgent(match); setLoggedIn(true); setLoginError("");
    } else {
      setLoginError("Invalid credentials. Use your agency name as ID.");
    }
  };

  const tabs = currentAgent
    ? [["overview", "Overview"], ["workers", "Workers"], ["customers", "Customers"], ["analytics", "Analytics"]]
    : [["overview", "Overview"], ["workers", "Workers"], ["customers", "Customers"], ["analytics", "Analytics"], ["upload", "Upload Data"]];

  /* ── LOGIN SCREEN ── */
  if (!loggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "#060e18", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow',sans-serif" }}>
        <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@400;600;700;800&display=swap" rel="stylesheet" />
        <div style={{ position: "fixed", inset: 0, backgroundImage: "linear-gradient(#1a3a5510 1px,transparent 1px),linear-gradient(90deg,#1a3a5510 1px,transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" }} />
        <div style={{ position: "relative", width: 420, background: "#0d1e2e", border: "1px solid #1e3a55", borderRadius: 16, padding: 44, boxShadow: "0 32px 80px #000a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <div style={{ width: 44, height: 44, background: "linear-gradient(135deg,#1e6aaa,#0e3a66)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⚡</div>
            <div>
              <div style={{ fontSize: 11, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.14em", color: "#4a8fb8", textTransform: "uppercase" }}>USA Staffing Services</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Barlow Condensed',sans-serif", color: "#cce4ff" }}>Staffing Agent Portal</div>
            </div>
          </div>

          {[["Agent ID / Agency Name", "id", "text", "e.g. BlueCloud Staffing"], ["Password", "pass", "password", "••••••••"]].map(([label, key, type, ph]) => (
            <div key={key} style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4a6680", marginBottom: 6 }}>{label}</label>
              <input type={type} value={loginInput[key]} placeholder={ph}
                onChange={e => setLoginInput(p => ({ ...p, [key]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ width: "100%", background: "#0a1520", border: "1px solid #1e3a55", borderRadius: 8, padding: "11px 14px", color: "#cce4ff", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
          ))}

          {loginError && <div style={{ color: "#e06060", fontSize: 12, marginBottom: 14, background: "#2d100a", padding: "10px 14px", borderRadius: 6, border: "1px solid #e0606030" }}>{loginError}</div>}

          <button onClick={handleLogin} style={{ width: "100%", background: "linear-gradient(135deg,#1e6aaa,#0e4488)", color: "#cce4ff", border: "none", borderRadius: 8, padding: 14, fontSize: 14, fontWeight: 700, fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer" }}>
            Sign In →
          </button>

          <div style={{ marginTop: 22, padding: 14, background: "#080f18", borderRadius: 8, border: "1px solid #1a2d40", fontSize: 11 }}>
            <div style={{ color: "#4a6680", marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>Demo Credentials</div>
            <div style={{ color: "#4a8fb8" }}>Admin: <strong>ADMIN</strong> / <strong>uss2026!</strong></div>
            <div style={{ color: "#4a8fb8", marginTop: 4 }}>Agent: Use agency name (e.g. <strong>BlueCloud Staffing</strong>) / <strong>staffing123</strong></div>
            <div style={{ color: "#4a6680", marginTop: 4, fontSize: 10 }}>Upload data first to see agent logins</div>
          </div>
        </div>
      </div>
    );
  }

  /* ── MAIN DASHBOARD ── */
  return (
    <div style={{ minHeight: "100vh", background: "#060e18", color: "#cce4ff", fontFamily: "'Barlow',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ position: "fixed", inset: 0, backgroundImage: "linear-gradient(#1a3a5508 1px,transparent 1px),linear-gradient(90deg,#1a3a5508 1px,transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" }} />

      {/* HEADER */}
      <header style={{ position: "sticky", top: 0, zIndex: 100, background: "#0a1520ee", backdropFilter: "blur(12px)", borderBottom: "1px solid #1a3050", padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 58 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, color: "#4a8fb8", letterSpacing: "0.12em", textTransform: "uppercase" }}>USA Staffing Services · </span>
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 800, color: "#cce4ff" }}>
              {currentAgent ? currentAgent : "Admin Dashboard"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Week selector */}
            {allWeeks.length > 0 && (
              <select value={displayWeek || ""} onChange={e => setSelectedWeek(e.target.value)}
                style={{ background: "#0a1520", border: "1px solid #1e3a55", color: "#cce4ff", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", cursor: "pointer" }}>
                {allWeeks.slice().reverse().map(w => (
                  <option key={w} value={w}>{weekLabel(w)}{w === latestWeek ? " (latest)" : ""}</option>
                ))}
              </select>
            )}
            {!currentAgent && allAgentNames.length > 0 && (
              <select value={agentFilter || ""} onChange={e => setAgentFilter(e.target.value || null)}
                style={{ background: "#0a1520", border: "1px solid #1e3a55", color: "#cce4ff", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", cursor: "pointer", maxWidth: 180 }}>
                <option value="">All Agents</option>
                {allAgentNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            <button onClick={() => { setLoggedIn(false); setCurrentAgent(null); }}
              style={{ background: "#0a1a2a", border: "1px solid #1e3a55", color: "#4a8fb8", borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer", fontFamily: "'Barlow Condensed',sans-serif", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Sign Out
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              background: "none", border: "none",
              borderBottom: activeTab === id ? "2px solid #4a8fb8" : "2px solid transparent",
              color: activeTab === id ? "#cce4ff" : "#4a6680",
              padding: "9px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.06em", textTransform: "uppercase",
            }}>{label}{id === "upload" ? " +" : ""}</button>
          ))}
        </div>
      </header>

      <main style={{ padding: "24px", maxWidth: 1400, margin: "0 auto" }}>

        {/* NO DATA STATE */}
        {allUploads.length === 0 && activeTab !== "upload" && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>──</div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, color: "#8ab0cc", marginBottom: 8 }}>No data loaded yet</div>
            <div style={{ color: "#4a6680", fontSize: 13, marginBottom: 24 }}>Upload your first BullhornONE weekly report to get started</div>
            <button onClick={() => setActiveTab("upload")} style={{ background: "linear-gradient(135deg,#1e6aaa,#0e4488)", color: "#cce4ff", border: "none", borderRadius: 8, padding: "12px 28px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Upload Weekly Report →
            </button>
          </div>
        )}

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && allUploads.length > 0 && (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
              <StatCard label="Active Workers" value={kpi.workers} sub={`Week ending ${weekLabel(displayWeek)}`} accent="#4a8fb8" icon="──" />
              <StatCard label="Gross Revenue" value={fmt(kpi.revenue)} sub="Total billed to clients" accent="#60c8f8" icon="──" />
              <StatCard label="Gross Payroll" value={fmt(kpi.payroll)} sub="Total wages + burden" accent="#f0c060" icon="──" />
              <StatCard label="Agent Profit" value={fmt(kpi.profit)} sub={kpi.revenue > 0 ? `${((kpi.profit / kpi.revenue) * 100).toFixed(1)}% margin` : ""} accent="#40e090" icon="⭐" />
              <StatCard label="Active Customers" value={kpi.customers} sub="End-user clients" accent="#a060e8" icon="──" />
              <StatCard label="Total Hours" value={kpi.totalHours.toFixed(1)} sub="Reg + OT billed" accent="#e06888" icon="⏱" />
            </div>

            {/* Per-worker profit bars */}
            <div style={{ background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 10, padding: 22, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 700, color: "#cce4ff", marginBottom: 4 }}>Profit Per Worker — {weekLabel(displayWeek)}</div>
              <div style={{ fontSize: 11, color: "#4a6680", marginBottom: 18 }}>Agent profit generated from each temporary worker this week</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {displayRecords.slice().sort((a, b) => b.agentProfit - a.agentProfit).map((r, i) => {
                  const pct = kpi.profit > 0 ? (r.agentProfit / kpi.profit) * 100 : 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 150, fontSize: 11, color: "#cce4ff", fontWeight: 600, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.candidateName}</div>
                      <div style={{ width: 140, fontSize: 10, color: "#4a8fb8", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.customer}</div>
                      <div style={{ flex: 1, background: "#0a1520", borderRadius: 3, height: 7 }}>
                        <div style={{ height: "100%", width: `${Math.max(pct, 0.5)}%`, background: r.agentProfit >= 0 ? "linear-gradient(90deg,#1e6aaa,#40e090)" : "#e06060", borderRadius: 3 }} />
                      </div>
                      <div style={{ width: 80, textAlign: "right", fontSize: 12, fontWeight: 700, color: r.agentProfit >= 0 ? "#40e090" : "#e06060", flexShrink: 0 }}>{fmt(r.agentProfit)}</div>
                      <div style={{ width: 60, textAlign: "right", fontSize: 10, color: "#4a6680", flexShrink: 0 }}>{totalHours(r).toFixed(1)}h</div>
                    </div>
                  );
                })}
                <div style={{ borderTop: "1px solid #1a3050", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "flex-end", gap: 24 }}>
                  <span style={{ fontSize: 11, color: "#4a6680" }}>Revenue: <span style={{ color: "#60c8f8" }}>{fmt(kpi.revenue)}</span></span>
                  <span style={{ fontSize: 11, color: "#4a6680" }}>Payroll: <span style={{ color: "#f0c060" }}>{fmt(kpi.payroll)}</span></span>
                  <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 800, color: "#40e090" }}>Total Profit: {fmt(kpi.profit)}</span>
                </div>
              </div>
            </div>

            {/* 8-week trend mini */}
            {historicalData.length > 1 && (
              <div style={{ background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 10, padding: 22 }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 700, color: "#cce4ff", marginBottom: 16 }}>Historical Trend — All Uploaded Weeks</div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={historicalData}>
                    <defs>
                      <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4a8fb8" stopOpacity={0.3} /><stop offset="95%" stopColor="#4a8fb8" stopOpacity={0} /></linearGradient>
                      <linearGradient id="profG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#40e090" stopOpacity={0.3} /><stop offset="95%" stopColor="#40e090" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2d40" />
                    <XAxis dataKey="period" tick={{ fill: "#4a6680", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#4a6680", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="revenue" stroke="#4a8fb8" fill="url(#revG)" strokeWidth={2} name="Revenue" />
                    <Area type="monotone" dataKey="profit" stroke="#40e090" fill="url(#profG)" strokeWidth={2} name="Profit" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}

        {/* ── WORKERS TAB ── */}
        {activeTab === "workers" && allUploads.length > 0 && (
          <div style={{ background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 10, padding: 22 }}>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 700, color: "#cce4ff" }}>
                Temporary Workers on Assignment
              </div>
              <div style={{ fontSize: 11, color: "#4a6680", marginTop: 3 }}>
                {displayRecords.length} workers · {weekLabel(displayWeek)}
                {!currentAgent && agentFilter && <span> · Filtered: {agentFilter}</span>}
              </div>
            </div>
            <WorkerTable records={displayRecords} />
          </div>
        )}

        {/* ── CUSTOMERS TAB ── */}
        {activeTab === "customers" && allUploads.length > 0 && (
          <div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 700, color: "#cce4ff", marginBottom: 20 }}>
              End-User Customers — {weekLabel(displayWeek)}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {customerBreakdown.map(c => (
                <div key={c.customer} style={{ background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 10, padding: 20, minWidth: 260, flex: "1 1 260px" }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 700, color: "#60c8f8", marginBottom: 12 }}>{c.customer}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {[["Workers on Site", c.workers.length, "#cce4ff"], ["Gross Revenue", fmt(c.revenue), "#60c8f8"], ["Gross Payroll", fmt(c.payroll), "#f0c060"], ["Agent Profit", fmt(c.profit), "#40e090"]].map(([label, val, color]) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "#4a6680" }}>{label}</span>
                        <span style={{ color, fontWeight: 600 }}>{val}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, borderTop: "1px solid #1a3050", paddingTop: 10 }}>
                    {c.workers.map((w, i) => (
                      <div key={i} style={{ fontSize: 10, color: "#6890a8", paddingBottom: 2 }}>
                        · {w.candidateName} — {totalHours(w).toFixed(1)}h · {fmt(w.agentProfit)} profit
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ANALYTICS TAB ── */}
        {activeTab === "analytics" && allUploads.length > 0 && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
              {[["weekly", "By Week"]].map(([id, label]) => (
                <button key={id} onClick={() => setTimeView(id)} style={{
                  background: "#1e4a78", border: "1px solid #4a8fb8", color: "#cce4ff",
                  padding: "7px 18px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                  fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700,
                }}>── {label}</button>
              ))}
              <div style={{ marginLeft: "auto", fontSize: 11, color: "#4a6680", alignSelf: "center" }}>
                {historicalData.length} week(s) of data loaded
              </div>
            </div>

            <div style={{ background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 10, padding: 22, marginBottom: 18 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 700, color: "#cce4ff", marginBottom: 18 }}>Weekly Revenue vs. Payroll vs. Profit</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={historicalData} barGap={3}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2d40" />
                  <XAxis dataKey="period" tick={{ fill: "#4a6680", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#4a6680", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#8ab0cc" }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#1e5a8a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="payroll" name="Payroll" fill="#0e3058" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="profit" name="Profit" fill="#20a060" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 10, padding: 22, marginBottom: 18 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 700, color: "#cce4ff", marginBottom: 18 }}>Top Worker Profit — {weekLabel(displayWeek)}</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={workerProfitData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2d40" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#4a6680", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => "$" + v.toFixed(0)} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#8ab0cc", fontSize: 10 }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="profit" name="Profit" fill="#1e6aaa" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Summary table */}
            <div style={{ background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 10, padding: 22 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 700, color: "#cce4ff", marginBottom: 16 }}>Weekly Summary Table</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#0a1520" }}>
                    {["Week Ending", "Workers", "Revenue", "Payroll", "Profit", "Margin %"].map(h => (
                      <th key={h} style={{ padding: "9px 12px", textAlign: "left", color: "#4a8fb8", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "0.07em", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #1a2d40" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historicalData.slice().reverse().map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#0d1e2e" : "#0f2133", borderBottom: "1px solid #142030" }}>
                      <td style={{ padding: "10px 12px", color: "#8ab0cc" }}>{row.period}</td>
                      <td style={{ padding: "10px 12px", color: "#cce4ff" }}>{row.workers}</td>
                      <td style={{ padding: "10px 12px", color: "#60c8f8" }}>{fmt(row.revenue)}</td>
                      <td style={{ padding: "10px 12px", color: "#f0c060" }}>{fmt(row.payroll)}</td>
                      <td style={{ padding: "10px 12px", color: "#40e090", fontWeight: 700 }}>{fmt(row.profit)}</td>
                      <td style={{ padding: "10px 12px", color: "#cce4ff" }}>{row.revenue > 0 ? ((row.profit / row.revenue) * 100).toFixed(1) + "%" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── UPLOAD TAB (Admin only) ── */}
        {activeTab === "upload" && (
          <div style={{ background: "#0d1e2e", border: "1px solid #1a3050", borderRadius: 10 }}>
            <UploadPanel onUpload={handleUpload} uploadHistory={uploadHistory} />
          </div>
        )}

      </main>
    </div>
  );
}

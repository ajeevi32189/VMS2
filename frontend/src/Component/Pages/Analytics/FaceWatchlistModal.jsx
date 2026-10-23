import React, { useState, useEffect, useRef } from "react";
import { FACE_WATCHLIST_API_URL } from "../../../config";

const API = FACE_WATCHLIST_API_URL.replace(/\/$/, "");

const Icon = {
  close: (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>),
  info: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>),
  user: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>),
  upload: (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9864db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M12 8v8M8 12l4-4 4 4" /></svg>),
  check: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>),
  warn: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>),
  error: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>),
  trash: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>),
  refresh: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0020.49 15" /></svg>),
  image: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>),
};

const avatarColors = ["#6d28d9", "#0369a1", "#047857", "#b45309", "#be185d", "#4338ca", "#b91c1c", "#0f766e"];
const avatarColor = (n) => avatarColors[(n?.charCodeAt(0) || 0) % avatarColors.length];

export default function FaceWatchlistModal({ onClose }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollResult, setEnrollResult] = useState(null);
  const [persons, setPersons] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [deletingName, setDeletingName] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState(null);
  const fileRef = useRef();

  useEffect(() => { fetchPersons(); }, []);

  const fetchPersons = async () => {
    setListLoading(true);
    setDeleteMsg(null);
    try {
      const res = await fetch(`${API}/watchlist`);
      const data = await res.json();
      console.log("[Watchlist GET]", data);
      let list = [];
      if (Array.isArray(data)) {
        list = data.map(p => typeof p === "string" ? p : (p.name || String(p)));
      } else if (data && Array.isArray(data.persons)) {
        list = data.persons.map(p => typeof p === "string" ? p : (p.name || String(p)));
      } else if (data && Array.isArray(data.names)) {
        list = data.names;
      } else if (data && typeof data === "object") {
        const arrKey = Object.keys(data).find(k => Array.isArray(data[k]));
        if (arrKey) list = data[arrKey].map(p => typeof p === "string" ? p : (p.name || String(p)));
      }
      setPersons(list);
    } catch (e) {
      console.error("[Watchlist GET error]", e);
      setPersons([]);
    }
    setListLoading(false);
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f); setEnrollResult(null);
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target.result);
    reader.readAsDataURL(f);
  };

  const handleEnroll = async () => {
    if (!name.trim() || !file) return;
    setEnrolling(true); setEnrollResult(null);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("file", file);
      const res = await fetch(`${API}/watchlist/add`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.status === 409 || data?.detail?.status === "duplicate") {
        setEnrollResult({ type: "duplicate", data: data.detail || data });
      } else if (res.ok || res.status === 201) {
        if (data.angles_enrolled > 1) {
          setEnrollResult({ type: "added_angle", data });
        } else {
          setEnrollResult({ type: "success", data });
        }
        setName(""); setFile(null); setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
        fetchPersons();
      } else {
        const msg = data?.detail?.message || data?.detail || data?.message || JSON.stringify(data);
        setEnrollResult({ type: "error", msg: String(msg) });
      }
    } catch (e) {
      setEnrollResult({ type: "error", msg: e.message });
    }
    setEnrolling(false);
  };

  const handleDelete = async (personName) => {
    if (!window.confirm(`Remove "${personName}" from watchlist?`)) return;
    setDeletingName(personName);
    try {
      const res = await fetch(`${API}/watchlist/${encodeURIComponent(personName)}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteMsg({ type: "ok", msg: `"${personName}" removed successfully.` });
        fetchPersons();
      } else {
        const d = await res.json().catch(() => ({}));
        setDeleteMsg({ type: "err", msg: d?.detail || "Delete failed." });
      }
    } catch (e) {
      setDeleteMsg({ type: "err", msg: e.message });
    }
    setDeletingName(null);
  };

  return (
    <>
      <style>{`
        @keyframes wl-slide { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes wl-spin  { to { transform: rotate(360deg); } }
        .wl-input { width:100%; padding:9px 12px; border:1.5px solid #ddd6fe; border-radius:8px; font-size:13px; color:#1e1b4b; box-sizing:border-box; background:#fafafe; transition:border .2s,box-shadow .2s; font-family:inherit; }
        .wl-input:focus { outline:none; border-color:#7c3aed; box-shadow:0 0 0 3px rgba(124,58,237,.12); }
        .wl-btn-primary { width:100%; padding:10px 0; background:linear-gradient(135deg,#6d28d9,#9864db); color:#fff; border:none; border-radius:9px; font-size:14px; font-weight:600; cursor:pointer; letter-spacing:.2px; transition:opacity .2s,transform .15s; font-family:inherit; }
        .wl-btn-primary:hover:not(:disabled) { opacity:.92; transform:translateY(-1px); }
        .wl-btn-primary:disabled { opacity:.45; cursor:not-allowed; }
        .wl-drop { border:1.5px dashed #c4b5fd; border-radius:10px; min-height:130px; display:flex; align-items:center; justify-content:center; cursor:pointer; background:#faf5ff; transition:border-color .2s,background .2s; }
        .wl-drop:hover { border-color:#7c3aed; background:#f5f0ff; }
        .wl-card { background:#fff; border-radius:12px; border:1px solid #ede9fe; padding:14px 12px; text-align:center; transition:box-shadow .2s,transform .2s; }
        .wl-card:hover { box-shadow:0 4px 18px rgba(124,58,237,.13); transform:translateY(-2px); }
        .wl-del { width:100%; padding:5px 0; background:transparent; border:1px solid #fca5a5; color:#b91c1c; border-radius:7px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; transition:background .15s; font-family:inherit; }
        .wl-del:hover { background:#fee2e2; }
        .wl-del:disabled { opacity:.5; cursor:not-allowed; }
        .wl-refresh { display:flex; align-items:center; gap:5px; background:#f3f0ff; border:1px solid #ddd6fe; color:#6d28d9; padding:5px 12px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; transition:background .15s; font-family:inherit; }
        .wl-refresh:hover { background:#ede9fe; }
      `}</style>

      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,10,30,0.45)", zIndex: 9998, backdropFilter: "blur(3px)" }} />

      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 9999, width: "min(820px,96vw)", display: "flex", flexDirection: "column", background: "#f8f7ff", boxShadow: "-6px 0 40px rgba(0,0,0,.18)", fontFamily: "'Inter',system-ui,sans-serif", animation: "wl-slide .25s cubic-bezier(.4,0,.2,1)" }}>

        {/* Header */}
        <div style={{ background: "linear-gradient(130deg,#5b21b6 0%,#7c3aed 60%,#9333ea 100%)", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: "rgba(255,255,255,.15)", borderRadius: 8, padding: 7, color: "#fff", display: "flex" }}>{Icon.user}</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Enrol Face</div>
              <div style={{ color: "rgba(255,255,255,.65)", fontSize: 11, marginTop: 1 }}>Enroll and manage persons for facial recognition</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.25)", color: "#fff", width: 32, height: 32, borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {Icon.close}
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", minHeight: 0 }}>

          {/* LEFT: Enroll */}
          <div style={{ width: "42%", minWidth: 240, borderRight: "1px solid #ede9fe", padding: "22px 20px", display: "flex", flexDirection: "column", gap: 14, background: "#fff", overflowY: "auto" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#4c1d95", paddingBottom: 10, borderBottom: "1px solid #f3f0ff" }}>Enroll a Person</div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6d28d9", display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".4px" }}>Person Name</label>
              <input className="wl-input" placeholder="e.g. nikhil" value={name} onChange={e => { setName(e.target.value); setEnrollResult(null); }} />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6d28d9", display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".4px" }}>Face Photo</label>
              <div className="wl-drop" onClick={() => fileRef.current.click()}>
                {preview
                  ? <img src={preview} alt="preview" style={{ maxHeight: 120, maxWidth: "100%", borderRadius: 8, objectFit: "cover" }} />
                  : <div style={{ textAlign: "center", color: "#9879d0" }}>
                      <div style={{ marginBottom: 8, opacity: .7 }}>{Icon.upload}</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Click to select photo</div>
                      <div style={{ fontSize: 11, marginTop: 3, opacity: .6 }}>JPG, PNG, JPEG</div>
                    </div>
                }
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
              {file && <div style={{ fontSize: 11, color: "#6d28d9", marginTop: 5, display: "flex", alignItems: "center", gap: 4 }}>{Icon.image} {file.name}</div>}
            </div>

            <button className="wl-btn-primary" disabled={!name.trim() || !file || enrolling} onClick={handleEnroll}>
              {enrolling ? "Enrolling..." : "Enroll Face"}
            </button>

            {enrollResult && (
              <div style={{
                borderRadius: 10, padding: "13px 14px",
                background: enrollResult.type === "success" ? "#f0fdf4" : enrollResult.type === "added_angle" ? "#f0f9ff" : enrollResult.type === "duplicate" ? "#fffbeb" : "#fef2f2",
                border: `1.5px solid ${enrollResult.type === "success" ? "#86efac" : enrollResult.type === "added_angle" ? "#7dd3fc" : enrollResult.type === "duplicate" ? "#fcd34d" : "#fca5a5"}`,
              }}>
                {enrollResult.type === "added_angle" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#075985", marginBottom: 8, fontSize: 13 }}>{Icon.info} Existing Person Updated</div>
                    <table style={{ fontSize: 12, color: "#0369a1", borderCollapse: "collapse", width: "100%" }}>
                      <tbody>
                        <tr><td style={{ paddingBottom: 3, width: 80, fontWeight: 600 }}>Name</td><td style={{ paddingBottom: 3, fontWeight: 700, color: "#0284c7" }}>{enrollResult.data?.name}</td></tr>
                        <tr><td style={{ paddingBottom: 3, fontWeight: 600 }}>Total Angles</td><td style={{ paddingBottom: 3, fontWeight: 600 }}>{enrollResult.data?.angles_enrolled}</td></tr>
                        <tr><td style={{ paddingBottom: 3, fontWeight: 600 }}>File Saved</td><td style={{ paddingBottom: 3, fontWeight: 600 }}>{enrollResult.data?.file_saved}</td></tr>
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11, color: "#0c4a6e", marginTop: 5 }}>{enrollResult.data?.message || "Successfully registered another angle for this person."}</div>
                  </>
                )}
                {enrollResult.type === "success" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#14532d", marginBottom: 8, fontSize: 13 }}>{Icon.check} Enrolled Successfully</div>
                    <table style={{ fontSize: 12, color: "#166534", borderCollapse: "collapse", width: "100%" }}>
                      <tbody>
                        {[["Name", enrollResult.data?.name], ["Angles", enrollResult.data?.angles_enrolled], ["File", enrollResult.data?.file_saved]].map(([k, v]) => (
                          <tr key={k}><td style={{ paddingBottom: 3, width: 60, fontWeight: 600, color: "#4ade80" }}>{k}</td><td style={{ paddingBottom: 3, fontWeight: 600 }}>{v}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11, color: "#15803d", marginTop: 5 }}>{enrollResult.data?.message}</div>
                  </>
                )}
                {enrollResult.type === "duplicate" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#78350f", marginBottom: 8, fontSize: 13 }}>{Icon.warn} Already Registered</div>
                    <table style={{ fontSize: 12, color: "#92400e", borderCollapse: "collapse", width: "100%" }}>
                      <tbody>
                        <tr><td style={{ paddingBottom: 3, width: 80, fontWeight: 600 }}>Matched</td><td style={{ fontWeight: 700, color: "#b45309" }}>{enrollResult.data?.matched_name}</td></tr>
                        <tr><td style={{ paddingBottom: 3, fontWeight: 600 }}>Similarity</td><td style={{ fontWeight: 600 }}>{enrollResult.data?.similarity ? `${(enrollResult.data.similarity * 100).toFixed(1)}%` : "-"}</td></tr>
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11, marginTop: 5, color: "#92400e" }}>{enrollResult.data?.message}</div>
                  </>
                )}
                {enrollResult.type === "error" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#7f1d1d", marginBottom: 6, fontSize: 13 }}>{Icon.error} Enrollment Failed</div>
                    <div style={{ fontSize: 12, color: "#991b1b" }}>{enrollResult.msg}</div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: Enrolled Persons */}
          <div style={{ flex: 1, padding: "22px 20px", display: "flex", flexDirection: "column", gap: 14, background: "#faf8ff", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#4c1d95" }}>Enrolled Persons</span>
                {!listLoading && <span style={{ background: "#7c3aed", color: "#fff", borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{persons.length}</span>}
              </div>
              <button className="wl-refresh" onClick={fetchPersons}>{Icon.refresh} Refresh</button>
            </div>

            {deleteMsg && (
              <div style={{ borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, background: deleteMsg.type === "ok" ? "#f0fdf4" : "#fef2f2", color: deleteMsg.type === "ok" ? "#14532d" : "#7f1d1d", border: `1px solid ${deleteMsg.type === "ok" ? "#86efac" : "#fca5a5"}` }}>
                {deleteMsg.type === "ok" ? Icon.check : Icon.error} {deleteMsg.msg}
              </div>
            )}

            {listLoading ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#7c3aed", fontSize: 13 }}>
                <div style={{ width: 18, height: 18, border: "2px solid #9864db", borderTopColor: "transparent", borderRadius: "50%", animation: "wl-spin .7s linear infinite" }} />
                Loading...
              </div>
            ) : persons.length === 0 ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#c4b5fd", gap: 8 }}>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9864db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#7c3aed" }}>No persons enrolled yet</div>
                <div style={{ fontSize: 11, color: "#a78bfa" }}>Enroll someone from the left panel</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 12 }}>
                {persons.map((p, i) => (
                  <div key={i} className="wl-card">
                    <div style={{ width: 48, height: 48, borderRadius: "50%", background: avatarColor(p), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, margin: "0 auto 10px" }}>
                      {p[0]?.toUpperCase()}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 12, color: "#1e1b4b", marginBottom: 10, wordBreak: "break-all", lineHeight: 1.3 }}>{p}</div>
                    <button className="wl-del" onClick={() => handleDelete(p)} disabled={deletingName === p}>
                      {Icon.trash} {deletingName === p ? "Removing..." : "Remove"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

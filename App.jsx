import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Plus, FileDown, Printer, X, Pencil, Trash2, ChevronDown, ChevronRight, Stamp, Upload, Download, Info, FileUp, Loader2, Settings, Sparkles } from "lucide-react";
import { storage } from "./storage";
import { extractPdfText, parseCaseDocument } from "./pdfParser";
import { summarizeWithLocalAI, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./lmStudio";

const AI_SETTINGS_KEY = "ai-settings";

// 필터 기본값으로 쓸 배열들 (이제 폼에서는 드롭다운으로 쓰지 않음)
const DEPARTMENTS = ["내과", "외과", "정형외과", "산부인과", "소아청소년과", "신경외과", "응급의학과", "마취통증의학과", "기타"];
const CATEGORIES = ["설명의무", "진단지연", "수술", "투약", "검사", "감염", "기타"];
const STATUS = {
  draft: { label: "초안", color: "#C77D22", bg: "#FBF1E4" },
  review: { label: "검토중", color: "#3B6FA0", bg: "#E9F0F7" },
  approved: { label: "승인", color: "#2F7D46", bg: "#E7F3EA" },
};

const STORAGE_KEY = "medical-dispute-cases";
const emptyCase = () => ({
  id: `CASE-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`,
  department: "", // 💡 드롭다운 대신 빈칸으로 시작
  category: "",   // 💡 드롭다운 대신 빈칸으로 시작
  title: "",
  author: "",
  patientInfo: "", 
  summary: "",
  points: "",
  assessment: "",
  settlement: "",
  outcome: "",
  claimAmount: "", 
  adjustmentResult: "", 
  prevention: "",
  status: "draft",
  updatedAt: new Date().toISOString(),
});

function useCases() {
  const [cases, setCases] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        setCases(res ? JSON.parse(res.value) : []);
      } catch {
        setCases([]);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setCases(next);
    try {
      const res = await storage.set(STORAGE_KEY, JSON.stringify(next));
      if (!res) setError("저장에 실패했습니다. 다시 시도해 주세요.");
      else setError(null);
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    }
  }, []);

  const replaceAll = useCallback((next) => persist(next), [persist]);

  const upsert = useCallback((item) => {
    setCases((prev) => {
      const exists = prev.some((c) => c.id === item.id);
      const next = exists ? prev.map((c) => (c.id === item.id ? item : c)) : [...prev, item];
      persist(next);
      return next;
    });
  }, [persist]);

  const remove = useCallback((id) => {
    setCases((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persist(next);
      return next;
    });
  }, [persist]);

  return { cases, loaded, error, upsert, remove, replaceAll };
}

function mergeCases(existing, incoming) {
  const map = new Map(existing.map((c) => [c.id, c]));
  let added = 0, updated = 0, skipped = 0;
  for (const inc of incoming) {
    const cur = map.get(inc.id);
    if (!cur) {
      map.set(inc.id, inc);
      added++;
    } else if (new Date(inc.updatedAt) > new Date(cur.updatedAt)) {
      map.set(inc.id, inc);
      updated++;
    } else {
      skipped++;
    }
  }
  return { merged: Array.from(map.values()), added, updated, skipped };
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1C2B39", marginBottom: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: "#8A97A3", marginBottom: 6 }}>{hint}</div>}
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid #DCE1E2",
  fontSize: 14,
  fontFamily: "inherit",
  color: "#1C2B39",
  background: "#FFFFFF",
  outline: "none",
};

function AiSettingsModal({ settings, onSave, onCancel }) {
  const [form, setForm] = useState(settings);
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(28,43,57,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20,
    }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(440px, 100%)", padding: "24px 28px", boxShadow: "0 20px 60px rgba(28,43,57,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#1C2B39", margin: 0 }}>로컬 AI 연동 설정</h2>
          <button onClick={onCancel} style={{ border: "none", background: "none", cursor: "pointer", color: "#8A97A3" }}><X size={20} /></button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1C2B39" }}>PDF 불러올 때 AI로 자동 정리 사용</span>
        </label>

        <Field label="LM Studio 서버 주소" hint="LM Studio의 Local Server 탭에서 확인한 주소">
          <input style={inputStyle} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={DEFAULT_BASE_URL} />
        </Field>
        <Field label="모델 이름" hint="대부분 LM Studio가 알아서 현재 로드된 모델을 쓰므로 기본값으로 두셔도 됩니다">
          <input style={inputStyle} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={DEFAULT_MODEL} />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onCancel} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #DCE1E2", background: "#fff", color: "#5B6B7A", fontWeight: 600, cursor: "pointer" }}>취소</button>
          <button onClick={() => onSave(form)} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "#0B6E63", color: "#fff", fontWeight: 700, cursor: "pointer" }}>저장</button>
        </div>
      </div>
    </div>
  );
}

function CaseForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(28,43,57,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20,
    }}>
      <div style={{
        background: "#FFFFFF", borderRadius: 14, width: "min(680px, 100%)", maxHeight: "88vh",
        overflowY: "auto", padding: "24px 28px", boxShadow: "0 20px 60px rgba(28,43,57,0.25)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1C2B39", margin: 0 }}>사례 {initial.title ? "수정" : "등록"}</h2>
          <button onClick={onCancel} style={{ border: "none", background: "none", cursor: "pointer", color: "#8A97A3", padding: 4 }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: "#8A97A3", marginBottom: 20 }}>{form.id}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* 💡 드롭다운 대신 직접 입력(텍스트 필드)로 변경 */}
          <Field label="진료과" hint="AI가 분석한 결과입니다. 수정 가능합니다.">
            <input style={inputStyle} value={form.department} onChange={set("department")} placeholder="예: 내과" />
          </Field>
          <Field label="분쟁 유형" hint="AI가 분석한 결과입니다. 수정 가능합니다.">
            <input style={inputStyle} value={form.category} onChange={set("category")} placeholder="예: 설명의무" />
          </Field>
        </div>

        <Field label="사례 제목" hint="출판물 상단에 강조 표시되는 핵심 제목">
          <input style={inputStyle} value={form.title} onChange={set("title")} placeholder="예: 소아 두개안면 재건술 후 기관 삽관 튜브 이탈..." />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="작성자">
            <input style={inputStyle} value={form.author} onChange={set("author")} placeholder="예: 홍길동" />
          </Field>
          <Field label="환자 인적사항 (이름 제외)">
            <input style={inputStyle} value={form.patientInfo} onChange={set("patientInfo")} placeholder="예: 60대 남성 / 당뇨 병력 있음" />
          </Field>
        </div>

        <Field label="① 사건 개요 (타임라인/경과 내용)">
          <textarea style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} value={form.summary} onChange={set("summary")} placeholder="20XX. 3. 20. - 내원..." />
        </Field>

        <Field label="② 주요 쟁점" hint="줄바꿈으로 구분하면 깔끔한 포인트 목록으로 정렬됩니다">
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.points} onChange={set("points")} />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="감정결과">
            <input style={inputStyle} value={form.assessment} onChange={set("assessment")} />
          </Field>
          <Field label="합의금 요약">
            <input style={inputStyle} value={form.settlement} onChange={set("settlement")} />
          </Field>
        </div>

        <Field label="③ 의학적 판단 및 결과 서술">
          <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.outcome} onChange={set("outcome")} />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="손해배상 신청액">
            <input style={inputStyle} value={form.claimAmount} onChange={set("claimAmount")} />
          </Field>
          <Field label="조정 결과">
            <input style={inputStyle} value={form.adjustmentResult} onChange={set("adjustmentResult")} />
          </Field>
        </div>

        <Field label="④ 예방 시사점 (포인트)">
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.prevention} onChange={set("prevention")} />
        </Field>

        <Field label="상태">
          <div style={{ display: "flex", gap: 8 }}>
            {Object.entries(STATUS).map(([key, s]) => (
              <button
                key={key}
                onClick={() => setForm({ ...form, status: key })}
                style={{
                  padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: form.status === key ? `1.5px solid ${s.color}` : "1px solid #DCE1E2",
                  background: form.status === key ? s.bg : "#FFFFFF",
                  color: form.status === key ? s.color : "#8A97A3",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onCancel} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #DCE1E2", background: "#fff", color: "#5B6B7A", fontWeight: 600, cursor: "pointer" }}>
            취소
          </button>
          <button
            onClick={() => onSave({ ...form, updatedAt: new Date().toISOString() })}
            disabled={!form.title.trim()}
            style={{
              padding: "10px 18px", borderRadius: 8, border: "none", fontWeight: 700, cursor: form.title.trim() ? "pointer" : "not-allowed",
              background: form.title.trim() ? "#0B6E63" : "#B8C4C2", color: "#fff",
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

function toBullets(text) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function CasebookEntry({ c, index }) {
  const s = STATUS[c.status];
  const paddedIndex = String(index).padStart(2, "0");

  return (
    <div className="case-entry" style={{
      background: "#FFFFFF", border: "1px solid #D2E4DF", borderRadius: 16, marginBottom: 32,
      overflow: "hidden", boxShadow: "0 4px 20px rgba(11, 110, 99, 0.05)", breakInside: "avoid",
    }}>
      <div style={{ background: "#F2F9F7", padding: "24px 32px", borderBottom: "1px solid #D2E4DF", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 900, color: "#0B6E63", lineHeight: 1, fontFamily: "'IBM Plex Mono', monospace" }}>
              {paddedIndex}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0B6E63", background: "#E1F2EE", padding: "3px 10px", borderRadius: 6 }}>
              {c.department} · {c.category}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 20, padding: "3px 10px" }}>
              {s.label}
            </span>
          </div>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1C2B39", lineHeight: 1.4 }}>
            {c.title}
          </h3>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr" }} className="case-grid-layout">
        
        <div style={{ background: "#EAF4F1", padding: "28px 24px", borderRight: "1px solid #D2E4DF" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0B6E63", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span>사건 개요</span>
          </div>
          {c.patientInfo && (
            <div style={{ fontSize: 12.5, color: "#2E4D48", background: "#FFFFFF", padding: "10px 12px", borderRadius: 8, marginBottom: 16, border: "1px solid #D2E4DF", lineHeight: 1.5, fontWeight: 600 }}>
              {c.patientInfo}
            </div>
          )}
          <div style={{ fontSize: 13, color: "#33454F", lineHeight: 1.7, whiteSpace: "pre-line" }}>
            {c.summary || "등록된 사건 개요가 없습니다."}
          </div>
        </div>

        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24, background: "#FFFFFF" }}>
          
          {c.points && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0B6E63", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                ② 분쟁 쟁점
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, background: "#F9FBFB", padding: "12px 16px 12px 30px", borderRadius: 8, border: "1px solid #EAEFEF" }}>
                {toBullets(c.points).map((p, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: "#2C3E50", marginBottom: 4, lineHeight: 1.6 }}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0B6E63", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
              ③ 의학적 판단 및 결과
            </div>
            <div style={{ fontSize: 13.5, color: "#2C3E50", lineHeight: 1.8, whiteSpace: "pre-line" }}>
              {c.outcome || c.assessment || "내용이 없습니다."}
            </div>
            
            {(c.claimAmount || c.adjustmentResult) && (
              <div style={{ marginTop: 14, border: "1px solid #E1EDEC", borderRadius: 8, overflow: "hidden" }}>
                {c.claimAmount && (
                  <div style={{ display: "flex", borderBottom: "1px solid #E1EDEC" }}>
                    <div style={{ width: 110, background: "#F2F9F7", padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#0B6E63" }}>손해배상 신청액</div>
                    <div style={{ flex: 1, padding: "10px 14px", fontSize: 13, color: "#33454F" }}>{c.claimAmount}</div>
                  </div>
                )}
                {c.adjustmentResult && (
                  <div style={{ display: "flex" }}>
                    <div style={{ width: 110, background: "#F2F9F7", padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#0B6E63" }}>조정 결과</div>
                    <div style={{ flex: 1, padding: "10px 14px", fontSize: 13, color: "#33454F" }}>{c.adjustmentResult}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {c.prevention && (
            <div style={{ background: "#F4FAF9", borderLeft: "4px solid #0B6E63", padding: "16px 20px", borderRadius: "0 8px 8px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0B6E63", marginBottom: 6 }}>
                ④ 예방 시사점
              </div>
              <div style={{ fontSize: 13.5, color: "#2C3E50", lineHeight: 1.7, whiteSpace: "pre-line" }}>
                {c.prevention}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function buildWordHtml(groups, title) {
  const body = groups.map(([dept, items]) => `
    <h2 style="font-size:18pt;color:#0B6E63;border-bottom:2pt solid #0B6E63;padding-bottom:6pt;margin-top:36pt;">${dept}</h2>
    ${items.map((c, i) => `
      <div style="margin-top:20pt;border:1pt solid #D2E4DF;padding:16pt;border-radius:8pt;">
        <div style="font-size:9pt;color:#8A97A3;font-family:monospace;">${c.id} · ${c.category}${c.author ? " · 작성 " + c.author : ""}</div>
        <h3 style="font-size:15pt;color:#1C2B39;margin:6pt 0 12pt;">Case ${String(i + 1).padStart(2, "0")}. ${c.title}</h3>
        <p style="font-size:10.5pt;background:#EAF4F1;padding:8pt;"><b>[사건 개요]</b><br/>${c.patientInfo ? "환자정보: " + c.patientInfo + "<br/>" : ""}${c.summary || ""}</p>
        ${c.points ? `<p style="font-size:10.5pt;"><b>[분쟁 쟁점]</b><br/>${toBullets(c.points).map((p) => "· " + p).join("<br/>")}</p>` : ""}
        <p style="font-size:10.5pt;"><b>[의학적 판단 및 결과]</b><br/>${c.outcome || ""}</p>
        ${c.claimAmount ? `<p style="font-size:10.5pt;"><b>손해배상 신청액:</b> ${c.claimAmount}</p>` : ""}
        ${c.adjustmentResult ? `<p style="font-size:10.5pt;"><b>조정 결과:</b> ${c.adjustmentResult}</p>` : ""}
        ${c.prevention ? `<p style="font-size:10.5pt;background:#F4FAF9;padding:8pt;"><b>[예방 시사점]</b><br/>${c.prevention}</p>` : ""}
      </div>
    `).join("")}
  `).join("");

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${title}</title>
    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
    <style>body{font-family:'Malgun Gothic',sans-serif;} h1{font-size:24pt;color:#0B6E63;text-align:center;}</style>
    </head><body>
    <h1>${title}</h1>
    <p style="font-size:9pt;color:#8A97A3;text-align:center;">발행일: ${new Date().toLocaleDateString("ko-KR")}</p>
    ${body}
    </body></html>`;
}

export default function MedicalDisputeCasebook() {
  const { cases, loaded, error, upsert, remove, replaceAll } = useCases();
  const [tab, setTab] = useState("list");
  const [editing, setEditing] = useState(null);
  const [filterDept, setFilterDept] = useState("전체");
  const [collapsed, setCollapsed] = useState({});
  const [importMsg, setImportMsg] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [aiSettings, setAiSettings] = useState({ enabled: true, baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL });
  const [showAiSettings, setShowAiSettings] = useState(false);
  const fileInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(AI_SETTINGS_KEY);
        if (res) setAiSettings((prev) => ({ ...prev, ...JSON.parse(res.value) }));
      } catch {}
    })();
  }, []);

  const saveAiSettings = async (next) => {
    setAiSettings(next);
    setShowAiSettings(false);
    try {
      await storage.set(AI_SETTINGS_KEY, JSON.stringify(next));
    } catch {}
  };

  const filtered = useMemo(
    () => (filterDept === "전체" ? cases : cases.filter((c) => c.department === filterDept)),
    [cases, filterDept]
  );

  const groups = useMemo(() => {
    const byDept = {};
    for (const c of cases) {
      if (!byDept[c.department]) byDept[c.department] = [];
      byDept[c.department].push(c);
    }
    return Object.entries(byDept).sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [cases]);

  // 💡 필터용 진료과 목록: 기본 DEPARTMENTS에, 현재 cases에 등록된 모든 고유 진료과를 합쳐서 중복 없이 동적으로 생성
  const filterDepartments = useMemo(() => {
    const customDepts = cases.map(c => c.department).filter(Boolean);
    const all = new Set([...DEPARTMENTS, ...customDepts]);
    return Array.from(all).sort();
  }, [cases]);

  const handleExportJson = () => {
    const target = filterDept === "전체" ? cases : filtered;
    const payload = { exportedAt: new Date().toISOString(), cases: target };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const scope = filterDept === "전체" ? "전체" : filterDept;
    a.href = url;
    a.download = `사례_작업파일_${scope}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incoming = Array.isArray(data) ? data : data.cases;
      if (!Array.isArray(incoming)) throw new Error("invalid format");
      const { merged, added, updated, skipped } = mergeCases(cases, incoming);
      await replaceAll(merged);
      setImportMsg(`가져오기 완료 — 추가 ${added}건 · 업데이트 ${updated}건 · 건너뜀 ${skipped}건`);
    } catch {
      setImportMsg("파일을 읽을 수 없습니다. 올바른 작업 파일(.json)인지 확인해 주세요.");
    } finally {
      e.target.value = "";
    }
  };

  const handlePdfImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfLoading(true);
    try {
      const rawText = await extractPdfText(file);
      let fields = null;
      let usedAi = false;
      let aiError = null;

      if (aiSettings.enabled) {
        try {
          fields = await summarizeWithLocalAI(rawText, { baseUrl: aiSettings.baseUrl, model: aiSettings.model });
          usedAi = true;
        } catch (err) {
          aiError = err.message;
        }
      }

      if (!fields) {
        fields = parseCaseDocument(rawText);
      }

      // 💡 AI가 분석한 진료과와 분쟁유형을 엄격한 검사 없이 그대로 맵핑
      const draft = {
        ...emptyCase(),
        title: fields.title || file.name.replace(/\.pdf$/i, ""),
        department: fields.department || "", // 필터링 조건 삭제, AI 값 그대로 반영
        category: fields.category || "", // 필터링 조건 삭제, AI 값 그대로 반영
        patientInfo: fields.patientInfo || "",
        summary: fields.summary,
        points: fields.points,
        assessment: fields.assessment,
        settlement: fields.settlement,
        outcome: fields.outcome,
        prevention: fields.prevention,
      };

      if (usedAi) {
        setImportMsg("AI가 진료과, 분쟁 유형 및 환자 인적사항을 포함해 문서를 정리했습니다.");
      } else if (aiError) {
        setImportMsg(`AI 연동 실패로 규칙 기반 정리로 대체되었습니다 (${aiError})`);
      } else {
        setImportMsg("PDF 내용을 불러왔습니다. 검토 후 저장해 주세요.");
      }
      setEditing(draft);
    } catch {
      setImportMsg("PDF를 읽는 중 문제가 발생했습니다.");
    } finally {
      setPdfLoading(false);
      e.target.value = "";
    }
  };

  const handlePrint = () => window.print();

  const handleWordExport = () => {
    const html = buildWordHtml(groups, "의료분쟁 사례집");
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `의료분쟁_사례집_${new Date().toISOString().slice(0, 10)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      fontFamily: "'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
      background: "#F5F6F4", minHeight: "100%", color: "#1C2B39",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        button { font-family: inherit; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media print {
          .no-print { display: none !important; }
          .print-area { background: #fff !important; padding: 0 !important; max-width: 100% !important; }
          .case-entry { border: 1px solid #D2E4DF !important; box-shadow: none !important; margin-bottom: 24pt !important; }
        }
      `}</style>

      <div className="no-print" style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "18px 28px", background: "#1C2B39", color: "#fff",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Stamp size={20} color="#6FD6C4" />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>의료분쟁 사례집 편집기 (의사편)</div>
            <div style={{ fontSize: 12, color: "#9AAAB4" }}>{loaded ? `사례 총 ${cases.length}건 등록됨` : "불러오는 중…"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <TabButton active={tab === "list"} onClick={() => setTab("list")}>사례 관리</TabButton>
          <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>출판물 미리보기 · 발행</TabButton>
        </div>
      </div>

      {error && <div className="no-print" style={{ background: "#FBEAEA", color: "#B3261E", padding: "8px 28px", fontSize: 13 }}>{error}</div>}

      {tab === "list" && (
        <div style={{ padding: "22px 28px" }}>
          <div className="no-print" style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} style={{ ...inputStyle, width: 180 }}>
              <option value="전체">전체</option>
              {filterDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => pdfInputRef.current?.click()} disabled={pdfLoading} style={ghostBtnStyle}>
                {pdfLoading ? <Loader2 size={15} className="spin" /> : aiSettings.enabled ? <Sparkles size={15} /> : <FileUp size={15} />}
                {pdfLoading ? "분석 중…" : aiSettings.enabled ? "PDF에서 AI로 불러오기" : "PDF에서 불러오기"}
              </button>
              <button onClick={() => setShowAiSettings(true)} style={{ ...iconBtnStyle, padding: "9px 10px" }} title="로컬 AI 연동 설정">
                <Settings size={15} />
              </button>
              <input ref={pdfInputRef} type="file" accept="application/pdf" onChange={handlePdfImport} style={{ display: "none" }} />
              <button onClick={handleExportJson} style={ghostBtnStyle}>
                <Download size={15} /> 작업 파일 내보내기
              </button>
              <button onClick={() => fileInputRef.current?.click()} style={ghostBtnStyle}>
                <Upload size={15} /> 작업 파일 가져오기
              </button>
              <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} style={{ display: "none" }} />
              <button
                onClick={() => setEditing(emptyCase())}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "none", background: "#0B6E63", color: "#fff", fontWeight: 700, cursor: "pointer" }}
              >
                <Plus size={16} /> 새 사례 등록
              </button>
            </div>
          </div>

          {importMsg && (
            <div className="no-print" style={{
              display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#33454F",
              background: "#EEF3F2", border: "1px solid #DCE1E2", borderRadius: 8, padding: "9px 14px", marginBottom: 16,
            }}>
              <Info size={15} color="#0B6E63" /> {importMsg}
              <button onClick={() => setImportMsg(null)} style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: "#8A97A3" }}>
                <X size={14} />
              </button>
            </div>
          )}

          {loaded && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#8A97A3" }}>등록된 사례가 없습니다. 새 사례를 등록해 보세요.</div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map((c) => {
              const s = STATUS[c.status];
              return (
                <div key={c.id} style={{
                  background: "#fff", border: "1px solid #E4E8E9", borderRadius: 10, padding: "14px 18px",
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div style={{ width: 4, height: 34, borderRadius: 3, background: "#0B6E63", flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "#8A97A3", fontFamily: "'IBM Plex Mono', monospace" }}>
                        {c.id} · {c.department} · {c.category}{c.author ? ` · ${c.author}` : ""}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.title || "(제목 없음)"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 20, padding: "3px 10px" }}>{s.label}</span>
                    <button onClick={() => setEditing(c)} style={iconBtnStyle}><Pencil size={15} /></button>
                    <button onClick={() => { if (confirm("이 사례를 삭제할까요?")) remove(c.id); }} style={{ ...iconBtnStyle, color: "#C0392B" }}><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "preview" && (
        <div>
          <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 28px 0", maxWidth: 900, margin: "0 auto" }}>
            <button onClick={handlePrint} style={ghostBtnStyle}><Printer size={15} /> 인쇄 및 PDF 저장</button>
            <button onClick={handleWordExport} style={solidBtnStyle}><FileDown size={15} /> Word 출판 파일 발행</button>
          </div>
          <div className="print-area" style={{ maxWidth: 900, margin: "0 auto", padding: "24px 28px 60px" }}>
            <div style={{ textAlign: "center", marginBottom: 40, borderBottom: "2px solid #0B6E63", paddingBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#0B6E63", letterSpacing: 3, fontWeight: 700 }}>MEDICAL DISPUTE CASEBOOK</div>
              <h1 style={{ fontSize: 32, fontWeight: 900, color: "#1C2B39", margin: "8px 0" }}>의료분쟁 사례집</h1>
              <div style={{ fontSize: 12.5, color: "#5B6B7A" }}>발행일 {new Date().toLocaleDateString("ko-KR")} · 총 수록 {cases.length}건</div>
            </div>
            {groups.length === 0 && <div style={{ textAlign: "center", color: "#8A97A3", padding: "40px 0" }}>등록된 사례가 없습니다.</div>}
            {groups.map(([dept, items]) => (
              <div key={dept} style={{ marginBottom: 36 }}>
                <div
                  className="no-print"
                  onClick={() => setCollapsed((p) => ({ ...p, [dept]: !p[dept] }))}
                  style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 16 }}
                >
                  {collapsed[dept] ? <ChevronRight size={18} color="#0B6E63" /> : <ChevronDown size={18} color="#0B6E63" />}
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0B6E63", borderBottom: "2px solid #0B6E63", flex: 1, paddingBottom: 6, margin: 0 }}>
                    {dept} <span style={{ fontWeight: 500, fontSize: 14, color: "#8A97A3" }}>({items.length}건)</span>
                  </h2>
                </div>
                <h2 style={{ display: "none" }} className="print-only">{dept}</h2>
                {!collapsed[dept] && items.map((c, i) => <CasebookEntry key={c.id} c={c} index={i + 1} />)}
              </div>
            ))}
          </div>
        </div>
      )}

      {showAiSettings && (
        <AiSettingsModal
          settings={aiSettings}
          onCancel={() => setShowAiSettings(false)}
          onSave={saveAiSettings}
        />
      )}

      {editing && (
        <CaseForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={(item) => { upsert(item); setEditing(null); }}
        />
      )}
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13.5,
      background: active ? "#0B6E63" : "transparent", color: active ? "#fff" : "#9AAAB4",
    }}>
      {children}
    </button>
  );
}

const iconBtnStyle = { border: "1px solid #DCE1E2", background: "#fff", borderRadius: 6, padding: 6, cursor: "pointer", color: "#5B6B7A", display: "flex" };
const ghostBtnStyle = { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "1px solid #DCE1E2", background: "#fff", color: "#33454F", fontWeight: 700, cursor: "pointer", fontSize: 13.5 };
const solidBtnStyle = { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "none", background: "#0B6E63", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13.5 };
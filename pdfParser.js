import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// 💡 추가된 비식별화(마스킹) 함수
function maskSensitiveData(text) {
  let maskedText = text;
  
  // 1. 주민등록번호 마스킹 (예: 900101-1234567 -> 900101-*******)
  maskedText = maskedText.replace(/(\d{6})\s*[-]?\s*([1-4]\d{6})/g, "$1-*******");
  
  // 2. 휴대폰 번호 마스킹 (예: 010-1234-5678 -> 010-****-****)
  maskedText = maskedText.replace(/(010|011|016|017|018|019)\s*[-]?\s*(\d{3,4})\s*[-]?\s*(\d{4})/g, "$1-****-****");
  
  return maskedText;
}

// PDF 파일에서 전체 텍스트를 추출합니다 (페이지 구분은 줄바꿈 두 번으로 표시).
export async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lineText = content.items.map((item) => item.str).join(" ");
    pageTexts.push(lineText);
  }
  
  const fullText = pageTexts.join("\n\n");
  
  // 💡 텍스트 반환 직전에 마스킹 함수를 거치도록 처리
  return maskSensitiveData(fullText);
}

// ① 사건 개요 / ② 주요 쟁점 / ③ 결과 / ④ 예방 포인트 형식의 문서를
// 정규식 패턴으로 잘라 사례 필드에 맞게 정리합니다.
// 문서가 이 양식을 따르지 않으면 정확도가 떨어질 수 있어, 항상 사용자가 결과를 검토하도록 안내합니다.
const SECTION_PATTERNS = [
  { key: "summary", label: "사건 개요", patterns: [/①\s*사건\s*개요/, /1\s*[.)]\s*사건\s*개요/, /사건\s*개요/] },
  { key: "points", label: "주요 쟁점", patterns: [/②\s*주요\s*쟁점/, /2\s*[.)]\s*주요\s*쟁점/, /주요\s*쟁점/] },
  { key: "result", label: "결과", patterns: [/③\s*결과/, /3\s*[.)]\s*결과/, /(?:^|\n)\s*결과\s*(?:\n|:)/] },
  { key: "prevention", label: "예방 포인트", patterns: [/④\s*예방\s*포인트/, /4\s*[.)]\s*예방\s*포인트/, /예방\s*포인트/] },
];

function findFirstMatch(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return { index: m.index, matchedLength: m[0].length };
  }
  return null;
}

function toBulletText(block) {
  return block
    .split("\n")
    .map((l) => l.replace(/^[-•·\u2022]\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

export function parseCaseDocument(rawText) {
  const text = rawText.replace(/\r/g, "");

  const hits = SECTION_PATTERNS
    .map((s) => {
      const m = findFirstMatch(text, s.patterns);
      return m ? { ...s, start: m.index, headerEnd: m.index + m.matchedLength } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const fields = { summary: "", points: "", result: "", prevention: "" };
  let matchedSectionCount = hits.length;

  hits.forEach((hit, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const block = text.slice(hit.headerEnd, end).trim();
    fields[hit.key] = hit.key === "points" || hit.key === "prevention" ? toBulletText(block) : block;
  });

  // 제목 후보: 첫 매칭 지점 이전의 텍스트 중 마지막 줄 (보통 "Case 1. ○○○ 사례" 형태)
  let titleGuess = "";
  if (hits.length > 0) {
    const before = text.slice(0, hits[0].start).trim();
    const lines = before.split("\n").map((l) => l.trim()).filter(Boolean);
    titleGuess = lines[lines.length - 1] || "";
    titleGuess = titleGuess.replace(/^\(?예시\)?/, "").trim();
  }

  // 결과 블록 안에서 감정결과 / 합의금을 별도로 뽑아봅니다 (있으면 사용, 없으면 통짜로 outcome에 둠).
  let assessment = "";
  let settlement = "";
  let outcome = fields.result;
  const assessMatch = fields.result.match(/감정\s*결과[:\s]*([^\n]+)/);
  const settleMatch = fields.result.match(/합의금[:\s]*([^\n]+)/);
  if (assessMatch) assessment = assessMatch[1].trim();
  if (settleMatch) settlement = settleMatch[1].trim();
  if (assessMatch || settleMatch) {
    outcome = fields.result
      .replace(/감정\s*결과[:\s]*([^\n]+)/, "")
      .replace(/합의금[:\s]*([^\n]+)/, "")
      .trim();
  }

  return {
    title: titleGuess,
    summary: fields.summary,
    points: fields.points,
    assessment,
    settlement,
    outcome,
    prevention: fields.prevention,
    matchedSectionCount,
    rawText: text,
  };
}
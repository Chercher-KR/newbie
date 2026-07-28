// LM Studio의 로컬 서버(OpenAI 호환 API)에 문서를 보내
// 사례 등록 폼 스키마에 맞는 JSON으로 정리해 받아오는 모듈입니다.
// LM Studio 앱에서 모델을 불러온 뒤 "Local Server" 탭에서 서버를 켜야 동작합니다.

export const DEFAULT_BASE_URL = "http://localhost:1234";
export const DEFAULT_MODEL = "local-model";

const SYSTEM_PROMPT = `당신은 한국 의료기관의 의료분쟁 사례집 편집을 돕는 보조원입니다.
주어진 문서를 아래 JSON 스키마 하나로만 정리해서 출력하세요.

{
  "department": "진료과 (내과, 외과, 정형외과, 산부인과, 소아청소년과, 신경외과, 응급의학과, 마취통증의학과, 기타 중 가장 적절한 1개 선택)",
  "category": "분쟁 유형 (설명의무, 진단지연, 수술, 투약, 검사, 감염, 기타 중 가장 적절한 1개 선택)",
  "patientInfo": "환자 인적사항 (환자 이름은 절대 포함하지 말고 연령, 성별, 기저질환 등만 요약. 예: '60대 남성 / 당뇨 병력' 또는 '생후 14개월 여아 / 병력 없음')",
  "title": "사례를 한 줄로 요약한 제목",
  "summary": "① 사건 개요 - 무슨 일이 있었는지 3~5문장",
  "points": ["② 주요 쟁점 항목1", "항목2"],
  "assessment": "감정결과 요약 (근거가 없으면 빈 문자열)",
  "settlement": "합의금 등 결과 수치 (근거가 없으면 빈 문자열)",
  "outcome": "③ 결과에 대한 서술 요약",
  "prevention": ["④ 예방 포인트 항목1", "항목2"]
}

규칙:
- 반드시 위 JSON 객체 하나만 출력하세요. 다른 설명이나 마크다운 코드블록을 덧붙이지 마세요.
- 문서에 없는 내용을 추측해서 만들어내지 마세요. 근거가 없으면 빈 문자열이나 빈 배열로 두세요.
- 환자의 실명 등 개인 식별 정보가 문서에 남아있다면 절대 포함하지 마세요.
- 공식적이고 건조한 문어체를 사용하세요.`;

function extractJsonBlock(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function toBulletText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  return typeof value === "string" ? value : "";
}

export async function summarizeWithLocalAI(rawText, { baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL } = {}) {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: rawText.slice(0, 12000) },
        ],
      }),
    });
  } catch {
    throw new Error("LM Studio 로컬 서버에 연결할 수 없습니다. LM Studio에서 모델을 불러오고 서버를 켰는지 확인해 주세요.");
  }

  if (!res.ok) {
    throw new Error(`로컬 서버가 오류를 반환했습니다 (status ${res.status}). 모델이 실제로 로드되어 있는지 확인해 주세요.`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const jsonBlock = extractJsonBlock(content);
  if (!jsonBlock) {
    throw new Error("AI 응답에서 JSON 형식을 찾지 못했습니다. 문서가 너무 짧거나 모델이 지시를 따르지 못했을 수 있습니다.");
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    throw new Error("AI가 반환한 JSON 형식이 올바르지 않습니다. 다시 시도해 보시거나 규칙 기반 정리를 이용해 주세요.");
  }

  return {
    department: typeof parsed.department === "string" ? parsed.department : "",
    category: typeof parsed.category === "string" ? parsed.category : "",
    patientInfo: typeof parsed.patientInfo === "string" ? parsed.patientInfo : "",
    title: typeof parsed.title === "string" ? parsed.title : "",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    points: toBulletText(parsed.points),
    assessment: typeof parsed.assessment === "string" ? parsed.assessment : "",
    settlement: typeof parsed.settlement === "string" ? parsed.settlement : "",
    outcome: typeof parsed.outcome === "string" ? parsed.outcome : "",
    prevention: toBulletText(parsed.prevention),
  };
}
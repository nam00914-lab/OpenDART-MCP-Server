import { redact } from "@/lib/extra-keys";

/**
 * 한국은행 ECOS Open API client.
 * URL pattern: {base}/{Service}/{Key}/json/kr/{start}/{end}/{...extra}
 * Responses: { "<Service>": { list_total_count, row: [...] } } or { RESULT: { CODE, MESSAGE } }.
 * INFO-200 (해당 데이터 없음) is returned as an empty list, not an error.
 */
const BASE_URL = "https://ecos.bok.or.kr/api";
const TIMEOUT = 30000;
const NO_DATA = "INFO-200";

export type EcosRow = Record<string, string | number | null | undefined>;

export class EcosError extends Error {
  constructor(public code: string, message: string) {
    super(`[ECOS ${code}] ${message}`);
  }
}

export function buildEcosUrl(service: string, key: string, start: number, end: number, extra: string[] = []): string {
  // Slashes inside a segment break the path (and trip the BOK firewall) — replace with a space.
  const seg = (s: string) => encodeURIComponent(String(s).replace(/\//g, " ").trim());
  return [BASE_URL, service, key, "json", "kr", String(start), String(end), ...extra].map((s, i) => (i === 0 ? s : seg(s))).join("/");
}

export function extractEcos(data: unknown, service: string): { total: number; rows: EcosRow[] } {
  const d = (data ?? {}) as Record<string, unknown>;
  const top = d.RESULT as { CODE?: string; MESSAGE?: string } | undefined;
  if (top) {
    if (top.CODE === NO_DATA) return { total: 0, rows: [] };
    throw new EcosError(top.CODE ?? "UNKNOWN", top.MESSAGE ?? "알 수 없는 오류");
  }
  const body = d[service] as { list_total_count?: number | string; row?: EcosRow[]; RESULT?: { CODE?: string; MESSAGE?: string } } | undefined;
  if (!body) throw new EcosError("PARSE_ERROR", `예상치 못한 응답 구조입니다('${service}' 없음).`);
  if (body.RESULT?.CODE && body.RESULT.CODE !== NO_DATA && !body.RESULT.CODE.startsWith("INFO-000")) {
    throw new EcosError(body.RESULT.CODE, body.RESULT.MESSAGE ?? "");
  }
  if (body.RESULT?.CODE === NO_DATA) return { total: 0, rows: [] };
  return { total: Number(body.list_total_count ?? 0), rows: Array.isArray(body.row) ? body.row : [] };
}

export async function ecosRequest(service: string, key: string, start: number, end: number, extra: string[] = []): Promise<{ total: number; rows: EcosRow[] }> {
  const url = buildEcosUrl(service, key, start, end, extra);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new EcosError("NETWORK", redact(e instanceof Error ? e.message : String(e), key));
  }
  if (!res.ok) throw new EcosError(`HTTP_${res.status}`, "ECOS 서버 응답 오류입니다. 잠시 후 다시 시도하세요.");
  const json = await res.json();
  return extractEcos(json, service);
}

// ── 통계표 목록(약 1천 개) — 인스턴스 메모리 캐시 6시간 ──
let tableCache: { at: number; rows: EcosRow[] } | null = null;
const TABLE_TTL = 6 * 60 * 60 * 1000;

export async function getAllTables(key: string): Promise<EcosRow[]> {
  if (tableCache && Date.now() - tableCache.at < TABLE_TTL) return tableCache.rows;
  const { rows } = await ecosRequest("StatisticTableList", key, 1, 10000);
  tableCache = { at: Date.now(), rows };
  return rows;
}

/** 기업경영분석(연간 · 11차 KSIC · 2009~) 통계표 — 업종 평균 재무비율 비교의 기준선 */
export const BUSINESS_ANALYSIS_TABLES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "501Y005", name: "성장성 지표(매출액증가율 등)" },
  { code: "501Y006", name: "손익 지표(매출액영업이익률 등)" },
  { code: "501Y007", name: "자산/자본 지표(부채비율 · 자기자본비율 등)" },
  { code: "501Y008", name: "자산/자본 회전율" },
  { code: "501Y009", name: "생산성 지표" },
];

export function toMarkdownTable(rows: EcosRow[], cols: string[], headers?: string[]): string {
  if (!rows.length) return "(데이터 없음)";
  const h = headers ?? cols;
  const esc = (v: unknown) => String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
  return [`| ${h.join(" | ")} |`, `| ${h.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${cols.map((c) => esc(r[c])).join(" | ")} |`)].join("\n");
}

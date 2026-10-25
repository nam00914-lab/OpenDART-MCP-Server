import { redact } from "@/lib/extra-keys";

/**
 * 기업마당(중소벤처기업부) 지원사업 공고 API.
 * GET https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=..&dataType=json&pageUnit=..&pageIndex=..[&hashtags=지역]
 * 응답 = { jsonArray: [ { pblancNm, pblancUrl, jrsdInsttNm, excInsttNm, pldirSportRealmLclasCodeNm, reqstBeginEndDe, trgetNm, hashtags, bsnsSumryCn, creatPnttm, pblancId } ] }
 */
const API_URL = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
const SITE = "https://www.bizinfo.go.kr";
const TIMEOUT = 30000;

export interface Announcement {
  id: string;
  title: string;
  agency: string;
  executor: string;
  field: string;
  period: string;
  periodEnd: string | null; // YYYYMMDD (마지막 8자리 날짜) · 없으면 null(상시·예산 소진 시 등)
  target: string;
  tags: string;
  summary: string;
  registered: string;
  link: string;
}

const s = (v: unknown) => (v ?? "").toString().trim();
const stripHtml = (v: string) => v.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function normalizeAnnouncement(raw: Record<string, unknown>): Announcement {
  const period = s(raw.reqstBeginEndDe) || s(raw.reqstDt);
  const dates = period.replace(/[.\-]/g, "").match(/\d{8}/g);
  const link = s(raw.pblancUrl) || s(raw.link);
  return {
    id: s(raw.pblancId) || s(raw.seq),
    title: s(raw.pblancNm) || s(raw.title),
    agency: s(raw.jrsdInsttNm) || s(raw.author),
    executor: s(raw.excInsttNm),
    field: s(raw.pldirSportRealmLclasCodeNm) || s(raw.lcategory),
    period,
    periodEnd: dates && dates.length ? dates[dates.length - 1] : null,
    target: s(raw.trgetNm),
    tags: s(raw.hashtags) || s(raw.hashTags),
    summary: stripHtml(s(raw.bsnsSumryCn) || s(raw.description)),
    registered: s(raw.creatPnttm) || s(raw.pubDate),
    link: link.startsWith("http") ? link : link ? `${SITE}${link}` : "",
  };
}

export async function fetchAnnouncements(key: string, opts: { pageIndex: number; pageUnit: number; region?: string }): Promise<Announcement[]> {
  const p = new URLSearchParams({ crtfcKey: key, dataType: "json", pageIndex: String(opts.pageIndex), pageUnit: String(opts.pageUnit) });
  if (opts.region) p.set("hashtags", opts.region);
  let res: Response;
  try {
    res = await fetch(`${API_URL}?${p.toString()}`, { signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new Error(`[기업마당] 네트워크 오류 — ${redact(e instanceof Error ? e.message : String(e), key)}`);
  }
  if (!res.ok) throw new Error(`[기업마당] 서버 응답 오류(HTTP ${res.status})`);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`[기업마당] JSON 이 아닌 응답입니다 — 인증키를 확인하세요. (${redact(text.slice(0, 120), key)})`);
  }
  const arr = (json as { jsonArray?: unknown }).jsonArray ?? json;
  const list = Array.isArray(arr) ? arr : arr ? [arr] : [];
  return list.map((r) => normalizeAnnouncement((r ?? {}) as Record<string, unknown>));
}

export interface AnnouncementFilter {
  keywords?: string[];
  target?: string;
  field?: string;
  onlyOpen?: boolean;
  today?: string; // YYYYMMDD (테스트용 주입)
}

export function filterAnnouncements(items: Announcement[], f: AnnouncementFilter): Announcement[] {
  const today = f.today ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const hay = (a: Announcement) => `${a.title} ${a.summary} ${a.tags} ${a.target} ${a.field} ${a.agency}`;
  return items.filter((a) => {
    if (f.onlyOpen !== false && a.periodEnd && a.periodEnd < today) return false;
    if (f.field && !a.field.includes(f.field)) return false;
    if (f.target && !`${a.target} ${a.title} ${a.summary} ${a.tags}`.includes(f.target)) return false;
    if (f.keywords?.length && !f.keywords.every((k) => hay(a).includes(k))) return false;
    return true;
  });
}

export function formatAnnouncements(items: Announcement[], max: number): string {
  if (!items.length) return "조건에 맞는 공고가 없습니다. 키워드를 줄이거나 only_open=false 로 다시 찾아보세요.";
  return items.slice(0, max).map((a, i) =>
    `${i + 1}. **${a.title}**\n` +
    `   - 소관: ${a.agency || "—"} / 수행: ${a.executor || "—"} / 분야: ${a.field || "—"}\n` +
    `   - 신청기간: ${a.period || "—"} / 등록일: ${a.registered || "—"}\n` +
    `   - 대상: ${a.target || "—"}${a.tags ? ` / 태그: ${a.tags}` : ""}\n` +
    (a.summary ? `   - 요약: ${a.summary.slice(0, 180)}${a.summary.length > 180 ? "…" : ""}\n` : "") +
    `   - 링크: ${a.link || "—"}`
  ).join("\n");
}

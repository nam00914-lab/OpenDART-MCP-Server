// Mock tests for ECOS · 기업마당 tools (no network). Run: npx tsx scripts/test-extra-tools.ts
import { buildEcosUrl, extractEcos } from "../lib/ecos/client";
import { normalizeAnnouncement, filterAnnouncements } from "../lib/bizinfo/client";
import { runWithExtraKeys, resolveEcosKey, resolveBizinfoKey, redact } from "../lib/extra-keys";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✅" : "❌"} ${n}`); };

ok("ECOS URL 조립(슬래시 치환·인코딩)", buildEcosUrl("StatisticSearch", "KEY", 1, 10, ["501Y007", "A", "2020", "2023", "C10/식료품"]) === "https://ecos.bok.or.kr/api/StatisticSearch/KEY/json/kr/1/10/501Y007/A/2020/2023/" + encodeURIComponent("C10 식료품"));
ok("ECOS 정상 응답", extractEcos({ StatisticSearch: { list_total_count: 2, row: [{ TIME: "2023" }, { TIME: "2022" }] } }, "StatisticSearch").rows.length === 2);
ok("ECOS INFO-200 = 빈 결과", extractEcos({ RESULT: { CODE: "INFO-200", MESSAGE: "없음" } }, "X").rows.length === 0);
let threw = false; try { extractEcos({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키 오류" } }, "X"); } catch (e) { threw = /INFO-100/.test(String(e)); }
ok("ECOS 인증 오류 = 오류 메시지", threw);

const a = normalizeAnnouncement({ pblancId: "P1", pblancNm: "식품 스마트공장 구축 지원", pblancUrl: "/web/x.do?a=1", jrsdInsttNm: "중소벤처기업부", pldirSportRealmLclasCodeNm: "기술", reqstBeginEndDe: "20261001 ~ 20261110", trgetNm: "중소기업", hashtags: "충청남도,식품", bsnsSumryCn: "<p>스마트공장&nbsp;지원</p>" });
ok("기업마당 정규화(링크 절대경로·마감일·HTML 제거)", a.link === "https://www.bizinfo.go.kr/web/x.do?a=1" && a.periodEnd === "20261110" && a.summary === "스마트공장 지원");
const b = normalizeAnnouncement({ pblancId: "P2", pblancNm: "수출 바우처", reqstBeginEndDe: "20260101 ~ 20260301", pldirSportRealmLclasCodeNm: "수출" });
const c = normalizeAnnouncement({ pblancId: "P3", pblancNm: "상시 정책자금", reqstBeginEndDe: "예산 소진 시까지", pldirSportRealmLclasCodeNm: "금융" });
const today = "20261025";
ok("마감 지난 공고 제외 · 기간 미표기는 유지", filterAnnouncements([a, b, c], { onlyOpen: true, today }).map((x) => x.id).join() === "P1,P3");
ok("키워드 모두 포함", filterAnnouncements([a, b, c], { keywords: ["식품", "스마트공장"], today }).map((x) => x.id).join() === "P1");
ok("분야 필터", filterAnnouncements([a, b, c], { field: "금융", today }).map((x) => x.id).join() === "P3");
ok("only_open=false = 마감 포함", filterAnnouncements([a, b, c], { onlyOpen: false, today }).length === 3);

delete process.env.ECOS_API_KEY; delete process.env.BIZINFO_API_KEY;
let noKey = false; try { resolveEcosKey(); } catch { noKey = true; }
ok("키 없음 = 안내 오류", noKey);
ok("URL 키는 그 요청 안에서만", runWithExtraKeys({ ecos: "U1", bizinfo: "B1" }, () => resolveEcosKey() === "U1" && resolveBizinfoKey() === "B1"));
process.env.ECOS_API_KEY = "ENV1";
ok("요청 밖 = 환경변수", resolveEcosKey() === "ENV1");
ok("키 가리기", redact("url /api/X/SECRETKEY/json", "SECRETKEY") === "url /api/X/***/json");
console.log(`\n${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);

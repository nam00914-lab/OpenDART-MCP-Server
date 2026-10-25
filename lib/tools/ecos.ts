import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveEcosKey } from "@/lib/extra-keys";
import { BUSINESS_ANALYSIS_TABLES, ecosRequest, getAllTables, toMarkdownTable, type EcosRow } from "@/lib/ecos/client";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true });
const apiKeyArg = z.string().optional().describe("Optional: ECOS 인증키(보통 비워 둠 — 서버 환경변수 사용)");

export function registerEcosTools(server: McpServer) {
  server.registerTool(
    "ecos_business_analysis_guide",
    {
      title: "업종 평균 재무비율 조회 안내 (한국은행 기업경영분석)",
      description: `Bank of Korea ECOS — 업종별 평균 재무비율(기업경영분석) 조회 순서 안내와 통계표 코드.
회원사 재무를 업종 평균과 비교할 때 먼저 호출하세요. 연간·11차 KSIC(2009~) 통계표 5개 코드를 돌려줍니다.
순서: ① 이 도구로 통계표 코드 확인 → ② ecos_list_items 로 그 표의 항목(업종·지표·기업규모) 코드 찾기 → ③ ecos_get_series 로 연도별 값 조회.`,
      inputSchema: {},
      annotations: RO,
    },
    async () =>
      text(
        "## 한국은행 기업경영분석(연간 · 제11차 KSIC · 2009~)\n\n" +
          toMarkdownTable(BUSINESS_ANALYSIS_TABLES as unknown as EcosRow[], ["code", "name"], ["통계표 코드", "내용"]) +
          "\n\n**조회 순서**\n1. `ecos_list_items(stat_code, keyword)` — 업종명(예: '식료품')·지표명(예: '부채비율')으로 항목 코드 찾기. GRP 열 = 몇 번째 항목 자리(ITEM_CODE1~4)인지.\n" +
          "2. `ecos_get_series(stat_code, cycle='A', start, end, item_code1.., )` — 연도별 값.\n" +
          "3. 회원사 값(DART 또는 시스템 재무)과 나란히 비교. 기업규모(대기업·중소기업) 항목이 있으면 회원사 규모에 맞춰 고르세요.\n" +
          "※ 분기 지표는 502Y001~502Y004(cycle='Q'), 지역별은 503Y005~503Y010. 다른 통계는 `ecos_search_tables` 로 찾으세요."
      )
  );

  server.registerTool(
    "ecos_search_tables",
    {
      title: "ECOS 통계표 검색",
      description: `한국은행 ECOS 통계표 목록에서 이름으로 검색합니다(예: '기업경영분석', '기준금리', '생산자물가').
조회 가능한 표(SRCH_YN=Y)만 돌려줍니다. 결과의 STAT_CODE 를 ecos_list_items / ecos_get_series 에 쓰세요.`,
      inputSchema: {
        keyword: z.string().min(1).describe("통계표 이름 검색어"),
        max: z.number().int().min(1).max(100).optional().describe("최대 건수(기본 30)"),
        api_key: apiKeyArg,
      },
      annotations: RO,
    },
    async ({ keyword, max, api_key }) => {
      try {
        const rows = (await getAllTables(resolveEcosKey(api_key))).filter((r) => String(r.SRCH_YN) === "Y" && String(r.STAT_NAME ?? "").includes(keyword));
        return text(`## '${keyword}' 통계표 ${rows.length}건\n\n` + toMarkdownTable(rows.slice(0, max ?? 30), ["STAT_CODE", "STAT_NAME", "CYCLE", "ORG_NAME"], ["코드", "이름", "주기", "작성기관"]));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "ecos_list_items",
    {
      title: "ECOS 통계표 항목 코드",
      description: `통계표의 항목(업종 · 지표 · 기업규모 등) 코드를 조회합니다. keyword 로 항목명 필터(예: '식료품', '부채비율', '중소기업').
GRP_CODE(Group1~4)가 ecos_get_series 의 item_code1~4 자리입니다.`,
      inputSchema: {
        stat_code: z.string().min(3).describe("통계표 코드(예: 501Y007)"),
        keyword: z.string().optional().describe("항목명 필터(여러 개는 쉼표 — 하나라도 포함)"),
        max: z.number().int().min(1).max(300).optional().describe("최대 건수(기본 80)"),
        api_key: apiKeyArg,
      },
      annotations: RO,
    },
    async ({ stat_code, keyword, max, api_key }) => {
      try {
        const { rows } = await ecosRequest("StatisticItemList", resolveEcosKey(api_key), 1, 10000, [stat_code]);
        const kws = (keyword ?? "").split(",").map((k) => k.trim()).filter(Boolean);
        const hit = kws.length ? rows.filter((r) => kws.some((k) => String(r.ITEM_NAME ?? "").includes(k))) : rows;
        const groups = Array.from(new Set(rows.map((r) => `${r.GRP_CODE}=${r.GRP_NAME}`))).join(" · ");
        return text(
          `## ${stat_code} 항목 ${hit.length}건 (전체 ${rows.length})\n그룹: ${groups || "—"}\n\n` +
            toMarkdownTable(hit.slice(0, max ?? 80), ["GRP_CODE", "GRP_NAME", "ITEM_CODE", "ITEM_NAME", "P_ITEM_NAME", "CYCLE", "START_TIME", "END_TIME", "UNIT_NAME"], ["GRP", "그룹명", "항목코드", "항목명", "상위", "주기", "시작", "끝", "단위"])
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "ecos_get_series",
    {
      title: "ECOS 통계 값 조회",
      description: `통계표 값을 기간으로 조회합니다(StatisticSearch).
cycle: A=연, S=반기, Q=분기, M=월, D=일. 기간 형식: A '2023' / Q '2023Q1' / M '202301' / D '20230101'.
item_code1~4 는 ecos_list_items 의 GRP 순서대로. 중간 자리를 건너뛰려면 '?' 를 넣으세요.`,
      inputSchema: {
        stat_code: z.string().min(3),
        cycle: z.enum(["A", "S", "Q", "M", "SM", "D"]),
        start: z.string().min(4).describe("시작 기간"),
        end: z.string().min(4).describe("끝 기간"),
        item_code1: z.string().optional(),
        item_code2: z.string().optional(),
        item_code3: z.string().optional(),
        item_code4: z.string().optional(),
        max: z.number().int().min(1).max(1000).optional().describe("최대 행(기본 300)"),
        api_key: apiKeyArg,
      },
      annotations: RO,
    },
    async ({ stat_code, cycle, start, end, item_code1, item_code2, item_code3, item_code4, max, api_key }) => {
      try {
        const items = [item_code1, item_code2, item_code3, item_code4];
        while (items.length && !items[items.length - 1]) items.pop();
        const extra = [stat_code, cycle, start, end, ...items.map((c) => c || "?")];
        const { total, rows } = await ecosRequest("StatisticSearch", resolveEcosKey(api_key), 1, max ?? 300, extra);
        const cols = ["TIME", "ITEM_NAME1", "ITEM_NAME2", "ITEM_NAME3", "ITEM_NAME4", "DATA_VALUE", "UNIT_NAME"].filter((c) => rows.some((r) => r[c] != null && r[c] !== ""));
        return text(`## ${rows[0]?.STAT_NAME ?? stat_code} (${start}~${end} · ${rows.length}/${total}행)\n\n` + toMarkdownTable(rows, cols));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "ecos_key_statistics",
    {
      title: "한국은행 100대 통계지표",
      description: "기준금리 · 환율 · 물가 · 성장률 등 주요 지표 최신값(KeyStatisticList). 경영환경 요약에 씁니다.",
      inputSchema: { keyword: z.string().optional().describe("지표명/분류 필터(예: '금리', '환율')"), api_key: apiKeyArg },
      annotations: RO,
    },
    async ({ keyword, api_key }) => {
      try {
        const { rows } = await ecosRequest("KeyStatisticList", resolveEcosKey(api_key), 1, 200);
        const hit = keyword ? rows.filter((r) => `${r.CLASS_NAME} ${r.KEYSTAT_NAME}`.includes(keyword)) : rows;
        return text(`## 100대 통계지표 ${hit.length}건\n\n` + toMarkdownTable(hit, ["CLASS_NAME", "KEYSTAT_NAME", "DATA_VALUE", "UNIT_NAME", "CYCLE"], ["분류", "지표", "값", "단위", "시점"]));
      } catch (e) {
        return fail(e);
      }
    }
  );
}

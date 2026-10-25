import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveBizinfoKey } from "@/lib/extra-keys";
import { fetchAnnouncements, filterAnnouncements, formatAnnouncements, type Announcement } from "@/lib/bizinfo/client";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export function registerBizinfoTools(server: McpServer) {
  server.registerTool(
    "bizinfo_search_announcements",
    {
      title: "정부지원사업 공고 검색 (기업마당)",
      description: `중소벤처기업부 기업마당의 정부지원사업 공고를 검색합니다(최신 등록순 최대 pages×100건을 받아 조건으로 거름).
회원사 조건에 맞는 공고 찾기, 마감 임박 공고 확인에 씁니다.

Args:
  - keywords: 모두 포함해야 하는 단어(쉼표 구분 · 예: '식품,스마트공장')
  - region: 지역(예: '경기도', '충청남도', '서울') — 기업마당 지역 태그
  - target: 대상(예: '중소기업', '소상공인', '창업기업', '여성')
  - field: 지원분야(금융 · 기술 · 인력 · 수출 · 내수 · 창업 · 경영 · 기타)
  - only_open: 신청기간이 지난 공고 제외(기본 true · 기간 미표기 공고는 남김)
  - pages: 받아올 페이지 수(1~5, 기본 3 = 최신 300건)`,
      inputSchema: {
        keywords: z.string().optional(),
        region: z.string().optional(),
        target: z.string().optional(),
        field: z.string().optional(),
        only_open: z.boolean().optional(),
        pages: z.number().int().min(1).max(5).optional(),
        max: z.number().int().min(1).max(50).optional().describe("표시 최대 건수(기본 20)"),
        api_key: z.string().optional().describe("Optional: 기업마당 인증키(보통 비워 둠 — 서버 환경변수 사용)"),
      },
      annotations: RO,
    },
    async ({ keywords, region, target, field, only_open, pages, max, api_key }) => {
      try {
        const key = resolveBizinfoKey(api_key);
        const all: Announcement[] = [];
        for (let i = 1; i <= (pages ?? 3); i++) {
          const batch = await fetchAnnouncements(key, { pageIndex: i, pageUnit: 100, region });
          all.push(...batch);
          if (batch.length < 100) break;
        }
        const seen = new Set<string>();
        const uniq = all.filter((a) => { const k = a.id || a.title; if (seen.has(k)) return false; seen.add(k); return true; });
        const hit = filterAnnouncements(uniq, {
          keywords: (keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
          target,
          field,
          onlyOpen: only_open,
        });
        hit.sort((a, b) => (a.periodEnd ?? "99999999").localeCompare(b.periodEnd ?? "99999999"));
        return {
          content: [{ type: "text" as const, text: `## 기업마당 공고 ${hit.length}건 (조회 ${uniq.length}건 중 · 마감 빠른 순)\n\n${formatAnnouncements(hit, max ?? 20)}\n\n※ 자격·제외 조건은 공고문 원문으로 최종 확인하세요.` }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
    }
  );
}

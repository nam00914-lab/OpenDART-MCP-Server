import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped keys for the non-DART sources (ECOS · 기업마당).
 * Same rule as the OpenDART key: a key given in the connector URL must stay
 * scoped to its own request (no module globals — reused instances would leak it).
 * Resolution order: tool argument → connector URL parameter → environment variable.
 */
type ExtraKeys = { ecos?: string; bizinfo?: string };
const ctx = new AsyncLocalStorage<ExtraKeys>();

export function runWithExtraKeys<T>(keys: ExtraKeys, fn: () => T): T {
  return ctx.run(
    { ecos: keys.ecos || undefined, bizinfo: keys.bizinfo || undefined },
    fn
  );
}

export function resolveEcosKey(toolKey?: string): string {
  const key = toolKey || ctx.getStore()?.ecos || process.env.ECOS_API_KEY;
  if (!key) {
    throw new Error(
      "[ECOS] API 키가 없습니다. https://ecos.bok.or.kr/api 에서 무료로 발급받아 Vercel 환경변수 ECOS_API_KEY 에 넣거나, 커넥터 URL 에 &ecos_key=발급키 를 붙이세요."
    );
  }
  return key;
}

export function resolveBizinfoKey(toolKey?: string): string {
  const key = toolKey || ctx.getStore()?.bizinfo || process.env.BIZINFO_API_KEY;
  if (!key) {
    throw new Error(
      "[기업마당] API 키가 없습니다. https://www.bizinfo.go.kr/apiList.do (활용정보 › 정책정보 개방)에서 발급받아 Vercel 환경변수 BIZINFO_API_KEY 에 넣거나, 커넥터 URL 에 &bizinfo_key=발급키 를 붙이세요."
    );
  }
  return key;
}

export function extraKeyStatus(): { ecos: string; bizinfo: string } {
  const s = ctx.getStore();
  const where = (url?: string, env?: string) => (url ? "URL" : env ? "환경변수" : "없음");
  return {
    ecos: where(s?.ecos, process.env.ECOS_API_KEY),
    bizinfo: where(s?.bizinfo, process.env.BIZINFO_API_KEY),
  };
}

/** Remove a secret from any text that may reach the user or logs. */
export function redact(text: string, secret?: string): string {
  if (!secret) return text;
  return text.split(secret).join("***").split(encodeURIComponent(secret)).join("***");
}

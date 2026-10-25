import { createMcpHandler } from "mcp-handler";
import { registerAllTools } from "@/lib/tools";
import { runWithRequestApiKey } from "@/lib/opendart/client";
import { runWithExtraKeys } from "@/lib/extra-keys";

const mcpHandler = createMcpHandler(
  (server) => {
    registerAllTools(server);
  },
  {
    capabilities: {},
  },
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: true,
  }
);

async function handler(req: Request) {
  const url = new URL(req.url);
  const apiKey = url.searchParams.get("opendart_key");
  const extra = { ecos: url.searchParams.get("ecos_key") ?? undefined, bizinfo: url.searchParams.get("bizinfo_key") ?? undefined };
  return runWithRequestApiKey(apiKey, () => runWithExtraKeys(extra, () => mcpHandler(req)));
}

// Without an explicit HEAD export, Next.js routes HEAD to the GET handler and
// mcp-handler never finishes the response, so the function hangs until its
// timeout. Answer HEAD immediately with the same 405 that GET returns.
function head() {
  return new Response(null, { status: 405, headers: { Allow: "POST, DELETE" } });
}

export { handler as GET, handler as POST, handler as DELETE, head as HEAD };

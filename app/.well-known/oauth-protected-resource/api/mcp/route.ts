import { buildBookmarkProtectedResourceMetadata, validateMcpRequestHost } from "@/lib/mcp-auth/metadata";

export const runtime = "nodejs";

function metadataHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
    "Content-Type": "application/json",
  };
}

function forbidden() {
  return Response.json({ error: "Forbidden" }, { status: 403, headers: metadataHeaders() });
}

export async function GET(request: Request) {
  if (!validateMcpRequestHost(request)) return forbidden();
  return Response.json(buildBookmarkProtectedResourceMetadata(), { headers: metadataHeaders() });
}

export async function HEAD(request: Request) {
  if (!validateMcpRequestHost(request)) return forbidden();
  return new Response(null, { status: 200, headers: metadataHeaders() });
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://kbgdxhshxkhuelbxlggc.supabase.co; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self' https://kbgdxhshxkhuelbxlggc.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; img-src 'self' data: blob: https://kbgdxhshxkhuelbxlggc.supabase.co; media-src 'self' blob: https://kbgdxhshxkhuelbxlggc.supabase.co; style-src 'self'; font-src 'self' data:; manifest-src 'self'; worker-src 'self' blob:;"
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleCustomerStageProof(request, env) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();
  const stageOrder = Number(url.searchParams.get("stage_order"));
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";
  if (!token || !Number.isInteger(stageOrder) || stageOrder < 1) {
    return new Response(JSON.stringify({ error: "Invalid proof request." }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "Proof service is not configured." }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return new Response(JSON.stringify({ error: "Proof service is not configured." }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
  const rpcResponse = await fetch(`${base}/rest/v1/rpc/get_customer_stage_proof_v2`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({ p_public_token: token, p_stage_order: stageOrder })
  });
  const proof = await rpcResponse.json().catch(() => null);
  if (!rpcResponse.ok || !proof?.available || !proof?.path) {
    return new Response(JSON.stringify({ error: "No proof photo is available for this stage." }), { status: rpcResponse.ok ? 404 : 502, headers: { "Content-Type": "application/json" } });
  }

  const encodedPath = proof.path.split("/").map(part => encodeURIComponent(part)).join("/");
  const signResponse = await fetch(`${base}/storage/v1/object/sign/production-proofs/${encodedPath}`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ expiresIn: 300 })
  });
  const signed = await signResponse.json().catch(() => null);
  if (!signResponse.ok || !signed?.signedURL) {
    return new Response(JSON.stringify({ error: "Unable to create a proof photo URL." }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  const signedUrl = signed.signedURL.startsWith("http") ? signed.signedURL : `${base}${signed.signedURL}`;
  return new Response(JSON.stringify({ available: true, url: signedUrl, stage_name: proof.stage_name || `Stage ${stageOrder}` }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "");
    const match = pathname.match(/^\/t\/([^/]+)$/i);

    if (match) {
      const token = decodeURIComponent(match[1]);
      const customerUrl = new URL("/customer/", url);
      customerUrl.hash = `token=${encodeURIComponent(token)}`;
      return Response.redirect(customerUrl.toString(), 302);
    }

    if (pathname === "/api/customer-stage-proof") {
      if (request.method !== "GET") {
        return withSecurityHeaders(new Response(JSON.stringify({ error: "Method not allowed." }), {
          status: 405,
          headers: { "Content-Type": "application/json", "Allow": "GET" }
        }));
      }
      try { return withSecurityHeaders(await handleCustomerStageProof(request, env)); }
      catch (error) {
        console.error("Customer proof endpoint failed:", error);
        return withSecurityHeaders(new Response(JSON.stringify({ error: "Unable to load proof photo." }), { status: 500, headers: { "Content-Type": "application/json" } }));
      }
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    const requestPathname = new URL(request.url).pathname;
    if (requestPathname === "/" || requestPathname === "/index.html" || requestPathname === "/sw.js" || requestPathname === "/js/register-sw.js") {
      headers.set("Cache-Control", "no-store");
    }
    return withSecurityHeaders(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
  }
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://kbgdxhshxkhuelbxlggc.supabase.co; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self' https://kbgdxhshxkhuelbxlggc.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; img-src 'self' data: blob: https://kbgdxhshxkhuelbxlggc.supabase.co; media-src 'self' blob: https://kbgdxhshxkhuelbxlggc.supabase.co; style-src 'self'; font-src 'self' data:; manifest-src 'self'; worker-src 'self' blob:"
};

const MAX_PAYMENT_PROOF_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 9 * 1024 * 1024;
const ALLOWED_PAYMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  return withSecurityHeaders(new Response(JSON.stringify(data), { status, headers }));
}

function getServiceKey(env) {
  return env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";
}

function getSupabaseBase(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/, "");
}

async function supabaseRpc(base, serviceKey, functionName, body) {
  return fetch(`${base}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(body)
  });
}

function hasJpegSignature(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasPngSignature(bytes) {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function hasWebpSignature(bytes) {
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function validImageSignature(contentType, bytes) {
  if (contentType === "image/jpeg") return hasJpegSignature(bytes);
  if (contentType === "image/png") return hasPngSignature(bytes);
  if (contentType === "image/webp") return hasWebpSignature(bytes);
  return false;
}

async function handleCustomerPaymentProof(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_MULTIPART_BYTES) return json({ error: "Payment proof request is too large." }, 413);

  const serviceKey = getServiceKey(env);
  const base = getSupabaseBase(env);
  if (!serviceKey || !base) return json({ error: "Payment proof service is not configured." }, 503);

  const form = await request.formData();
  const token = String(form.get("token") || "").trim();
  const amount = Number(form.get("amount"));
  const file = form.get("file");

  if (token.length < 16 || token.length > 256) return json({ error: "Invalid tracking link." }, 400);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return json({ error: "Invalid payment amount." }, 400);
  if (!(file instanceof File)) return json({ error: "Payment proof image is required." }, 400);
  if (!ALLOWED_PAYMENT_TYPES.has(file.type)) return json({ error: "Please choose a JPG, PNG, or WebP image." }, 400);
  if (file.size <= 0 || file.size > MAX_PAYMENT_PROOF_BYTES) return json({ error: "Please choose an image smaller than 8 MB." }, 400);

  const contextResponse = await supabaseRpc(base, serviceKey, "get_customer_payment_proof", { p_public_token: token });
  const context = await contextResponse.json().catch(() => null);
  if (!contextResponse.ok || !context?.eligible) {
    return json({ error: context?.rejection_reason || "Payment proof is not available for this order." }, contextResponse.ok ? 409 : 502);
  }
  const remaining = Number(context.remaining);
  if (!Number.isFinite(remaining) || amount > remaining + 0.000001) return json({ error: "Payment amount exceeds the remaining balance." }, 400);
  if (context.pending_verification) return json({ error: "A payment proof is already pending verification." }, 409);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validImageSignature(file.type, bytes)) return json({ error: "The selected file is not a supported image." }, 400);

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `incoming/${token}/${crypto.randomUUID()}.${ext}`;
  const uploadResponse = await fetch(`${base}/storage/v1/object/payment-proofs/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": file.type,
      "x-upsert": "false"
    },
    body: bytes
  });
  if (!uploadResponse.ok) {
    console.error("Customer payment proof upload failed upstream:", uploadResponse.status);
    return json({ error: "Unable to store the payment proof." }, 502);
  }

  const submitResponse = await supabaseRpc(base, serviceKey, "submit_customer_payment_proof", {
    p_public_token: token,
    p_amount: amount,
    p_proof_path: path
  });
  const submitResult = await submitResponse.json().catch(() => null);
  if (!submitResponse.ok) {
    try {
      await fetch(`${base}/storage/v1/object/payment-proofs/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "DELETE",
        headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
      });
    } catch (_) {}
    return json({ error: "Unable to submit the payment proof." }, 409);
  }

  return json({ success: true, payment: submitResult });
}

async function handleCustomerStageProof(request, env) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();
  const stageOrder = Number(url.searchParams.get("stage_order"));
  const serviceKey = getServiceKey(env);
  if (!token || !Number.isInteger(stageOrder) || stageOrder < 1) return json({ error: "Invalid proof request." }, 400);
  if (!serviceKey) return json({ error: "Proof service is not configured." }, 503);

  const base = getSupabaseBase(env);
  if (!base) return json({ error: "Proof service is not configured." }, 503);
  const rpcResponse = await supabaseRpc(base, serviceKey, "get_customer_stage_proof_v2", { p_public_token: token, p_stage_order: stageOrder });
  const proof = await rpcResponse.json().catch(() => null);
  if (!rpcResponse.ok || !proof?.available || !proof?.path) return json({ error: "No proof photo is available for this stage." }, rpcResponse.ok ? 404 : 502);

  const encodedPath = proof.path.split("/").map(part => encodeURIComponent(part)).join("/");
  const signResponse = await fetch(`${base}/storage/v1/object/sign/production-proofs/${encodedPath}`, {
    method: "POST",
    headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 })
  });
  const signed = await signResponse.json().catch(() => null);
  if (!signResponse.ok || !signed?.signedURL) return json({ error: "Unable to create a proof photo URL." }, 502);

  const signedUrl = signed.signedURL.startsWith("http") ? signed.signedURL : `${base}${signed.signedURL}`;
  return json({ available: true, url: signedUrl, stage_name: proof.stage_name || `Stage ${stageOrder}` }, 200, { "Cache-Control": "private, no-store" });
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
      try { return await handleCustomerStageProof(request, env); }
      catch (error) {
        console.error("Customer proof endpoint failed:", error);
        return json({ error: "Unable to load proof photo." }, 500);
      }
    }

    if (pathname === "/api/customer-payment-proof") {
      try { return await handleCustomerPaymentProof(request, env); }
      catch (error) {
        console.error("Customer payment proof endpoint failed:", error);
        return json({ error: "Unable to submit payment proof." }, 500);
      }
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    const requestPathname = new URL(request.url).pathname;
    if (requestPathname === "/" || requestPathname === "/index.html" || requestPathname === "/sw.js" || requestPathname === "/js/register-sw.js") headers.set("Cache-Control", "no-store");
    return withSecurityHeaders(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
  }
};

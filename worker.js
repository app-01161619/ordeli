const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(self), payment=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://kbgdxhshxkhuelbxlggc.supabase.co; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self' https://kbgdxhshxkhuelbxlggc.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; img-src 'self' data: blob: https://kbgdxhshxkhuelbxlggc.supabase.co https://*.tile.openstreetmap.org; media-src 'self' blob: https://kbgdxhshxkhuelbxlggc.supabase.co; style-src 'self' https://unpkg.com; font-src 'self' data:; manifest-src 'self'; worker-src 'self' blob:"
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

async function upstreamError(response, fallback) {
  const body = await response.json().catch(() => null);
  const message = body?.message || body?.error || body?.msg;
  return message ? `${fallback}: ${message}` : fallback;
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
  let paymentContext = context;
  if (!contextResponse.ok || !context?.eligible) {
    const trackingResponse = await supabaseRpc(base, serviceKey, "get_customer_tracking", { p_public_token: token });
    const tracking = await trackingResponse.json().catch(() => null);
    const remaining = Number(tracking?.payment?.remaining);
    if (trackingResponse.ok && Number.isFinite(remaining) && remaining > 0) {
      paymentContext = { ...context, eligible: true, remaining, pending_verification: false };
    }
  }
  if (!paymentContext?.eligible) {
    return json({ error: context?.rejection_reason || "Payment proof is not available for this order." }, contextResponse.ok ? 409 : 502);
  }
  const remaining = Number(paymentContext.remaining);
  if (!Number.isFinite(remaining) || amount > remaining + 0.000001) return json({ error: "Payment amount exceeds the remaining balance." }, 400);
  if (paymentContext.pending_verification) return json({ error: "A payment proof is already pending verification." }, 409);

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
    return json({ error: await upstreamError(uploadResponse, "Unable to store the payment proof.") }, 502);
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
    const message = submitResult?.message || submitResult?.error || submitResult?.msg;
    return json({ error: message ? `Unable to submit the payment proof: ${message}` : "Unable to submit the payment proof." }, 409);
  }

  return json({ success: true, payment: submitResult });
}


async function handleCustomerMedia(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();
  const type = (url.searchParams.get("type") || "").trim();
  const serviceKey = getServiceKey(env);
  const base = getSupabaseBase(env);
  if (token.length < 16 || token.length > 256 || !["shop-logo", "product-image"].includes(type)) return json({ error: "Invalid media request." }, 400);
  if (!serviceKey || !base) return json({ error: "Media service is not configured." }, 503);
  const rpcResponse = await supabaseRpc(base, serviceKey, "get_customer_tracking", { p_public_token: token });
  const tracking = await rpcResponse.json().catch(() => null);
  if (!rpcResponse.ok) return json({ error: tracking?.message || "Tracking link unavailable." }, 404);
  const path = type === "shop-logo" ? tracking?.shop?.logo_path : tracking?.item?.product_image_path;
  const bucket = type === "shop-logo" ? "shop-logos" : "product-images";
  if (!path || typeof path !== "string") return json({ error: "Media not available." }, 404);
  const encodedPath = path.split("/").map(part => encodeURIComponent(part)).join("/");
  const signResponse = await fetch(`${base}/storage/v1/object/sign/${bucket}/${encodedPath}`, {
    method: "POST",
    headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 })
  });
  const signed = await signResponse.json().catch(() => null);
  const signedPath = signed?.signedURL || signed?.signedUrl || signed?.signed_url;
  if (!signResponse.ok || !signedPath) return json({ error: "Unable to create media URL." }, 502);
  const signedUrl = signedPath.startsWith("http") ? signedPath : `${base}${signedPath.startsWith("/storage/v1/") ? "" : "/storage/v1"}${signedPath}`;
  return json({ url: signedUrl }, 200, { "Cache-Control": "private, max-age=300" });
}

async function handleCustomerStageProof(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
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
  const signedPath = signed?.signedURL || signed?.signedUrl || signed?.signed_url;
  if (!signResponse.ok || !signedPath) {
    return json({ error: await upstreamError(signResponse, "Unable to create a proof photo URL.") }, 502);
  }

  const signedUrl = signedPath.startsWith("http")
    ? signedPath
    : `${base}${signedPath.startsWith("/storage/v1/") ? "" : "/storage/v1"}${signedPath}`;
  return json({ available: true, url: signedUrl, stage_name: proof.stage_name || `Stage ${stageOrder}` }, 200, { "Cache-Control": "private, no-store" });
}

// ==========================================================================
// Web Push (RFC 8291 message encryption + RFC 8292 VAPID), implemented with
// only the standard Web Crypto API so it runs in the Worker with no external
// push library. Reference: web.dev/push-notifications and RFC 8291/8292.
// ==========================================================================

function b64urlToBytes(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function hkdf(salt, ikm, info, length) {
  const prk = await hmacSha256(salt, ikm);
  const infoWithCounter = concatBytes(info, new Uint8Array([1]));
  const okm = await hmacSha256(prk, infoWithCounter);
  return okm.slice(0, length);
}

async function signVapidJwt(audience, vapidPublicKeyB64, vapidPrivateKeyB64) {
  const publicBytes = b64urlToBytes(vapidPublicKeyB64);
  const x = publicBytes.slice(1, 33);
  const y = publicBytes.slice(33, 65);
  const jwk = {
    kty: "EC", crv: "P-256", ext: true,
    x: bytesToB64url(x), y: bytesToB64url(y), d: vapidPrivateKeyB64
  };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const header = { typ: "JWT", alg: "ES256" };
  const claims = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:support@ordeli.app" };
  const encoder = new TextEncoder();
  const unsigned = `${bytesToB64url(encoder.encode(JSON.stringify(header)))}.${bytesToB64url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, encoder.encode(unsigned)));
  return `${unsigned}.${bytesToB64url(signature)}`;
}

async function encryptPushPayload(payloadBytes, p256dhB64, authB64) {
  const uaPublicRaw = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);

  const uaPublicKey = await crypto.subtle.importKey("raw", uaPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, asKeyPair.privateKey, 256));

  const encoder = new TextEncoder();
  const keyInfo = concatBytes(encoder.encode("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekInfo = encoder.encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = encoder.encode("Content-Encoding: nonce\0");
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  const record = concatBytes(payloadBytes, new Uint8Array([2])); // delimiter octet, no padding
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, record));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

async function sendWebPush(subscription, payloadObj, env) {
  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) throw new Error("VAPID keys are not configured.");

  const endpointUrl = new URL(subscription.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const jwt = await signVapidJwt(audience, vapidPublic, vapidPrivate);
  const body = await encryptPushPayload(new TextEncoder().encode(JSON.stringify(payloadObj)), subscription.p256dh, subscription.auth_key);

  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt}, k=${vapidPublic}`,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
      "Urgency": "normal"
    },
    body
  });
}

async function handleSendPush(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const providedSecret = request.headers.get("x-ordeli-push-secret") || "";
  const expectedSecret = env.PUSH_TRIGGER_SECRET || "";
  if (!expectedSecret || providedSecret !== expectedSecret) return json({ error: "Unauthorized." }, 401);

  const body = await request.json().catch(() => null);
  const sellerId = String(body?.seller_id || "");
  const title = String(body?.title || "Ordeli").slice(0, 120);
  const message = String(body?.body || "").slice(0, 500);
  const url = String(body?.url || "/");
  if (!sellerId || !message) return json({ error: "seller_id and body are required." }, 400);

  const base = getSupabaseBase(env);
  const serviceKey = getServiceKey(env);
  const subsResponse = await fetch(`${base}/rest/v1/push_subscriptions?seller_id=eq.${encodeURIComponent(sellerId)}&select=id,endpoint,p256dh,auth_key`, {
    headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
  });
  if (!subsResponse.ok) return json({ error: await upstreamError(subsResponse, "Unable to load push subscriptions.") }, 502);
  const subscriptions = await subsResponse.json().catch(() => []);

  const staleIds = [];
  let sent = 0;
  for (const sub of subscriptions) {
    try {
      const pushResponse = await sendWebPush(sub, { title, body: message, url }, env);
      if (pushResponse.status === 404 || pushResponse.status === 410) {
        staleIds.push(sub.id);
      } else if (pushResponse.ok) {
        sent++;
      } else {
        console.error("Push send failed:", pushResponse.status, await pushResponse.text().catch(() => ""));
      }
    } catch (error) {
      console.error("Push send error:", error);
    }
  }

  if (staleIds.length) {
    const filter = staleIds.map(id => `"${id}"`).join(",");
    await fetch(`${base}/rest/v1/push_subscriptions?id=in.(${filter})`, {
      method: "DELETE",
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
    }).catch(() => {});
  }

  return json({ sent, stale_removed: staleIds.length, total: subscriptions.length });
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

    if (pathname === "/api/send-push") {
      try { return await handleSendPush(request, env); }
      catch (error) { console.error("Send push endpoint failed:", error); return json({ error: "Unable to send notification." }, 500); }
    }

    if (pathname === "/api/customer-media") {
      try { return await handleCustomerMedia(request, env); }
      catch (error) { console.error("Customer media endpoint failed:", error); return json({ error: "Unable to load media." }, 500); }
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

#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import bcrypt from "bcrypt";
import { config as loadEnv } from "dotenv";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
} from "jose";
import pg from "pg";

const { Pool } = pg;

loadEnv({ path: [".env.local", ".env"], quiet: true });

const BOOKMARK_SCOPES = new Set(["bookmarks:read", "bookmarks:write"]);
const DUMMY_PASSWORD_HASH = "$2b$12$DSsxoxr4vIf..yx2KHIcSumIXapEKAT.n/oone7g01BsiLg2AOL.u";
const MAX_BODY_BYTES = 64 * 1024;
const AUTHORIZATION_CODE_TTL_MS = 2 * 60_000;
const AUTHORIZATION_TRANSACTION_TTL_MS = 10 * 60_000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000;
const CLIENT_METADATA_TTL_MS = 5 * 60_000;
const CLIENT_METADATA_TIMEOUT_MS = 5_000;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function absoluteUrl(name, value, { loopbackHttp = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopbackHttp && loopback && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS${loopbackHttp ? " or loopback HTTP" : ""}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment`);
  }
  return url;
}

function parseBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function isValidRedirectUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  if (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    return true;
  }
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
    !["data:", "file:", "http:", "javascript:"].includes(url.protocol);
}

function redirectUriAllowed(registeredUris, candidate) {
  if (registeredUris.includes(candidate)) return true;
  let candidateUrl;
  try {
    candidateUrl = new URL(candidate);
  } catch {
    return false;
  }
  if (candidateUrl.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(candidateUrl.hostname)) {
    return false;
  }
  return registeredUris.some((registered) => {
    const registeredUrl = new URL(registered);
    return registeredUrl.protocol === candidateUrl.protocol &&
      registeredUrl.hostname === candidateUrl.hostname &&
      registeredUrl.pathname === candidateUrl.pathname &&
      registeredUrl.search === candidateUrl.search;
  });
}

function normalizeClient(value, source = "configuration") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid client in ${source}`);
  }
  const clientId = typeof value.client_id === "string" ? value.client_id : "";
  const clientName = typeof value.client_name === "string" ? value.client_name : clientId;
  const redirectUris = value.redirect_uris;
  if (
    !clientId ||
    clientId.length > 2048 ||
    !clientName ||
    clientName.length > 200 ||
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > 20 ||
    redirectUris.some((uri) => typeof uri !== "string" || !isValidRedirectUri(uri)) ||
    new Set(redirectUris).size !== redirectUris.length
  ) {
    throw new Error(`Invalid client in ${source}`);
  }
  if (
    value.token_endpoint_auth_method !== undefined &&
    value.token_endpoint_auth_method !== "none"
  ) {
    throw new Error(`Only public clients are supported in ${source}`);
  }
  return Object.freeze({ clientId, clientName, redirectUris: Object.freeze([...redirectUris]) });
}

function configuredClients() {
  let values;
  try {
    values = JSON.parse(process.env.LOCAL_AUTH_CLIENTS_JSON ?? "[]");
  } catch {
    throw new Error("LOCAL_AUTH_CLIENTS_JSON must be valid JSON");
  }
  if (!Array.isArray(values) || values.length > 100) {
    throw new Error("LOCAL_AUTH_CLIENTS_JSON must be an array with at most 100 clients");
  }
  const clients = new Map();
  for (const value of values) {
    const client = normalizeClient(value, "LOCAL_AUTH_CLIENTS_JSON");
    if (clients.has(client.clientId)) throw new Error("LOCAL_AUTH_CLIENTS_JSON has duplicate client_id values");
    clients.set(client.clientId, client);
  }
  return clients;
}

const issuerValue = (process.env.LOCAL_AUTH_ISSUER ?? process.env.MCP_AUTH_ISSUER ?? "http://localhost:4000").trim();
const issuer = absoluteUrl(
  "LOCAL_AUTH_ISSUER",
  issuerValue,
  { loopbackHttp: true },
);
if (issuer.pathname !== "/") throw new Error("LOCAL_AUTH_ISSUER must be an origin without a path");
if (issuer.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(issuer.hostname)) {
  throw new Error("LOCAL_AUTH_ISSUER must be a loopback HTTP origin");
}

const appOrigin = absoluteUrl("APP_URL", requiredEnv("APP_URL"), { loopbackHttp: true });
if (appOrigin.pathname !== "/") throw new Error("APP_URL must be an origin without a path");

const resource = new URL("/api/mcp", appOrigin).href;
const host = process.env.LOCAL_AUTH_HOST?.trim() || "127.0.0.1";
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error("LOCAL_AUTH_HOST must bind only to a loopback interface");
}
const issuerPort = Number(issuer.port || 80);
const port = parseInteger("LOCAL_AUTH_PORT", issuerPort, 1, 65535);
if (port !== issuerPort) throw new Error("LOCAL_AUTH_PORT must match the port in LOCAL_AUTH_ISSUER");
const allowDcr = parseBoolean("LOCAL_AUTH_ALLOW_DCR", false);
const accessTokenTtlSeconds = parseInteger("LOCAL_AUTH_ACCESS_TOKEN_TTL_SECONDS", 600, 60, 3600);
const clients = configuredClients();
const clientMetadataCache = new Map();
const authorizationTransactions = new Map();
const authorizationCodes = new Map();
const refreshTokens = new Map();
const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL"), max: 5 });

const keyId = randomBytes(16).toString("base64url");
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = await exportJWK(publicKey);
Object.assign(publicJwk, { alg: "RS256", kid: keyId, use: "sig" });

function endpoint(pathname) {
  return new URL(pathname, issuer).href;
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function sha256Base64url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function baseHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store",
    // Some desktop OAuth webviews add their own `form-action 'self'` policy and
    // combine it with response CSP. Do not add a second form policy here. The
    // only form target is the validated, hard-coded loopback issuer below.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, baseHeaders({ "Content-Type": "application/json", ...headers }));
  response.end(JSON.stringify(body));
}

function sendHtml(response, status, title, content) {
  response.writeHead(status, baseHeaders({ "Content-Type": "text/html; charset=utf-8" }));
  response.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(title)}</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#171717}main{border:1px solid #ddd;border-radius:12px;padding:1.5rem}label{display:block;margin:.9rem 0 .3rem}input{box-sizing:border-box;width:100%;padding:.7rem;border:1px solid #aaa;border-radius:6px}button{margin-top:1rem;padding:.7rem 1rem;border:0;border-radius:6px;background:#171717;color:white;cursor:pointer}.secondary{background:#eee;color:#171717;margin-left:.5rem}.error{color:#b42318}code{font-size:.9em;word-break:break-all}ul{padding-left:1.25rem}</style></head>
<body><main>${content}</main></body></html>`);
}

async function readForm(request) {
  const contentType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") throw new OAuthRequestError(400, "invalid_request", "Expected form encoding");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new OAuthRequestError(413, "invalid_request", "Request body too large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

class OAuthRequestError extends Error {
  constructor(status, code, description) {
    super(description);
    this.status = status;
    this.code = code;
  }
}

function one(params, name, { required = true } = {}) {
  const values = params.getAll(name);
  if (values.length > 1 || (required && (values.length !== 1 || values[0] === ""))) {
    throw new OAuthRequestError(400, "invalid_request", `Invalid ${name}`);
  }
  return values[0] ?? null;
}

function requestedScopes(value) {
  if (!value || value.trim() !== value || value.includes("  ")) {
    throw new OAuthRequestError(400, "invalid_scope", "Request one or more bookmark scopes");
  }
  const scopes = [...new Set(value.split(" "))];
  if (scopes.some((scope) => !BOOKMARK_SCOPES.has(scope))) {
    throw new OAuthRequestError(400, "invalid_scope", "Only bookmark scopes are supported");
  }
  return scopes;
}

async function readBoundedClientMetadata(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_METADATA_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("metadata request failed");
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new Error("metadata must be JSON");
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("metadata too large");
    if (!response.body) throw new Error("metadata response has no body");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("metadata too large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveClient(clientId) {
  const local = clients.get(clientId);
  if (local) return local;
  const cached = clientMetadataCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  let metadataUrl;
  try {
    metadataUrl = absoluteUrl("client_id", clientId, { loopbackHttp: true });
  } catch {
    return null;
  }
  try {
    const metadata = await readBoundedClientMetadata(metadataUrl);
    if (metadata.client_id !== clientId) return null;
    const client = normalizeClient(metadata, "Client ID Metadata Document");
    clientMetadataCache.set(clientId, { client, expiresAt: Date.now() + CLIENT_METADATA_TTL_MS });
    return client;
  } catch {
    return null;
  }
}

function appendAuthorizationResult(redirectUri, values) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.href;
}

function redirect(response, location) {
  response.writeHead(302, baseHeaders({ Location: location }));
  response.end();
}

async function findUserByEmail(email) {
  const result = await pool.query(
    'SELECT "id", "email", "password_hash", "session_version" FROM "users" WHERE "email" = $1 LIMIT 1',
    [email.trim().toLowerCase()],
  );
  return result.rows[0] ?? null;
}

async function findUserById(id) {
  const result = await pool.query(
    'SELECT "id", "session_version" FROM "users" WHERE "id" = $1 LIMIT 1',
    [id],
  );
  return result.rows[0] ?? null;
}

async function issueAccessToken({ userId, sessionVersion, clientId, scopes }) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: scopes.join(" "),
    client_id: clientId,
    stash_session_version: sessionVersion,
  })
    .setProtectedHeader({ alg: "RS256", kid: keyId, typ: "at+jwt" })
    .setIssuer(issuerValue)
    .setAudience(resource)
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + accessTokenTtlSeconds)
    .setJti(randomToken(16))
    .sign(privateKey);
}

async function tokenResult(grant, includeRefreshToken) {
  const user = await findUserById(grant.userId);
  if (!user || user.session_version !== grant.sessionVersion) {
    throw new OAuthRequestError(400, "invalid_grant", "User authorization is no longer valid");
  }
  const result = {
    access_token: await issueAccessToken({
      userId: user.id,
      sessionVersion: user.session_version,
      clientId: grant.clientId,
      scopes: grant.scopes,
    }),
    token_type: "Bearer",
    expires_in: accessTokenTtlSeconds,
    scope: grant.scopes.join(" "),
  };
  if (includeRefreshToken) {
    const refreshToken = randomToken();
    refreshTokens.set(refreshToken, {
      ...grant,
      sessionVersion: user.session_version,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
    });
    result.refresh_token = refreshToken;
  }
  return result;
}

function validateTokenResource(params) {
  const requestedResource = one(params, "resource");
  if (requestedResource !== resource) {
    throw new OAuthRequestError(400, "invalid_target", "The exact Stash MCP resource is required");
  }
}

async function handleAuthorization(requestUrl, response) {
  const params = requestUrl.searchParams;
  if (one(params, "response_type") !== "code") throw new OAuthRequestError(400, "unsupported_response_type", "Only code is supported");
  const clientId = one(params, "client_id");
  const client = await resolveClient(clientId);
  if (!client) throw new OAuthRequestError(400, "invalid_request", "Unknown client_id");
  const redirectUri = one(params, "redirect_uri");
  if (!redirectUriAllowed(client.redirectUris, redirectUri)) {
    throw new OAuthRequestError(400, "invalid_request", "redirect_uri is not registered");
  }

  try {
    const state = one(params, "state");
    const codeChallenge = one(params, "code_challenge");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)) throw new OAuthRequestError(400, "invalid_request", "Invalid code_challenge");
    if (one(params, "code_challenge_method") !== "S256") throw new OAuthRequestError(400, "invalid_request", "PKCE S256 is required");
    const requestedResource = one(params, "resource");
    if (requestedResource !== resource) throw new OAuthRequestError(400, "invalid_target", "The exact Stash MCP resource is required");
    const scopes = requestedScopes(one(params, "scope"));
    const transactionId = randomToken();
    authorizationTransactions.set(transactionId, {
      clientId,
      clientName: client.clientName,
      redirectUri,
      state,
      codeChallenge,
      scopes,
      attempts: 0,
      expiresAt: Date.now() + AUTHORIZATION_TRANSACTION_TTL_MS,
    });
    sendHtml(response, 200, "Authorize Stash", `<h1>Authorize Stash</h1>
<p><strong>${htmlEscape(client.clientName)}</strong> is requesting access to <code>${htmlEscape(resource)}</code>.</p>
<ul>${scopes.map((scope) => `<li>${htmlEscape(scope)}</li>`).join("")}</ul>
<form method="post" action="${htmlEscape(endpoint("/authorize"))}"><input type="hidden" name="transaction" value="${transactionId}">
<label for="email">Stash email</label><input id="email" name="email" type="email" maxlength="320" autocomplete="username" required>
<label for="password">Stash password</label><input id="password" name="password" type="password" maxlength="72" autocomplete="current-password" required>
<button name="decision" value="allow" type="submit">Sign in and authorize</button><button class="secondary" name="decision" value="deny" type="submit">Deny</button></form>`);
  } catch (error) {
    if (!(error instanceof OAuthRequestError)) throw error;
    redirect(response, appendAuthorizationResult(redirectUri, {
      error: error.code,
      error_description: error.message,
      state: params.get("state") ?? "",
      iss: issuerValue,
    }));
  }
}

async function handleAuthorizationDecision(request, response) {
  const params = await readForm(request);
  const transactionId = one(params, "transaction");
  const transaction = authorizationTransactions.get(transactionId);
  if (!transaction || transaction.expiresAt <= Date.now()) {
    authorizationTransactions.delete(transactionId);
    throw new OAuthRequestError(400, "invalid_request", "Authorization request expired");
  }
  const decision = one(params, "decision");
  if (decision === "deny") {
    authorizationTransactions.delete(transactionId);
    redirect(response, appendAuthorizationResult(transaction.redirectUri, {
      error: "access_denied",
      state: transaction.state,
      iss: issuerValue,
    }));
    return;
  }
  if (decision !== "allow") throw new OAuthRequestError(400, "invalid_request", "Invalid decision");

  transaction.attempts += 1;
  if (transaction.attempts > 5) {
    authorizationTransactions.delete(transactionId);
    throw new OAuthRequestError(429, "access_denied", "Too many sign-in attempts");
  }
  const email = one(params, "email");
  const password = one(params, "password");
  const user = email.length <= 320 ? await findUserByEmail(email) : null;
  const passwordHash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const passwordWithinLimit = Buffer.byteLength(password, "utf8") <= 72;
  const passwordValid = await bcrypt.compare(passwordWithinLimit ? password : "", passwordHash);
  if (!user || !passwordWithinLimit || !passwordValid) {
    sendHtml(response, 401, "Sign-in failed", `<h1>Sign-in failed</h1><p class="error">Invalid email or password.</p><p>Return to your AI client and try connecting again.</p>`);
    return;
  }

  authorizationTransactions.delete(transactionId);
  const code = randomToken();
  authorizationCodes.set(code, {
    clientId: transaction.clientId,
    redirectUri: transaction.redirectUri,
    codeChallenge: transaction.codeChallenge,
    scopes: transaction.scopes,
    userId: user.id,
    sessionVersion: user.session_version,
    expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS,
  });
  redirect(response, appendAuthorizationResult(transaction.redirectUri, {
    code,
    state: transaction.state,
    iss: issuerValue,
  }));
}

async function handleToken(request, response) {
  if (request.headers.authorization) throw new OAuthRequestError(401, "invalid_client", "This server supports public clients only");
  const params = await readForm(request);
  const grantType = one(params, "grant_type");
  const clientId = one(params, "client_id");
  validateTokenResource(params);

  if (grantType === "authorization_code") {
    const codeValue = one(params, "code");
    const grant = authorizationCodes.get(codeValue);
    authorizationCodes.delete(codeValue);
    if (!grant || grant.expiresAt <= Date.now()) throw new OAuthRequestError(400, "invalid_grant", "Invalid authorization code");
    if (grant.clientId !== clientId || grant.redirectUri !== one(params, "redirect_uri")) {
      throw new OAuthRequestError(400, "invalid_grant", "Authorization code binding failed");
    }
    const verifier = one(params, "code_verifier");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || sha256Base64url(verifier) !== grant.codeChallenge) {
      throw new OAuthRequestError(400, "invalid_grant", "PKCE verification failed");
    }
    sendJson(response, 200, await tokenResult(grant, true));
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = one(params, "refresh_token");
    const grant = refreshTokens.get(refreshToken);
    refreshTokens.delete(refreshToken);
    if (!grant || grant.expiresAt <= Date.now() || grant.clientId !== clientId) {
      throw new OAuthRequestError(400, "invalid_grant", "Invalid refresh token");
    }
    const scopeValue = one(params, "scope", { required: false });
    const scopes = scopeValue === null ? grant.scopes : requestedScopes(scopeValue);
    if (scopes.some((scope) => !grant.scopes.includes(scope))) {
      throw new OAuthRequestError(400, "invalid_scope", "Refresh cannot add scopes");
    }
    sendJson(response, 200, await tokenResult({ ...grant, scopes }, true));
    return;
  }

  throw new OAuthRequestError(400, "unsupported_grant_type", "Unsupported grant_type");
}

async function handleRegistration(request, response) {
  if (!allowDcr) throw new OAuthRequestError(404, "invalid_request", "Dynamic registration is disabled");
  const contentType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new OAuthRequestError(400, "invalid_client_metadata", "Expected JSON");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new OAuthRequestError(413, "invalid_client_metadata", "Request body too large");
    chunks.push(chunk);
  }
  let metadata;
  try {
    metadata = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OAuthRequestError(400, "invalid_client_metadata", "Invalid JSON");
  }
  const clientId = `local-${randomToken(18)}`;
  let client;
  try {
    client = normalizeClient({ ...metadata, client_id: clientId }, "registration request");
  } catch (error) {
    throw new OAuthRequestError(400, "invalid_client_metadata", error.message);
  }
  if (
    metadata.grant_types?.some((value) => !["authorization_code", "refresh_token"].includes(value)) ||
    metadata.response_types?.some((value) => value !== "code")
  ) {
    throw new OAuthRequestError(400, "invalid_client_metadata", "Only authorization code and refresh grants are supported");
  }
  clients.set(clientId, client);
  sendJson(response, 201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: client.clientName,
    redirect_uris: [...client.redirectUris],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

function discoveryDocument() {
  return {
    issuer: issuerValue,
    authorization_endpoint: endpoint("/authorize"),
    token_endpoint: endpoint("/token"),
    jwks_uri: endpoint("/jwks"),
    ...(allowDcr ? { registration_endpoint: endpoint("/register") } : {}),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...BOOKMARK_SCOPES],
    response_modes_supported: ["query"],
    authorization_response_iss_parameter_supported: true,
    access_token_signing_alg_values_supported: ["RS256"],
  };
}

async function route(request, response) {
  const requestHost = request.headers.host?.toLowerCase();
  if (requestHost !== issuer.host.toLowerCase()) {
    sendJson(response, 400, { error: "invalid_request", error_description: "Use the configured issuer host" });
    return;
  }
  const requestUrl = new URL(request.url, issuer);
  if (request.method === "GET" && ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"].includes(requestUrl.pathname)) {
    sendJson(response, 200, discoveryDocument());
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/jwks") {
    sendJson(response, 200, { keys: [publicJwk] }, { "Cache-Control": "public, max-age=300" });
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/authorize") {
    await handleAuthorization(requestUrl, response);
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/authorize") {
    await handleAuthorizationDecision(request, response);
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/token") {
    await handleToken(request, response);
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/register") {
    await handleRegistration(request, response);
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/") {
    sendHtml(response, 200, "Stash local authorization server", `<h1>Stash local authorization server</h1><p>Issuer: <code>${htmlEscape(issuerValue)}</code></p><p>Resource: <code>${htmlEscape(resource)}</code></p><p>Connect an MCP client to <code>${htmlEscape(resource)}</code>. This process is for loopback development only.</p>`);
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    if (error instanceof OAuthRequestError) {
      sendJson(response, error.status, { error: error.code, error_description: error.message });
      return;
    }
    console.error(JSON.stringify({ event: "local_auth.request_failed", category: error?.name || "unknown" }));
    sendJson(response, 500, { error: "server_error" });
  });
});

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const store of [authorizationTransactions, authorizationCodes, refreshTokens]) {
    for (const [key, value] of store) if (value.expiresAt <= now) store.delete(key);
  }
  for (const [key, value] of clientMetadataCache) if (value.expiresAt <= now) clientMetadataCache.delete(key);
}, 60_000);
cleanup.unref();

server.listen(port, host, () => {
  console.info(`Stash local authorization server listening at ${issuerValue}`);
  console.info(`MCP resource: ${resource}`);
  console.info(`Configured clients: ${clients.size}; DCR compatibility: ${allowDcr ? "enabled" : "disabled"}`);
});

async function shutdown() {
  clearInterval(cleanup);
  server.close();
  await pool.end();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

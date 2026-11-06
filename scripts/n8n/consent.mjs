/**
 * One-time OAuth2 (authorization code + PKCE) consent for the local n8n reader.
 * Uses a synthetic realm account, validates client/redirect/scopes before accepting, and
 * never prints tokens, codes or secrets. The n8n callback is intercepted, not consumed.
 */
import assert from "node:assert/strict";
import {createHash, randomBytes} from "node:crypto";
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";

const ORIGIN = "http://127.0.0.1:4286";
const ISSUER = ORIGIN + "/identity/realms/autonexus";
const CLIENT_ID = "autonexus-n8n-reader";
const REDIRECT = "http://127.0.0.1:5678/rest/oauth2-credential/callback";
const SCOPE = "openid n8n:api:read";
const ACCOUNT = process.env.N8N_ACCOUNT ?? "chief";
const OUT = resolve("output/mcp-read/fixture/n8n-credential.private.json");

const ensure = (ok, code) => { if (!ok) throw new Error(code); };
const accounts = JSON.parse(readFileSync("output/stack/cu16-proof.accounts.private.json", "utf8")).accounts;
const secret = JSON.parse(readFileSync("output/mcp-read/fixture/n8n-client.private.json", "utf8"));
const account = accounts[ACCOUNT];
ensure(account?.username && account?.password && account.enabled !== false, "SYNTHETIC_ACCOUNT_REQUIRED");
ensure(secret.clientId === CLIENT_ID && typeof secret.clientSecret === "string" && secret.clientSecret.length >= 16, "N8N_CLIENT_FIXTURE_INVALID");

const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(24).toString("base64url");
const authUrl = new URL(ISSUER + "/protocol/openid-connect/auth");
for (const [k, v] of Object.entries({client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code",
  response_mode: "fragment", scope: SCOPE, state, nonce: randomBytes(24).toString("base64url"),
  code_challenge: challenge, code_challenge_method: "S256"})) authUrl.searchParams.set(k, v);

const requirePlaywright = createRequire(resolve("web/mf-employees/package.json"));
const {chromium} = requirePlaywright(resolve("web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright"));
const browser = await chromium.launch({headless: true});
let captured;
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  // The code travels in the fragment: read the committed navigation URL, not the HTTP request.
  page.on("framenavigated", frame => {
    const url = new URL(frame.url());
    if (frame === page.mainFrame() && url.pathname === "/rest/oauth2-credential/callback") captured = frame.url();
  });
  await page.goto(authUrl.href, {waitUntil: "domcontentloaded"});
  ensure(new URL(page.url()).origin === ORIGIN, "KEYCLOAK_ORIGIN_MISMATCH");
  ensure(await page.locator("#kc-login").count() === 1, "LOGIN_FORM_NOT_READY");
  await page.locator("#username").fill(account.username);
  await page.locator("#password").fill(account.password);
  await page.locator("#kc-login").click();
  for (let i = 0; i < 40 && captured === undefined; i++) await page.waitForTimeout(250);
  ensure(typeof captured === "string", "CONSENT_REDIRECT_NOT_OBSERVED");
} finally {
  await browser.close();
}

const callback = new URL(captured);
ensure(callback.origin + callback.pathname === REDIRECT, "CALLBACK_REDIRECT_MISMATCH");
const params = new URLSearchParams(callback.hash.startsWith("#") ? callback.hash.slice(1) : callback.search.slice(1));
ensure(params.get("state") === state, "STATE_MISMATCH");
ensure(params.get("iss") === ISSUER, "ISSUER_MISMATCH");
ensure(!params.get("error"), "CONSENT_ERROR_" + String(params.get("error")));
const code = params.get("code");
ensure(typeof code === "string" && code.length > 10, "AUTHORIZATION_CODE_MISSING");

const tokenResponse = await fetch(ISSUER + "/protocol/openid-connect/token", {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
  headers: {"content-type": "application/x-www-form-urlencoded", accept: "application/json"},
  body: new URLSearchParams({grant_type: "authorization_code", client_id: CLIENT_ID,
    client_secret: secret.clientSecret, redirect_uri: REDIRECT, code, code_verifier: verifier}),
});
const tokens = await tokenResponse.json().catch(() => null);
ensure(tokenResponse.status === 200 && tokens?.access_token, "TOKEN_EXCHANGE_FAILED");
const claims = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url"));
ensure(claims.iss === ISSUER && claims.azp === CLIENT_ID, "TOKEN_IDENTITY_MISMATCH");
for (const audience of ["autonexus-operations-api", "autonexus-employees-api"]) ensure(claims.aud.includes(audience), "TOKEN_AUDIENCE_MISSING");
ensure((claims.realm_access?.roles ?? []).includes("mcp_read_team"), "READ_ROLE_MISSING");
ensure(String(claims.scope ?? "").split(" ").includes("n8n:api:read"), "GRANTED_SCOPE_MISMATCH");
ensure(!(claims.realm_access?.roles ?? []).includes("administrador"), "PRIVILEGED_ROLE_PRESENT");
ensure(typeof tokens.refresh_token === "string", "REFRESH_TOKEN_MISSING");

const credential = {
  id: "autonexusN8nReader",
  name: "AutoNexus n8n reader",
  type: "oAuth2Api",
  data: {
    grantType: "pkce",
    authUrl: ISSUER + "/protocol/openid-connect/auth",
    accessTokenUrl: ISSUER + "/protocol/openid-connect/token",
    clientId: CLIENT_ID,
    clientSecret: secret.clientSecret,
    scope: SCOPE,
    authQueryParameters: "",
    authentication: "body",
    sendAdditionalCredentialsToTokenUrl: true,
    oauthTokenData: tokens,
  },
};
mkdirSync(resolve("output/mcp-read/fixture"), {recursive: true, mode: 0o700});
writeFileSync(OUT, JSON.stringify(credential, null, 2), {flag: "w", mode: 0o600});
console.log(JSON.stringify({consent: "PASS", account: ACCOUNT, clientId: CLIENT_ID, redirect: REDIRECT,
  scope: SCOPE, pkce: "S256", roles: claims.realm_access.roles.filter(r => r.startsWith("mcp_read_")),
  audiences: claims.aud, hasRefresh: true, credentialFile: OUT}));

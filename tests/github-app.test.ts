import { describe, expect, test } from "bun:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { createDb } from "../src/db/index.ts";
import { createStore } from "../src/db/store.ts";
import { GitHubAppService } from "../src/github/app.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs1", format: "pem" }) as string;

function serviceWithApp(fetchFn?: typeof fetch): GitHubAppService {
  const store = createStore(createDb(":memory:"));
  store.saveGithubApp({
    appId: 4242,
    slug: "oc-tracker-test",
    name: "oc tracker test",
    clientId: "cid",
    clientSecret: "csecret",
    privateKey: PRIVATE_KEY_PEM,
    webhookSecret: "whsec",
    htmlUrl: "https://github.com/apps/oc-tracker-test",
  });
  return new GitHubAppService(store, fetchFn ?? fetch);
}

function b64urlDecode(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
}

describe("GitHubAppService", () => {
  test("appJwt produces a verifiable RS256 JWT with app id issuer", () => {
    const svc = serviceWithApp();
    const jwt = svc.appJwt();
    const [header, payload, signature] = jwt.split(".");
    expect(header && payload && signature).toBeTruthy();

    expect(JSON.parse(b64urlDecode(header!))).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(b64urlDecode(payload!)) as { iss: string; iat: number; exp: number };
    expect(claims.iss).toBe("4242");
    expect(claims.exp - claims.iat).toBe(10 * 60);

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    const sigBuf = Buffer.from(signature!.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(verifier.verify(publicKey, sigBuf)).toBe(true);
  });

  test("installationToken caches until near expiry", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          token: `tok-${calls}`,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const svc = serviceWithApp(fetchFn);
    expect(await svc.installationToken(9)).toBe("tok-1");
    expect(await svc.installationToken(9)).toBe("tok-1");
    expect(await svc.installationToken(10)).toBe("tok-2");
    expect(calls).toBe(2);
  });

  test("buildManifest wires webhook and redirect to the base URL", () => {
    const svc = serviceWithApp();
    const manifest = svc.buildManifest() as {
      name: string;
      hook_attributes: { url: string };
      redirect_url: string;
      default_events: string[];
      default_permissions: Record<string, string>;
    };
    expect(manifest.hook_attributes.url).toMatch(/\/webhooks\/github$/);
    expect(manifest.redirect_url).toMatch(/\/settings\/github-app\/callback$/);
    expect(manifest.default_events).toContain("push");
    expect(manifest.default_permissions).toEqual({ contents: "read", metadata: "read" });
    expect(manifest.name.length).toBeLessThanOrEqual(34);
  });

  test("manifestTargetUrl targets personal or organization scope", () => {
    const svc = serviceWithApp();
    expect(svc.manifestTargetUrl(undefined, "s1")).toBe(
      "https://github.com/settings/apps/new?state=s1",
    );
    expect(svc.manifestTargetUrl("acme", "s2")).toBe(
      "https://github.com/organizations/acme/settings/apps/new?state=s2",
    );
  });
});

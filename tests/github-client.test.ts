import { describe, expect, test } from "bun:test";
import { GitHubClient, NotFoundError } from "../src/github/client.ts";

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function rawCommit(sha: string, date: string, parents = 1) {
  return {
    sha,
    html_url: `https://github.com/acme/api/commit/${sha}`,
    commit: {
      message: `commit ${sha}`,
      author: { name: "Alice", email: "alice@example.com", date },
      committer: { name: "Alice", email: "alice@example.com", date },
    },
    author: { login: "alice", avatar_url: "https://avatars.githubusercontent.com/u/1" },
    parents: Array.from({ length: parents }, (_, i) => ({ sha: `p${i}` })),
  };
}

function clientWith(handler: (url: URL) => Response | Promise<Response>): GitHubClient {
  return new GitHubClient({
    apiUrl: "https://api.example.test",
    token: "t",
    fetchFn: (async (input: Parameters<typeof fetch>[0]) =>
      handler(new URL(String(input)))) as typeof fetch,
  });
}

describe("GitHubClient", () => {
  test("listCommits paginates until a short page", async () => {
    const pages: Record<string, unknown[]> = {
      "1": Array.from({ length: 100 }, (_, i) => rawCommit(`a${i}`, "2026-01-01T10:00:00Z")),
      "2": [rawCommit("last", "2026-01-01T09:00:00Z")],
    };
    const client = clientWith((url) => jsonResponse(pages[url.searchParams.get("page") ?? "1"] ?? []));
    const all = [];
    for await (const batch of client.listCommits("acme", "api")) {
      all.push(...batch);
    }
    expect(all).toHaveLength(101);
    expect(all[0]?.authorLogin).toBe("alice");
    expect(all[0]?.authorTs).toBe(Date.UTC(2026, 0, 1, 10) / 1000);
  });

  test("empty repository (409) yields nothing", async () => {
    const client = clientWith(() => new Response("Git Repository is empty.", { status: 409 }));
    const all = [];
    for await (const batch of client.listCommits("acme", "empty")) {
      all.push(...batch);
    }
    expect(all).toHaveLength(0);
  });

  test("merge commits are flagged", async () => {
    const client = clientWith(() => jsonResponse([rawCommit("m", "2026-01-01T00:00:00Z", 2)]));
    const batches = [];
    for await (const batch of client.listCommits("acme", "api")) {
      batches.push(...batch);
    }
    expect(batches[0]?.isMerge).toBe(true);
  });

  test("getAccount falls back from org to user", async () => {
    const client = clientWith((url) => {
      if (url.pathname.startsWith("/orgs/")) return jsonResponse({ message: "nope" }, 404);
      return jsonResponse({ login: "alice", name: "Alice", avatar_url: null, html_url: null });
    });
    const account = await client.getAccount("alice");
    expect(account.kind).toBe("user");
    expect(account.login).toBe("alice");
  });

  test("getRepo throws NotFoundError on 404", async () => {
    const client = clientWith(() => jsonResponse({ message: "Not Found" }, 404));
    expect(client.getRepo("acme", "ghost")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("waits out a small rate-limit window and retries", async () => {
    let calls = 0;
    const client = clientWith(() => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      return jsonResponse({ id: 1, name: "api", full_name: "acme/api", owner: { login: "acme" } });
    });
    const repo = await client.getRepo("acme", "api");
    expect(repo.fullName).toBe("acme/api");
    expect(calls).toBe(2);
  });
});

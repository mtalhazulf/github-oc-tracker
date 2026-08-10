import { describe, expect, test } from "bun:test";
import { compact, firstLine, shortSha, timeAgo } from "../src/web/format.ts";

describe("format", () => {
  test("compact numbers", () => {
    expect(compact(0)).toBe("0");
    expect(compact(1284)).toBe("1,284");
    expect(compact(12_900)).toBe("12.9K");
    expect(compact(4_200_000)).toBe("4.2M");
  });

  test("timeAgo buckets", () => {
    const now = 1_000_000;
    expect(timeAgo(now - 30, now)).toBe("just now");
    expect(timeAgo(now - 120, now)).toBe("2m ago");
    expect(timeAgo(now - 7200, now)).toBe("2h ago");
    expect(timeAgo(now - 3 * 86400, now)).toBe("3d ago");
  });

  test("firstLine truncates", () => {
    expect(firstLine("fix: bug\n\ndetails")).toBe("fix: bug");
    expect(firstLine("x".repeat(200))).toHaveLength(121);
  });

  test("shortSha", () => {
    expect(shortSha("0123456789abcdef")).toBe("0123456");
  });
});

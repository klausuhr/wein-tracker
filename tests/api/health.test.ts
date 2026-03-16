import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerAdminClientMock } = vi.hoisted(() => ({
  createServerAdminClientMock: vi.fn()
}));

vi.mock("@/lib/supabase/server-admin", () => ({
  createServerAdminClient: createServerAdminClientMock
}));

import { GET } from "@/app/api/health/route";

function createHealthSupabase(options: {
  dbCheck: { error: { message: string } | null };
  wineCount: { count: number | null; error: { message: string } | null };
  lastScraped: {
    data: Array<{ last_scraped_at: string | null }> | null;
    error: { message: string } | null;
  };
}) {
  return {
    from: vi.fn((table: string) => {
      if (table !== "wines") {
        throw new Error(`Unhandled table in test mock: ${table}`);
      }
      return {
        select: vi.fn((columns: string) => {
          if (columns === "id") {
            return {
              limit: vi.fn(async () => options.dbCheck)
            };
          }
          if (columns === "*") {
            return Promise.resolve(options.wineCount);
          }
          if (columns === "last_scraped_at") {
            return {
              order: vi.fn(() => ({
                limit: vi.fn(async () => options.lastScraped)
              }))
            };
          }
          throw new Error(`Unhandled select columns in test mock: ${columns}`);
        })
      };
    })
  };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 when all health checks succeed", async () => {
    createServerAdminClientMock.mockReturnValue(
      createHealthSupabase({
        dbCheck: { error: null },
        wineCount: { count: 123, error: null },
        lastScraped: { data: [{ last_scraped_at: "2026-03-16T08:00:00.000Z" }], error: null }
      })
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.wines.total).toBe(123);
  });

  it("returns 503 when a sub-check fails even if DB connectivity check succeeds", async () => {
    createServerAdminClientMock.mockReturnValue(
      createHealthSupabase({
        dbCheck: { error: null },
        wineCount: { count: null, error: { message: "count failed" } },
        lastScraped: { data: null, error: null }
      })
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.wines.count_ok).toBe(false);
    expect(body.wines.count_error).toBe("count failed");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerAdminClientMock } = vi.hoisted(() => ({
  createServerAdminClientMock: vi.fn()
}));

vi.mock("@/lib/supabase/server-admin", () => ({
  createServerAdminClient: createServerAdminClientMock
}));

import { GET } from "@/app/api/wines/[id]/history/route";

const WINE_ID = "ea2b5bb6-ee18-4fb9-b06b-dd7b9ec5d88b";

function createHistorySupabase(options: {
  wine: Record<string, unknown> | null;
  wineError?: { message: string } | null;
  history: Array<Record<string, unknown>>;
  historyError?: { message: string } | null;
  onHistoryLimit?: (value: number) => void;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "wines") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: options.wine,
                error: options.wineError ?? null
              }))
            }))
          }))
        };
      }
      if (table === "wine_price_history") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async (value: number) => {
                  options.onHistoryLimit?.(value);
                  return { data: options.history.slice(0, value), error: options.historyError ?? null };
                })
              }))
            }))
          }))
        };
      }
      throw new Error(`Unhandled table in test mock: ${table}`);
    })
  };
}

describe("GET /api/wines/[id]/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid wine id", async () => {
    const request = new Request("http://localhost:3000/api/wines/not-a-uuid/history");
    const response = await GET(request, { params: { id: "not-a-uuid" } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request.");
    expect(createServerAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid limit", async () => {
    const request = new Request(`http://localhost:3000/api/wines/${WINE_ID}/history?limit=1000`);
    const response = await GET(request, { params: { id: WINE_ID } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request.");
    expect(createServerAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns expected payload shape and honors limit", async () => {
    const wine = {
      id: WINE_ID,
      name: "History Wine",
      slug: "history-wine",
      denner_product_id: "12345",
      current_price: 9.9,
      base_price: 12.5,
      case_price: 59.4,
      case_base_price: 75,
      is_on_sale: true,
      last_scraped_at: "2026-03-16T08:00:00.000Z"
    };

    const history = [
      {
        id: "h1",
        scraped_at: "2026-03-16T08:00:00.000Z",
        current_price: 9.9,
        base_price: 12.5,
        case_price: 59.4,
        case_base_price: 75,
        is_on_sale: true,
        source_job: "scrape_wines",
        created_at: "2026-03-16T08:00:00.000Z"
      },
      {
        id: "h2",
        scraped_at: "2026-03-15T08:00:00.000Z",
        current_price: 10.9,
        base_price: 12.5,
        case_price: 65.4,
        case_base_price: 75,
        is_on_sale: true,
        source_job: "scrape_wines",
        created_at: "2026-03-15T08:00:00.000Z"
      }
    ];

    let observedLimit = -1;
    createServerAdminClientMock.mockReturnValue(
      createHistorySupabase({
        wine,
        history,
        onHistoryLimit: (value) => {
          observedLimit = value;
        }
      })
    );

    const request = new Request(`http://localhost:3000/api/wines/${WINE_ID}/history?limit=2`);
    const response = await GET(request, { params: { id: WINE_ID } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(observedLimit).toBe(2);
    expect(body).toMatchObject({
      ok: true,
      wine: { id: WINE_ID, name: "History Wine" },
      returned: 2
    });
    expect(Array.isArray(body.points)).toBe(true);
    expect(body.points).toHaveLength(2);
  });
});

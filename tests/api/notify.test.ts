import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createServerAdminClientMock,
  getServerEnvMock,
  recordJobRunMock,
  sendSaleAlertEmailMock,
  createTrackingTokenMock
} = vi.hoisted(() => ({
  createServerAdminClientMock: vi.fn(),
  getServerEnvMock: vi.fn(),
  recordJobRunMock: vi.fn(),
  sendSaleAlertEmailMock: vi.fn(),
  createTrackingTokenMock: vi.fn(() => "tracking-token")
}));

vi.mock("@/lib/supabase/server-admin", () => ({
  createServerAdminClient: createServerAdminClientMock
}));

vi.mock("@/lib/env", () => ({
  getServerEnv: getServerEnvMock
}));

vi.mock("@/lib/monitoring/job-runs", () => ({
  recordJobRun: recordJobRunMock
}));

vi.mock("@/lib/email/resend", () => ({
  sendSaleAlertEmail: sendSaleAlertEmailMock
}));

vi.mock("@/lib/tokens/tracking", () => ({
  createTrackingToken: createTrackingTokenMock
}));

import { POST } from "@/app/api/notify/route";

type SubscriptionRow = {
  id: string;
  email: string;
  wine_id: string;
  wines: { name: string; current_price: number; base_price: number | null; is_on_sale: boolean };
};

function createNotifySupabase(options: {
  subscriptions?: SubscriptionRow[];
  subscriptionsError?: { message: string } | null;
  eventRow?: {
    id: string;
    last_notified_price: number;
    last_notified_base_price: number | null;
    send_count: number;
  } | null;
  eventSelectError?: { message: string } | null;
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const updateEqMock = vi.fn(async () => ({ error: options.updateError ?? null }));
  const updateMock = vi.fn(() => ({ eq: updateEqMock }));
  const insertMock = vi.fn(async () => ({ error: options.insertError ?? null }));

  const fromMock = vi.fn((table: string) => {
    if (table === "subscriptions") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: options.subscriptions ?? [],
              error: options.subscriptionsError ?? null
            }))
          }))
        }))
      };
    }

    if (table === "notification_events") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: options.eventRow ?? null,
              error: options.eventSelectError ?? null
            }))
          }))
        })),
        update: updateMock,
        insert: insertMock
      };
    }

    throw new Error(`Unhandled table in test mock: ${table}`);
  });

  return { from: fromMock, updateMock, insertMock, updateEqMock };
}

describe("POST /api/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 and logs failed run when RESEND_API_KEY is missing", async () => {
    const supabase = createNotifySupabase({});
    createServerAdminClientMock.mockReturnValue(supabase);
    getServerEnvMock.mockReturnValue({
      APP_BASE_URL: "http://localhost:3000",
      CRON_SECRET: "secret",
      RESEND_API_KEY: undefined
    });

    const request = new Request("http://localhost:3000/api/notify", {
      method: "POST",
      headers: { authorization: "Bearer secret" }
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("RESEND_API_KEY");
    expect(recordJobRunMock).toHaveBeenCalledTimes(1);
    expect(sendSaleAlertEmailMock).not.toHaveBeenCalled();
  });

  it("skips unchanged sale price without sending email or writing dedupe row", async () => {
    const subscription: SubscriptionRow = {
      id: "sub-1",
      email: "test@example.com",
      wine_id: "wine-1",
      wines: { name: "Test Wine", current_price: 10, base_price: 12, is_on_sale: true }
    };

    const supabase = createNotifySupabase({
      subscriptions: [subscription],
      eventRow: {
        id: "evt-1",
        last_notified_price: 10,
        last_notified_base_price: 12,
        send_count: 1
      }
    });

    createServerAdminClientMock.mockReturnValue(supabase);
    getServerEnvMock.mockReturnValue({
      APP_BASE_URL: "http://localhost:3000",
      CRON_SECRET: undefined,
      RESEND_API_KEY: "re_test"
    });

    const request = new Request("http://localhost:3000/api/notify", { method: "POST" });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, total: 1, sent: 0, failed: 0, skipped: 1 });
    expect(sendSaleAlertEmailMock).not.toHaveBeenCalled();
    expect(supabase.updateMock).not.toHaveBeenCalled();
    expect(supabase.insertMock).not.toHaveBeenCalled();
    expect(recordJobRunMock).toHaveBeenCalledTimes(1);
  });
});

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type TrackingItem = {
  id: string;
  is_confirmed: boolean;
  wine: {
    shop: "denner" | "ottos";
    name: string;
    current_price: number;
    base_price: number | null;
    case_price: number | null;
    case_size: number | null;
    is_on_sale: boolean;
    wine_type: string | null;
    country: string | null;
    region: string | null;
    vintage_year: number | null;
  } | null;
};

type Props = {
  token: string;
  items: TrackingItem[];
};

export function MyTrackingsList({ token, items }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUnsubscribe(subscriptionId: string) {
    setError(null);
    setBusyId(subscriptionId);

    try {
      const response = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, subscriptionId })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unsubscribe failed.");
      }

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error.");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-[#6a5544]">No tracked wines yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-2xl border border-[#d6c6ad] bg-[#fffdf8] p-4 shadow-[0_10px_30px_rgba(72,45,26,0.08)]"
        >
          <p className="font-semibold text-[#2e231c]">{item.wine?.name ?? "Unknown wine"}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.08em] text-[#7b6655]">
            Shop: {item.wine?.shop ?? "-"}
          </p>
          <p className="mt-1 text-sm text-[#614d3d]">
            CHF {item.wine ? Number(item.wine.current_price).toFixed(2) : "-"}
            {item.wine?.base_price != null
              ? ` (statt CHF ${Number(item.wine.base_price).toFixed(2)})`
              : ""}
          </p>
          {item.wine?.case_price != null ? (
            <p className="mt-1 text-xs text-[#6d5746]">
              Karton: CHF {Number(item.wine.case_price).toFixed(2)}
              {item.wine.case_size ? ` (${item.wine.case_size}x)` : ""}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[#6d5746]">
            {item.wine?.wine_type ?? "Wein"} · {item.wine?.country ?? "Unbekannt"}
            {item.wine?.region ? ` · ${item.wine.region}` : ""}
            {item.wine?.vintage_year ? ` · ${item.wine.vintage_year}` : ""}
          </p>
          <p className="mt-1 text-xs text-[#7b6655]">
            Status: {item.is_confirmed ? "Confirmed" : "Unconfirmed"}
            {item.wine?.is_on_sale ? " - On Sale" : ""}
          </p>

          <button
            type="button"
            onClick={() => handleUnsubscribe(item.id)}
            disabled={busyId === item.id}
            className="mt-3 rounded-xl border border-[#c7b49a] px-3 py-2 text-sm text-[#3c3026] hover:bg-[#f8f0e5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyId === item.id ? "Unsubscribing..." : "Unsubscribe"}
          </button>
        </article>
      ))}
    </div>
  );
}

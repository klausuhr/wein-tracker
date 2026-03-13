"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WineRow } from "@/lib/supabase/types";

type Props = {
  wines: Pick<
    WineRow,
    | "id"
    | "name"
    | "current_price"
    | "base_price"
    | "case_price"
    | "case_size"
    | "bottle_volume_cl"
    | "is_on_sale"
    | "wine_type"
    | "country"
    | "region"
    | "vintage_year"
  >[];
};

export function WineSearch({ wines }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedWineId, setSelectedWineId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyUrlPreview, setVerifyUrlPreview] = useState<string | null>(null);

  const normalized = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");

  const filtered = useMemo(() => {
    const cleanQuery = normalized(query.trim());
    if (!cleanQuery) return wines.slice(0, 10);
    return wines
      .filter((wine) => normalized(wine.name).includes(cleanQuery))
      .slice(0, 10);
  }, [wines, query]);

  const selectedWine = wines.find((wine) => wine.id === selectedWineId) ?? null;

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setVerifyUrlPreview(null);

    if (!selectedWineId) {
      setError("Please select a wine first.");
      return;
    }
    if (!email.trim()) {
      setError("Please enter an email address.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, wineId: selectedWineId })
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        verifyUrlPreview?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Subscription failed.");
      }

      setMessage(payload.message ?? "Please check your inbox.");
      setVerifyUrlPreview(payload.verifyUrlPreview ?? null);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#d7c8af] bg-[#fffaf2] p-5 shadow-[0_16px_40px_rgba(93,58,31,0.12)] sm:p-6">
      <h2 className="text-3xl text-[#2c211a]">Track a wine</h2>
      <p className="mt-1 text-sm text-[#655141]">
        Suche mit Autocomplete, dann Track starten. Du siehst direkt Land, Region, Jahrgang sowie
        Stück- und Kartonpreis.
      </p>

      <label className="mt-4 block text-sm font-medium text-[#5e4736]" htmlFor="wine-search">
        Wine search
      </label>
      <div ref={containerRef} className="relative mt-1">
        <input
          id="wine-search"
          className="w-full rounded-xl border border-[#ccb79b] bg-white px-4 py-3 text-sm text-[#33281f] outline-none ring-[#7f341f] transition focus:ring-2"
          placeholder="e.g. Primitivo, Rioja, Merlot..."
          value={query}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              (event.currentTarget as HTMLInputElement).blur();
            }
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            setQuery(nextValue);
            setOpen(true);
            if (!nextValue.trim()) {
              setSelectedWineId("");
            }
          }}
        />

        {open ? (
          <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-[#d4c2a8] bg-[#fffdf9] shadow-[0_18px_50px_rgba(48,33,22,0.18)]">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[#7e6751]">No wines found.</p>
            ) : (
              filtered.map((wine) => (
                <button
                  key={wine.id}
                  type="button"
                  onClick={() => {
                    setSelectedWineId(wine.id);
                    setQuery(wine.name);
                    setOpen(false);
                  }}
                  className={`block w-full border-b border-[#f0e6d8] px-4 py-3 text-left text-sm last:border-b-0 ${
                    wine.id === selectedWineId
                      ? "bg-[#f7e5cf] text-[#6c2e1f]"
                      : "text-[#2f241c] hover:bg-[#f8f1e6]"
                  }`}
                >
                  <p className="font-medium">{wine.name}</p>
                  <p className="mt-1 text-xs text-[#6c5745]">
                    {wine.wine_type ?? "Wein"} · {wine.country ?? "Unbekannt"}
                    {wine.region ? ` · ${wine.region}` : ""}
                    {wine.vintage_year ? ` · ${wine.vintage_year}` : ""}
                    {wine.bottle_volume_cl != null ? ` · ${Number(wine.bottle_volume_cl).toFixed(0)} cl` : ""}
                  </p>
                  <p className="mt-1 text-xs font-medium text-[#4e3927]">
                    Flasche CHF {Number(wine.current_price).toFixed(2)}
                    {wine.case_price != null
                      ? ` · Karton CHF ${Number(wine.case_price).toFixed(2)}${
                          wine.case_size ? ` (${wine.case_size}x)` : ""
                        }`
                      : ""}
                  </p>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-5 rounded-2xl border border-dashed border-[#c9b28f] bg-[#fffefb] p-4"
      >
        <p className="text-sm font-medium text-[#2b2119]">
          {selectedWine ? `Selected: ${selectedWine.name}` : "Select a wine to continue"}
        </p>
        {selectedWine ? (
          <p className="mt-1 text-xs text-[#6a5544]">
            {selectedWine.wine_type ?? "Wein"} · {selectedWine.country ?? "Unbekannt"}
            {selectedWine.region ? ` · ${selectedWine.region}` : ""}
            {selectedWine.vintage_year ? ` · ${selectedWine.vintage_year}` : ""} · Flasche CHF{" "}
            {Number(selectedWine.current_price).toFixed(2)}
            {selectedWine.bottle_volume_cl != null
              ? ` (${Number(selectedWine.bottle_volume_cl).toFixed(0)} cl)`
              : ""}
            {selectedWine.case_price != null
              ? ` · Karton CHF ${Number(selectedWine.case_price).toFixed(2)}`
              : ""}
          </p>
        ) : null}
        <label className="mt-3 block text-sm font-medium text-stone-800" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[#ccb79b] bg-white px-3 py-2 text-sm text-[#2e231b]"
          placeholder="name@example.com"
        />
        <button
          type="submit"
          disabled={busy}
          className="mt-3 rounded-xl bg-[#6f1d1b] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#5b1716] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? "Submitting..." : "Track this wine"}
        </button>

        {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        {verifyUrlPreview ? (
          <p className="mt-2 text-xs text-[#6f5a49]">
            Local test verify link:{" "}
            <a href={verifyUrlPreview} className="underline">
              open
            </a>
          </p>
        ) : null}
      </form>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchOffer = {
  id: string;
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
  canonical_wine_id: string;
  canonical_wines: {
    name: string;
    bottle_volume_cl: number | null;
  } | null;
};

type Props = {
  wines: SearchOffer[];
};

export function WineSearch({ wines }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedOfferId, setSelectedOfferId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [trackAllShops, setTrackAllShops] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyUrlPreview, setVerifyUrlPreview] = useState<string | null>(null);

  const normalized = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");

  const canonicalName = (offer: SearchOffer) => offer.canonical_wines?.name ?? offer.name;

  const filtered = useMemo(() => {
    const cleanQuery = normalized(query.trim());
    if (!cleanQuery) return wines.slice(0, 12);
    return wines
      .filter((offer) => {
        const fields = [
          canonicalName(offer),
          offer.name,
          offer.country ?? "",
          offer.region ?? "",
          offer.wine_type ?? "",
          offer.shop
        ];
        return fields.some((field) => normalized(field).includes(cleanQuery));
      })
      .slice(0, 20);
  }, [wines, query]);

  const selectedOffer = wines.find((offer) => offer.id === selectedOfferId) ?? null;
  const selectedCanonicalId = selectedOffer?.canonical_wine_id ?? null;
  const relatedOffers = selectedCanonicalId
    ? wines.filter((offer) => offer.canonical_wine_id === selectedCanonicalId)
    : [];
  const shopCount = new Set(relatedOffers.map((offer) => offer.shop)).size;

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

    if (!selectedOfferId) {
      setError("Please select a wine offer first.");
      return;
    }
    if (!email.trim()) {
      setError("Please enter an email address.");
      return;
    }

    const targetOffers = trackAllShops ? relatedOffers : relatedOffers.filter((offer) => offer.id === selectedOfferId);
    if (targetOffers.length === 0) {
      setError("No offers selected.");
      return;
    }

    setBusy(true);
    try {
      const failures: string[] = [];
      let lastPreview: string | null = null;

      for (const offer of targetOffers) {
        const response = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, offerId: offer.id })
        });

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          error?: string;
          verifyUrlPreview?: string;
        };

        if (!response.ok) {
          failures.push(`${offer.shop}: ${payload.error ?? "Subscription failed."}`);
        } else if (payload.verifyUrlPreview) {
          lastPreview = payload.verifyUrlPreview;
        }
      }

      if (failures.length > 0) {
        throw new Error(failures.join(" | "));
      }

      setMessage(
        trackAllShops
          ? `Tracking für ${targetOffers.length} Shop-Angebote erstellt. Bitte prüfe deine E-Mail.`
          : "Bitte prüfe deine E-Mail und bestätige dein Tracking."
      );
      setVerifyUrlPreview(lastPreview);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#d7c8af] bg-[#fffaf2] p-5 shadow-[0_16px_40px_rgba(93,58,31,0.12)] sm:p-6">
      <h2 className="text-3xl text-[#2c211a]">Track your wine</h2>
      <p className="mt-1 text-sm text-[#655141]">
        Wähle ein Angebot und tracke für alle Shops deine Weine.
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
              setSelectedOfferId("");
              setTrackAllShops(false);
            }
          }}
        />

        {open ? (
          <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-[#d4c2a8] bg-[#fffdf9] shadow-[0_18px_50px_rgba(48,33,22,0.18)]">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[#7e6751]">No wines found.</p>
            ) : (
              filtered.map((offer) => {
                const offerCanonicalName = canonicalName(offer);
                const canonicalOffers = wines.filter((item) => item.canonical_wine_id === offer.canonical_wine_id);
                const offerShopCount = new Set(canonicalOffers.map((item) => item.shop)).size;
                return (
                  <button
                    key={offer.id}
                    type="button"
                    onClick={() => {
                      setSelectedOfferId(offer.id);
                      setQuery(offerCanonicalName);
                      setOpen(false);
                    }}
                    className={`block w-full border-b border-[#f0e6d8] px-4 py-3 text-left text-sm last:border-b-0 ${
                      offer.id === selectedOfferId
                        ? "bg-[#f7e5cf] text-[#6c2e1f]"
                        : "text-[#2f241c] hover:bg-[#f8f1e6]"
                    }`}
                  >
                    <p className="font-medium">{offerCanonicalName}</p>
                    <p className="mt-1 text-xs text-[#6c5745]">
                      <span className="rounded bg-[#efe3d2] px-2 py-0.5 uppercase tracking-[0.08em]">
                        {offer.shop}
                      </span>
                      <span className="ml-2">{offer.wine_type ?? "Wein"} </span>· {offer.country ?? "Unbekannt"}
                      {offer.region ? ` · ${offer.region}` : ""}
                      {offer.vintage_year ? ` · ${offer.vintage_year}` : ""}
                      {offer.canonical_wines?.bottle_volume_cl != null
                        ? ` · ${Number(offer.canonical_wines.bottle_volume_cl).toFixed(0)} cl`
                        : ""}
                      {offerShopCount > 1 ? ` · ${offerShopCount} Shops` : ""}
                    </p>
                    <p className="mt-1 text-xs font-medium text-[#4e3927]">
                      Flasche CHF {Number(offer.current_price).toFixed(2)}
                      {offer.case_price != null
                        ? ` · Karton CHF ${Number(offer.case_price).toFixed(2)}${
                            offer.case_size ? ` (${offer.case_size}x)` : ""
                          }`
                        : ""}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-5 rounded-2xl border border-dashed border-[#c9b28f] bg-[#fffefb] p-4"
      >
        <p className="text-sm font-medium text-[#2b2119]">
          {selectedOffer ? `Selected: ${canonicalName(selectedOffer)} (${selectedOffer.shop})` : "Select an offer"}
        </p>
        {selectedOffer ? (
          <p className="mt-1 text-xs text-[#6a5544]">
            {selectedOffer.wine_type ?? "Wein"} · {selectedOffer.country ?? "Unbekannt"}
            {selectedOffer.region ? ` · ${selectedOffer.region}` : ""}
            {selectedOffer.vintage_year ? ` · ${selectedOffer.vintage_year}` : ""} · Flasche CHF{" "}
            {Number(selectedOffer.current_price).toFixed(2)}
            {selectedOffer.case_price != null
              ? ` · Karton CHF ${Number(selectedOffer.case_price).toFixed(2)}`
              : ""}
            {shopCount > 1 ? ` · Auch in ${shopCount - 1} weiterem Shop verfügbar` : ""}
          </p>
        ) : null}
        {selectedOffer && relatedOffers.length > 1 ? (
          <label className="mt-3 flex items-center gap-2 text-xs text-[#5f4939]">
            <input
              type="checkbox"
              checked={trackAllShops}
              onChange={(event) => setTrackAllShops(event.target.checked)}
            />
            Track all available shop offers for this wine
          </label>
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
          {busy ? "Wird gesendet..." : trackAllShops ? "Alle Shops tracken" : "Angebot Tracken"}
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

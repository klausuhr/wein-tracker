import { Wine } from "lucide-react";
import { createServerAdminClient } from "@/lib/supabase/server-admin";
import { WineSearch, type SearchOffer } from "@/components/wine-search";

export const dynamic = "force-dynamic";

type CanonicalJoinedRow = {
  name: string;
  bottle_volume_cl: number | null;
  case_size: number | null;
  wine_type: string | null;
  country: string | null;
  region: string | null;
  vintage_year: number | null;
};

type WineOfferRowForSearch = {
  id: string;
  shop: SearchOffer["shop"];
  name: string;
  current_price: number;
  base_price: number | null;
  case_price: number | null;
  is_on_sale: boolean;
  canonical_wine_id: string;
  canonical_wines: CanonicalJoinedRow | CanonicalJoinedRow[] | null;
};

function mapRowToSearchOffer(row: WineOfferRowForSearch): SearchOffer {
  const canonical = Array.isArray(row.canonical_wines)
    ? row.canonical_wines[0] ?? null
    : row.canonical_wines ?? null;

  return {
    id: row.id,
    shop: row.shop,
    name: row.name,
    current_price: row.current_price,
    base_price: row.base_price,
    case_price: row.case_price,
    is_on_sale: row.is_on_sale,
    canonical_wine_id: row.canonical_wine_id,
    wine_type: canonical?.wine_type ?? null,
    country: canonical?.country ?? null,
    region: canonical?.region ?? null,
    vintage_year: canonical?.vintage_year ?? null,
    case_size: canonical?.case_size ?? null,
    canonical_wines: canonical
      ? {
          name: canonical.name,
          bottle_volume_cl: canonical.bottle_volume_cl
        }
      : null
  };
}

export default async function HomePage() {
  const supabase = createServerAdminClient();
  const pageSize = 1000;
  const allRows: WineOfferRowForSearch[] = [];
  let from = 0;
  let error: { message: string } | null = null;

  while (true) {
    const { data, error: pageError } = await supabase
      .from("wine_offers")
      .select(
        "id, shop, name, current_price, base_price, case_price, is_on_sale, canonical_wine_id, canonical_wines(name,bottle_volume_cl,case_size,wine_type,country,region,vintage_year)"
      )
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (pageError) {
      error = { message: pageError.message };
      break;
    }

    const rows = data ?? [];
    allRows.push(...(rows as WineOfferRowForSearch[]));
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const wines = Array.from(
    new Map(allRows.map((row) => [row.id, row])).values()
  ).map(mapRowToSearchOffer);

  return (
    <main className="ui-shell mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-10 sm:px-6">
      <div className="grain-overlay" />
      <header className="mb-8 rounded-3xl border border-[#d7c8af] bg-[#fdf8ef] p-6 shadow-[0_20px_50px_rgba(99,57,31,0.1)] sm:p-8">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#ceb89b] bg-[#f8eddc] px-3 py-1 text-xs uppercase tracking-[0.14em] text-[#7e5a34]">
          <Wine className="h-4 w-4" />
          Multi-Shop Wine Radar
        </div>
        <div className="grid gap-5 sm:grid-cols-[1.5fr_1fr] sm:items-end">
          <div>
            <h1 className="text-4xl leading-tight text-[#2b2119] sm:text-5xl">Wein-Tracker</h1>
            <p className="mt-2 text-sm text-[#60493a] sm:text-base">
              Finde deine Weine und tracke Angebote/Rabatte je Shop mit automatischer
              Benachrichtigung.
            </p>
          </div>
          <div className="rounded-2xl border border-[#d8c8b1] bg-white/80 p-4 text-sm text-[#4f3b2c]">
            <p className="text-xs uppercase tracking-[0.12em] text-[#8b6d4a]">Katalogstatus</p>
            <p className="mt-2 text-2xl font-semibold text-[#2f241c]">{allRows.length} Weine geladen</p>
            <p className="mt-1 text-xs text-[#7f6752]">
              Supports: Denner, Ottos · inkl. Land, Region, Jahrgang, Stück- und Kartonpreis
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Failed to load wines from Supabase: {error.message}
        </div>
      ) : (
        <WineSearch wines={wines} />
      )}

      <footer className="mt-6 text-right text-xs text-[#7f6752]">V1.0</footer>
    </main>
  );
}

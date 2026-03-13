import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { MyTrackingsList } from "@/components/my-trackings-list";
import { createServerAdminClient } from "@/lib/supabase/server-admin";
import { readTrackingToken } from "@/lib/tokens/tracking";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { token: string };
  searchParams: { verified?: string };
};

export default async function MyTrackingsPage({ params, searchParams }: PageProps) {
  noStore();
  const payload = readTrackingToken(params.token);

  if (!payload) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold text-stone-900">Invalid tracking link</h1>
        <p className="mt-3 text-sm text-stone-700">
          This link is not valid. Please use the link from your email.
        </p>
      </main>
    );
  }

  const supabase = createServerAdminClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, is_confirmed, wines(name,current_price,base_price,case_price,case_size,is_on_sale,wine_type,country,region,vintage_year)"
    )
    .eq("email", payload.email)
    .order("created_at", { ascending: false });

  return (
    <main className="ui-shell mx-auto max-w-4xl px-4 py-10">
      <header className="mb-6 rounded-3xl border border-[#d7c8af] bg-[#fff9ef] p-6 shadow-[0_16px_40px_rgba(93,58,31,0.12)]">
        <h1 className="text-4xl text-[#2b2119]">My wine trackings</h1>
        <p className="mt-2 text-sm text-[#5d4738]">{payload.email}</p>
        {searchParams.verified === "1" ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Email verified. Tracking is active.
          </p>
        ) : null}
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load trackings: {error.message}
        </div>
      ) : (
        <MyTrackingsList
          token={params.token}
          items={(data ?? []).map((row) => ({
            id: row.id,
            is_confirmed: row.is_confirmed,
            wine: Array.isArray(row.wines) ? row.wines[0] ?? null : row.wines ?? null
          }))}
        />
      )}

      <div className="mt-8">
        <Link href="/" className="text-sm text-[#6f1d1b] underline">
          Back to wine search
        </Link>
      </div>
    </main>
  );
}

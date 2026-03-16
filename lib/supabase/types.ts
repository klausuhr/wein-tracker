export type WineRow = {
  id: string;
  name: string;
  slug: string;
  denner_product_id: string;
  source_url: string;
  image_url: string | null;
  base_price: number | null;
  current_price: number;
  case_price: number | null;
  case_base_price: number | null;
  wine_type: string | null;
  country: string | null;
  region: string | null;
  vintage_year: number | null;
  category_path: string | null;
  bottle_volume_cl: number | null;
  case_size: number | null;
  is_on_sale: boolean;
  last_scraped_at: string;
};

export type CanonicalWineRow = {
  id: string;
  canonical_key: string;
  name: string;
  image_url: string | null;
  wine_type: string | null;
  country: string | null;
  region: string | null;
  vintage_year: number | null;
  category_path: string | null;
  bottle_volume_cl: number | null;
  case_size: number | null;
  created_at: string;
  updated_at: string;
};

export type ShopId = "denner" | "ottos";

export type WineOfferRow = {
  id: string;
  canonical_wine_id: string;
  shop: ShopId;
  shop_product_id: string;
  source_url: string;
  name: string;
  image_url: string | null;
  base_price: number | null;
  current_price: number;
  case_price: number | null;
  case_base_price: number | null;
  is_on_sale: boolean;
  last_scraped_at: string;
  created_at: string;
  updated_at: string;
};

export type SubscriptionRow = {
  id: string;
  email: string;
  wine_id: string;
  offer_id: string | null;
  is_confirmed: boolean;
  confirmation_token: string;
  created_at: string;
};

export type ScrapedWine = {
  name: string;
  slug: string;
  denner_product_id: string;
  source_url: string;
  image_url: string | null;
  base_price: number | null;
  current_price: number;
  case_price: number | null;
  case_base_price: number | null;
  wine_type: string | null;
  country: string | null;
  region: string | null;
  vintage_year: number | null;
  category_path: string | null;
  bottle_volume_cl: number | null;
  case_size: number | null;
  is_on_sale: boolean;
};

export type ScrapedOffer = {
  shop: ShopId;
  shop_product_id: string;
  source_url: string;
  name: string;
  image_url: string | null;
  current_price: number;
  base_price: number | null;
  case_price: number | null;
  case_base_price: number | null;
  wine_type: string | null;
  country: string | null;
  region: string | null;
  vintage_year: number | null;
  category_path: string | null;
  bottle_volume_cl: number | null;
  case_size: number | null;
  is_on_sale: boolean;
};

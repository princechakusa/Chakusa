import { prisma } from "../prisma.js";

// PROGRAM 2 LOOP 2: marketplace categories. `Business.industry` is free text;
// this maps it to a curated category taxonomy without touching the Business
// model. A business's category = its listing override, else the mapped
// industry, else "other".

export interface CategorySeed {
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  parent?: string;
  trending?: boolean;
}

export const DEFAULT_CATEGORIES: CategorySeed[] = [
  { slug: "beauty", name: "Beauty & Grooming", icon: "sparkles", sortOrder: 10, trending: true },
  { slug: "hair", name: "Hair", icon: "scissors", sortOrder: 11, parent: "beauty" },
  { slug: "nails", name: "Nails", icon: "hand", sortOrder: 12, parent: "beauty" },
  { slug: "spa", name: "Spa & Massage", icon: "flower", sortOrder: 13, parent: "beauty" },
  { slug: "barber", name: "Barbershop", icon: "razor", sortOrder: 14, parent: "beauty" },
  { slug: "wellness", name: "Health & Wellness", icon: "heart-pulse", sortOrder: 20, trending: true },
  { slug: "fitness", name: "Fitness & Training", icon: "dumbbell", sortOrder: 21, parent: "wellness" },
  { slug: "therapy", name: "Therapy & Counselling", icon: "brain", sortOrder: 22, parent: "wellness" },
  { slug: "dental", name: "Dental", icon: "tooth", sortOrder: 23, parent: "wellness" },
  { slug: "home", name: "Home Services", icon: "home", sortOrder: 30 },
  { slug: "cleaning", name: "Cleaning", icon: "spray", sortOrder: 31, parent: "home" },
  { slug: "repairs", name: "Repairs & Handywork", icon: "wrench", sortOrder: 32, parent: "home" },
  { slug: "auto", name: "Automotive", icon: "car", sortOrder: 40 },
  { slug: "pets", name: "Pet Care", icon: "paw", sortOrder: 50 },
  { slug: "events", name: "Events & Photography", icon: "camera", sortOrder: 60 },
  { slug: "professional", name: "Professional Services", icon: "briefcase", sortOrder: 70 },
  { slug: "tutoring", name: "Tutoring & Lessons", icon: "book", sortOrder: 80 },
  { slug: "other", name: "Other", icon: "grid", sortOrder: 999 },
];

const INDUSTRY_TO_CATEGORY: Record<string, string> = {
  "hair salon": "hair",
  "hairdresser": "hair",
  hair: "hair",
  salon: "beauty",
  "beauty salon": "beauty",
  beauty: "beauty",
  barbershop: "barber",
  barber: "barber",
  "nail salon": "nails",
  nails: "nails",
  spa: "spa",
  massage: "spa",
  "massage therapy": "spa",
  gym: "fitness",
  fitness: "fitness",
  "personal training": "fitness",
  "personal trainer": "fitness",
  yoga: "fitness",
  therapist: "therapy",
  therapy: "therapy",
  counselling: "therapy",
  counseling: "therapy",
  psychology: "therapy",
  dentist: "dental",
  dental: "dental",
  "dental clinic": "dental",
  cleaning: "cleaning",
  "cleaning service": "cleaning",
  "house cleaning": "cleaning",
  handyman: "repairs",
  plumber: "repairs",
  electrician: "repairs",
  repairs: "repairs",
  mechanic: "auto",
  "auto repair": "auto",
  automotive: "auto",
  "car wash": "auto",
  "pet grooming": "pets",
  "pet care": "pets",
  veterinary: "pets",
  vet: "pets",
  photographer: "events",
  photography: "events",
  "event planning": "events",
  events: "events",
  consultant: "professional",
  consulting: "professional",
  accounting: "professional",
  legal: "professional",
  tutor: "tutoring",
  tutoring: "tutoring",
  "music lessons": "tutoring",
  "driving school": "tutoring",
};

export function mapIndustryToCategory(industry: string | null | undefined): string {
  if (!industry) return "other";
  const key = industry.trim().toLowerCase();
  if (INDUSTRY_TO_CATEGORY[key]) return INDUSTRY_TO_CATEGORY[key];
  for (const [needle, slug] of Object.entries(INDUSTRY_TO_CATEGORY)) {
    if (key.includes(needle)) return slug;
  }
  return "other";
}

export async function seedMarketplaceCategories() {
  for (const seed of DEFAULT_CATEGORIES) {
    const parent = seed.parent ? await prisma.marketplaceCategory.findUnique({ where: { slug: seed.parent }, select: { id: true } }) : null;
    await prisma.marketplaceCategory.upsert({
      where: { slug: seed.slug },
      create: { slug: seed.slug, name: seed.name, icon: seed.icon, sortOrder: seed.sortOrder, trending: seed.trending ?? false, parentId: parent?.id ?? null },
      update: { name: seed.name, icon: seed.icon, sortOrder: seed.sortOrder, trending: seed.trending ?? false, parentId: parent?.id ?? null },
    });
  }
  await refreshCategoryCounts();
  return prisma.marketplaceCategory.count();
}

/** Recomputes businessCount per category from discoverable businesses. */
export async function refreshCategoryCounts() {
  const businesses = await prisma.business.findMany({
    where: { platformStatus: "ACTIVE", publicSlug: { not: null } },
    select: { industry: true, marketplaceListing: { select: { listed: true, discoverable: true, categorySlug: true } } },
  });
  const counts = new Map<string, number>();
  for (const business of businesses) {
    const listing = business.marketplaceListing;
    if (listing && (!listing.listed || !listing.discoverable)) continue;
    const slug = listing?.categorySlug ?? mapIndustryToCategory(business.industry);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const categories = await prisma.marketplaceCategory.findMany({ select: { id: true, slug: true } });
  await prisma.$transaction(
    categories.map((category) => prisma.marketplaceCategory.update({ where: { id: category.id }, data: { businessCount: counts.get(category.slug) ?? 0 } })),
  );
  return Object.fromEntries(counts);
}

export async function listCategories(options: { onlyActive?: boolean } = {}) {
  const categories = await prisma.marketplaceCategory.findMany({
    where: options.onlyActive === false ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const byId = new Map(categories.map((category) => [category.id, category]));
  return categories
    .filter((category) => !category.parentId)
    .map((parent) => ({
      ...parent,
      children: categories.filter((child) => child.parentId === parent.id),
      parentName: null as string | null,
    }))
    .concat(categories.filter((category) => category.parentId && !byId.has(category.parentId)).map((c) => ({ ...c, children: [], parentName: null })));
}

export async function trendingCategories(limit = 8) {
  return prisma.marketplaceCategory.findMany({
    where: { active: true, trending: true },
    orderBy: [{ businessCount: "desc" }, { sortOrder: "asc" }],
    take: limit,
  });
}

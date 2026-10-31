
export type ProductCategory =
  | "Laptops"
  | "Smartphones"
  | "Tablets"
  | "Headphones"
  | "Smartwatches"
  | "Accessories";

export function extractCategoryFilter(
  query: string,
): ProductCategory | null {
  const normalized = query.toLowerCase();

  const categories: {
    category: ProductCategory;
    keywords: string[];
  }[] = [
    {
      category: "Laptops",
      keywords: [
        "laptop", "notebook", "ultrabook",
        "macbook", "thinkpad",
      ],
    },
    {
      category: "Smartphones",
      keywords: [
        "telefon", "okostelefon",
        "smartphone", "iphone",
      ],
    },
    {
      category: "Tablets",
      keywords: [
        "tablet", "táblagép", "ipad",
      ],
    },
    {
      category: "Headphones",
      keywords: [
        "fejhallgató", "fülhallgató",
        "headphone", "earbuds",
      ],
    },
    {
      category: "Smartwatches",
      keywords: [
        "okosóra", "okosórá", "smartwatch"
      ],
    },
    {
      category: "Accessories",
      keywords: [
        "kiegészítő", "accessories",
        "billentyűzet", "egér",
      ],
    },
  ];

  for (const entry of categories) {
    if (entry.keywords.some((keyword) =>
      normalized.includes(keyword)
    )) {
      return entry.category;
    }
  }

  return null;
}


export interface PriceFilter {
  max_price: number;
  currency: "USD" | "EUR";
}

export function extractPriceFilter(query: string): PriceFilter | null {
  const amountPattern = String.raw`\d+(?:[.,]\d+)?`;
  const currencyPattern = String.raw`(?:USD|EUR|dollár|dollar|euró|euro|\$|€)`;

  const patterns = [
    new RegExp(
      String.raw`(?:maximum|max\.?|legfeljebb|up to|at most)\s*(${amountPattern})\s*(${currencyPattern})`,
      "i",
    ),
    new RegExp(
      String.raw`(${amountPattern})\s*(${currencyPattern})\s*(?:alatt|below|under|maximum|max)`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (!match) continue;

    const amount = Number(match[1].replace(",", "."));
    const currencyText = match[2].toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    const currency: "USD" | "EUR" =
      ["eur", "euró", "euro", "€"].includes(currencyText)
        ? "EUR"
        : "USD";

    return { max_price: amount, currency };
  }

  return null;
}

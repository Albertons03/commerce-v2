
import {
  productInputSchema,
  type ProductInput,
} from "@/lib/validations/product-ingestion";

const REQUIRED_COLUMNS = [
  "product_id",
  "product_name",
  "product_description",
] as const;

const ALLOWED_COLUMNS = [
  ...REQUIRED_COLUMNS,
  "category",
  "price",
  "currency",
  "product_url",
  "product_image_url",
] as const;

const MAX_PRODUCTS = 50;

export type CsvRowResult = {
  row: number;
  product?: ProductInput;
  errors: string[];
};

export type CsvParseResult = {
  rows: CsvRowResult[];
  validProducts: ProductInput[];
  errors: string[];
};

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field !== "" || closedQuote) {
        throw new Error("Invalid CSV quote placement.");
      }
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
      closedQuote = false;
    } else if (char === "\n" || char === "\r") {
      record.push(field);

      if (record.some((value) => value.trim() !== "")) {
        records.push(record);
      }

      record = [];
      field = "";
      closedQuote = false;

      if (char === "\r" && input[i + 1] === "\n") {
        i++;
      }
    } else {
      if (closedQuote) {
        throw new Error("Unexpected characters after closing quote.");
      }

      field += char;
    }
  }

  if (quoted) {
    throw new Error("Unclosed CSV quoted field.");
  }

  record.push(field);

  if (record.some((value) => value.trim() !== "")) {
    records.push(record);
  }

  return records;
}

export function parseProductCsv(text: string): CsvParseResult {
  const records = parseCsvRecords(text);

  if (records.length === 0) {
    return {
      rows: [],
      validProducts: [],
      errors: ["CSV is empty."],
    };
  }

  const headers = records[0].map((header) => header.trim());
  const errors: string[] = [];

  if (new Set(headers).size !== headers.length) {
    errors.push("Duplicate CSV column names.");
  }

  for (const required of REQUIRED_COLUMNS) {
    if (!headers.includes(required)) {
      errors.push(`Missing required column: ${required}`);
    }
  }

  for (const header of headers) {
    if (!(ALLOWED_COLUMNS as readonly string[]).includes(header)) {
      errors.push(`Unsupported CSV column: ${header}`);
    }
  }

  if (errors.length > 0) {
    return {
      rows: [],
      validProducts: [],
      errors,
    };
  }

  const dataRecords = records.slice(1);

  // Reject CSV files containing headers but no products.
  if (dataRecords.length === 0) {
    return {
      rows: [],
      validProducts: [],
      errors: ["CSV contains no products."],
    };
  }

  if (dataRecords.length > MAX_PRODUCTS) {
    return {
      rows: [],
      validProducts: [],
      errors: [`Maximum ${MAX_PRODUCTS} products per CSV file.`],
    };
  }

  const seenIds = new Set<string>();

  const rows: CsvRowResult[] = dataRecords.map((values, index) => {
    const row = index + 2;
    const rowErrors: string[] = [];

    if (values.length !== headers.length) {
      return {
        row,
        errors: [
          `Expected ${headers.length} columns, received ${values.length}.`,
        ],
      };
    }

    const raw = Object.fromEntries(
      headers.map((header, i) => [header, values[i].trim()])
    );

    const product: Record<string, unknown> = {
      product_id: raw.product_id,
      product_name: raw.product_name,
      product_description: raw.product_description,
    };

    for (const optional of [
      "category",
      "currency",
      "product_url",
      "product_image_url",
    ]) {
      if (raw[optional]) {
        product[optional] =
          optional === "currency"
            ? raw[optional].toUpperCase()
            : raw[optional];
      }
    }

    if (raw.price !== undefined && raw.price !== "") {
      product.price = Number(raw.price);
    }

    const validation = productInputSchema.safeParse(product);

    if (!validation.success) {
      rowErrors.push(
        ...validation.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`
        )
      );
    }

    if (seenIds.has(raw.product_id)) {
      rowErrors.push("Duplicate product_id in CSV.");
    }

    seenIds.add(raw.product_id);

    return {
      row,
      ...(validation.success && rowErrors.length === 0
        ? { product: validation.data }
        : {}),
      errors: rowErrors,
    };
  });

  return {
    rows,
    validProducts: rows.flatMap((row) =>
      row.product ? [row.product] : []
    ),
    errors,
  };
}

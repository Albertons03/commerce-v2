import { z } from "zod";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "URL must use HTTP or HTTPS",
  });

export const productInputSchema = z.object({
  product_id: z.string().min(1).max(255),
  product_name: z.string().min(2).max(500),
  product_description: z.string().min(10).max(5000),
  category: z.string().max(100).optional(),
  price: z.number().finite().nonnegative().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  product_url: httpUrlSchema.optional(),
  product_image_url: httpUrlSchema.optional(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
});

export const productIngestionRequestSchema = z.object({
  products: z.array(productInputSchema).min(1).max(100),
  batch_size: z.number().int().min(1).max(20).default(10),
  overwrite_existing: z.boolean().default(false),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductIngestionRequest = z.infer<
  typeof productIngestionRequestSchema
>;

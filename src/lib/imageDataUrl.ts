import { z } from "zod";

// Small profile images (a business's photo, a customer's picture) travel as
// base64 data URIs and are stored as text. The app shrinks them to ~512 px
// before upload, so real ones are tens of KB; the cap is a guard, not a target.

const DATA_URL = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/;
export const IMAGE_DATA_URL_MAX_LENGTH = 400_000;

export const imageDataUrlSchema = z
  .string()
  .regex(DATA_URL, "Must be a PNG, JPEG, WebP or GIF image")
  .max(IMAGE_DATA_URL_MAX_LENGTH, "Image is too large. Choose one under about 250 KB");

/** Decodes a stored image data URI into its bytes and content type, or null if it is not one. */
export function decodeImageDataUrl(value: string | null | undefined): { contentType: string; bytes: Buffer } | null {
  if (!value) return null;
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const contentType = match[1] === "image/jpg" ? "image/jpeg" : match[1]!;
  return { contentType, bytes: Buffer.from(match[2]!.replace(/[\r\n]/g, ""), "base64") };
}

/** Public, cache-busting path to a business's photo (relative to the API origin), or null when it has none. */
export function businessPhotoPath(business: { publicSlug: string | null; logoDataUrl: string | null; updatedAt: Date }): string | null {
  if (!business.publicSlug || !business.logoDataUrl) return null;
  return `/public/business/${encodeURIComponent(business.publicSlug)}/photo?v=${business.updatedAt.getTime().toString(36)}`;
}

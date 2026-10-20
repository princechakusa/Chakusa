import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";

// Owner-managed photo gallery for the customer-facing business page and
// discovery cards. Bytes live in Postgres (see BusinessGalleryPhoto); the app
// compresses to <=1600 px JPEG before upload, so the caps are guards.

export const GALLERY_MAX_PHOTOS = 12;
export const GALLERY_MAX_BYTES = 700_000;
const CAPTION_MAX = 140;

/** Content type from magic bytes - the declared type is never trusted. */
export function sniffImageType(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Public path (relative to the API origin). Photo ids are immutable, so the path is cacheable forever. */
export function galleryPhotoPath(slug: string, photoId: string): string {
  return `/public/business/${encodeURIComponent(slug)}/gallery/${photoId}`;
}

export async function listGallery(businessId: string) {
  const [business, photos] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { publicSlug: true } }),
    prisma.businessGalleryPhoto.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, position: true, caption: true, byteSize: true, createdAt: true } }),
  ]);
  return photos.map((photo) => ({ ...photo, url: business?.publicSlug ? galleryPhotoPath(business.publicSlug, photo.id) : null }));
}

export async function addGalleryPhoto(businessId: string, input: { dataBase64: string; caption?: string | null }) {
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length) throw ApiError.badRequest("The photo is empty");
  if (bytes.length > GALLERY_MAX_BYTES) throw ApiError.badRequest("That photo is too large. Choose one under 700 KB");
  const mimeType = sniffImageType(bytes);
  if (!mimeType) throw ApiError.badRequest("Photos must be JPEG, PNG or WebP");
  const caption = input.caption?.trim().slice(0, CAPTION_MAX) || null;

  return prisma.$transaction(async (tx) => {
    // Serialise concurrent uploads for one business so the cap holds.
    await tx.$executeRaw`SELECT 1 FROM businesses WHERE id = ${businessId} FOR UPDATE`;
    const count = await tx.businessGalleryPhoto.count({ where: { businessId } });
    if (count >= GALLERY_MAX_PHOTOS) throw ApiError.badRequest(`You can add up to ${GALLERY_MAX_PHOTOS} photos. Remove one first`);
    const last = await tx.businessGalleryPhoto.findFirst({ where: { businessId }, orderBy: { position: "desc" }, select: { position: true } });
    return tx.businessGalleryPhoto.create({
      data: { businessId, position: (last?.position ?? -1) + 1, mimeType, data: bytes, byteSize: bytes.length, caption },
      select: { id: true, position: true, caption: true, byteSize: true, createdAt: true },
    });
  });
}

export async function deleteGalleryPhoto(businessId: string, photoId: string) {
  const result = await prisma.businessGalleryPhoto.deleteMany({ where: { id: photoId, businessId } });
  if (!result.count) throw ApiError.notFound("Photo not found");
}

/** Reorders to exactly the given id list, which must be this business's complete set. */
export async function reorderGallery(businessId: string, orderedIds: string[]) {
  const existing = await prisma.businessGalleryPhoto.findMany({ where: { businessId }, select: { id: true } });
  const owned = new Set(existing.map((row) => row.id));
  if (orderedIds.length !== owned.size || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !owned.has(id))) {
    throw ApiError.badRequest("Send every photo id exactly once");
  }
  await prisma.$transaction(orderedIds.map((id, position) => prisma.businessGalleryPhoto.update({ where: { id }, data: { position } })));
  return listGallery(businessId);
}

/** Bytes for the public route. Same visibility rule as the public profile: active and listed. */
export async function publicGalleryPhoto(slug: string, photoId: string) {
  const photo = await prisma.businessGalleryPhoto.findFirst({
    where: {
      id: photoId,
      business: { publicSlug: slug, platformStatus: "ACTIVE", OR: [{ marketplaceListing: null }, { marketplaceListing: { listed: true } }] },
    },
    select: { mimeType: true, data: true },
  });
  if (!photo) throw ApiError.notFound("Photo not found");
  return { contentType: photo.mimeType, bytes: Buffer.from(photo.data) };
}

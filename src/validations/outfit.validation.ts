import GarmentRepo from "../repositories/garment.repository";
import OutfitRepo from "../repositories/outfit.repository";
import { throwResponse } from "../utils/throw-response";

/**
 * Ensures every garmentId in `items` exists. Run before any file upload
 * so an invalid id can't orphan an S3 object / File row.
 */
export async function validateGarmentIds(items: { garmentId: string }[] = []) {
  const ids = items.map((i) => i.garmentId).filter(Boolean);
  if (!ids.length) return;
  const found = await GarmentRepo.countByIds(ids);
  if (found !== new Set(ids).size) {
    throwResponse(400, "One or more garmentIds do not exist");
  }
}

/**
 * Returns the user's existing outfit with the same garment composition, or
 * null if none. System outfits (no userId) and empty compositions are skipped.
 *
 * Used to make outfit-create idempotent per user: if the same composition
 * already exists, callers can return the existing row instead of duplicating.
 */
export async function findExistingComposition(
  userId: string | undefined,
  items: { garmentId: string }[] = []
) {
  if (!userId || !items.length) return null;
  const garmentIds = items.map((i) => i.garmentId).filter(Boolean);
  return OutfitRepo.findByExactGarmentSet(userId, garmentIds);
}

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
 * Rejects creating an outfit with the same garment composition the user
 * already has. System outfits (no userId) and empty compositions are skipped.
 */
export async function assertNoDuplicateComposition(
  userId: string | undefined,
  items: { garmentId: string }[] = []
) {
  if (!userId || !items.length) return;
  const garmentIds = items.map((i) => i.garmentId).filter(Boolean);
  const existing = await OutfitRepo.findByExactGarmentSet(userId, garmentIds);
  if (existing) {
    throwResponse(
      409,
      `An outfit with these garments already exists: "${existing.name}"`,
      { existingId: existing.id },
    );
  }
}

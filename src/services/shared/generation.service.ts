import OutlineRepo from "../../repositories/outline.repository";
import GarmentRepo from "../../repositories/garment.repository";
import OutfitRepo from "../../repositories/outfit.repository";
import { DESIGN_TYPE, FITTING_SLOT } from "@prisma/client";

export default class GenerationService {
  /**
   * Generates an outfit based on a user prompt and other context.
   */
  static async generateOutfit(data: {
    userId?: string;
    userPrompt: string[];
    location?: string;
    startTime?: Date;
    weather?: any;
  }) {
    // 1. Create/Update UserOutline
    const outline = await OutlineRepo.create({
      userId: data.userId,
      userPrompt: data.userPrompt,
      location: data.location,
      startTime: data.startTime,
      weather: data.weather,
    });

    // 2. Search for garments (Basic implementation: find one for each slot)
    // In a real scenario, this would use AI to match categories, weather, etc.
    const slots = [FITTING_SLOT.UpperGarment, FITTING_SLOT.LowerGarment, FITTING_SLOT.FootGarment];
    const items: { garmentId: string; slot: FITTING_SLOT }[] = [];

    for (let i = 0; i < slots.length; i++) {
      const { data: garments } = await GarmentRepo.findAll({
        fittingSlot: { has: slots[i] }
      }, 1, 1);

      if (garments.length > 0) {
        items.push({
          garmentId: garments[0].id,
          slot: slots[i],
        });
      }
    }

    if (items.length === 0) {
      throw { status: 400, message: "Could not find any suitable garments for this prompt." };
    }

    // 3. Create the Outfit
    // NOTE: Outfit requires a fileId. For now, we'll use the fileId of the first garment
    // or a placeholder if we had one. In production, this might be an AI-generated preview image.
    const firstGarment = await GarmentRepo.findById(items[0].garmentId);

    const outfit = await OutfitRepo.create({
      userId: data.userId,
      name: `Generated Outfit for: ${data.userPrompt[0]?.substring(0, 20) || "Today"}`,
      description: `Automatically generated based on prompt: ${data.userPrompt.join(", ")}`,
      designType: DESIGN_TYPE.systemDesign,
      isPublic: false,
      fileId: firstGarment!.fileId, // Use first garment's image as placeholder
      userOutlineId: outline.id,
      items: items,
    });

    return outfit;
  }
}

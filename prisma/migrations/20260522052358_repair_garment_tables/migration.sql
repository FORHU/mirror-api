-- Repair migration: create Garment-related tables that are missing from the DB
-- despite being marked as applied in _prisma_migrations (schema drift).
-- All statements use IF NOT EXISTS / DO $$ so this is safe to re-run.

-- ─── Enums (create only if missing) ─────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "GARMENT_GENDER" AS ENUM ('MALE', 'FEMALE', 'UNISEX');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GARMENT_TYPES" AS ENUM (
    'None', 'Hat', 'Beanie', 'Cap', 'Headband',
    'Shirt', 'TShirt', 'Polo', 'Blouse', 'Hoodie', 'Sweater', 'Jacket', 'Coat', 'Blazer',
    'Pants', 'Jeans', 'Shorts', 'Skirt',
    'Dress', 'Jumpsuit', 'Romper', 'Suit',
    'Shoes', 'Sneakers', 'Sandals', 'Boots', 'Heels', 'Socks',
    'Watch', 'Belt', 'Sunglasses', 'Bag', 'Backpack',
    'Necklace', 'Bracelet', 'Ring', 'Earrings', 'Scarf', 'Gloves',
    'Traditional', 'Cultural', 'Uniform'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FITTING_SLOT" AS ENUM (
    'None', 'HeadGarment', 'Glasses', 'Earrings',
    'UpperGarment', 'LowerGarment', 'FullGarment', 'FootGarment',
    'LeftHandAccessory', 'RightHandAccessory', 'NeckAccessory', 'WaistAccessory'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SILHOUETTE" AS ENUM (
    'Slim', 'Regular', 'Relaxed', 'Oversized', 'Boxy',
    'Cropped', 'Longline', 'WideLeg', 'Straight', 'Tapered', 'Flowy', 'Structured'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CATEGORY" AS ENUM (
    'Streetwear', 'Casual', 'Formal', 'Business', 'SmartCasual',
    'Sportswear', 'Activewear', 'Athleisure',
    'Winterwear', 'Summerwear', 'Rainwear', 'Springwear', 'Autumnwear',
    'Vintage', 'Minimalist', 'Luxury', 'AvantGarde',
    'Traditional', 'Cultural', 'Uniform'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LAYER_LEVEL" AS ENUM ('INNER', 'BASE', 'MID', 'OUTER', 'OVER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Garment ─────────────────────────────────────────────────────────────────
-- Final shape: includes silhouette (added in migration _silhouette),
-- userId (added in _add_user_outline), and FITTING_SLOT[] (renamed from FITING_SLOTS[])

CREATE TABLE IF NOT EXISTS "Garment" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "imageUrl"    TEXT NOT NULL,
    "fileId"      TEXT NOT NULL,
    "garmentType" "GARMENT_TYPES"[],
    "fittingSlot" "FITTING_SLOT"[],
    "category"    "CATEGORY"[],
    "gender"      "GARMENT_GENDER"  NOT NULL DEFAULT 'UNISEX',
    "layerLevel"  "LAYER_LEVEL"     NOT NULL DEFAULT 'BASE',
    "silhouette"  "SILHOUETTE"      NOT NULL DEFAULT 'Regular',
    "metaData"    JSONB,
    "userId"      TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Garment_pkey" PRIMARY KEY ("id")
);

-- ─── Tag ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Tag" (
    "id"   TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- ─── Interaction ─────────────────────────────────────────────────────────────
-- Re-created in _add_interaction_model after being dropped in _outfit_and_useroutfit

CREATE TABLE IF NOT EXISTS "Interaction" (
    "id"        TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    "outfitId"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- ─── GarmentInOutfit ─────────────────────────────────────────────────────────
-- Final shape: no `order`, no `userOutfitId`; has `slot` and `layerLevel`

CREATE TABLE IF NOT EXISTS "GarmentInOutfit" (
    "id"         TEXT NOT NULL,
    "garmentId"  TEXT NOT NULL,
    "outfitId"   TEXT,
    "slot"       "FITTING_SLOT",
    "layerLevel" "LAYER_LEVEL",
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GarmentInOutfit_pkey" PRIMARY KEY ("id")
);

-- ─── _GarmentToTag (Prisma implicit m2m) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "_GarmentToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_GarmentToTag_AB_pkey" PRIMARY KEY ("A", "B")
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "Garment_fileId_key"   ON "Garment"("fileId");
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_name_key"         ON "Tag"("name");
CREATE        INDEX IF NOT EXISTS "_GarmentToTag_B_index" ON "_GarmentToTag"("B");

-- ─── Foreign keys (skip if already present) ──────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "Garment" ADD CONSTRAINT "Garment_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Garment" ADD CONSTRAINT "Garment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_garmentId_fkey"
    FOREIGN KEY ("garmentId") REFERENCES "Garment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_outfitId_fkey"
    FOREIGN KEY ("outfitId") REFERENCES "Outfit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GarmentInOutfit" ADD CONSTRAINT "GarmentInOutfit_garmentId_fkey"
    FOREIGN KEY ("garmentId") REFERENCES "Garment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GarmentInOutfit" ADD CONSTRAINT "GarmentInOutfit_outfitId_fkey"
    FOREIGN KEY ("outfitId") REFERENCES "Outfit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "_GarmentToTag" ADD CONSTRAINT "_GarmentToTag_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Garment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "_GarmentToTag" ADD CONSTRAINT "_GarmentToTag_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

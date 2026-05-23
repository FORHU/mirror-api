# AI Fashion Fit & Virtual Styling Platform: Architecture Design

## 1. Overview
This architecture is designed for an AI-first fashion assistant that prioritizes context (weather, occasion, mood) and virtual fitting over traditional e-commerce CRUD operations. It utilizes a combination of structured relational data and vector-based AI embeddings to provide high-fidelity recommendations.

## 2. Core Architectural Pillars

### A. AI Context Engine
The system moves beyond simple prompts by extracting structured "Outlines" from natural language.
- **Model**: `UserOutline`
- **Key Fields**: `extractedOccasion`, `formalityLevel` (1-10), `styleIntent` (e.g., "Minimalist", "Bold").
- **Logic**: A dedicated AI Service parses "Rooftop dinner on Friday at 7pm" into a datetime, location (Rooftop), occasion (Dinner), and formality (Semi-formal).

### B. Weather Intelligence
Styling is temperature-aware and condition-aware.
- **Model**: `WeatherProfile`
- **Logic**: Garments are tagged with temperature ranges (e.g., `minTemp: 10`, `maxTemp: 25`).
- **Condition Filtering**: Automatic exclusion of "Suede" materials during rain or "Heavy Wool" during heatwaves.

### C. Vector-First Recommendations
Similarity is determined by visual and semantic embeddings, not just text tags.
- **pgvector Integration**: Each garment stores a `vector(1536)` embedding.
- **Similarity Search**: Finds "similar silhouettes" or "complimentary colors" using cosine distance.

### D. 2.5D Rendering & Fitting
The system supports virtual layering using stacking orders and anchor points.
- **Fitting Slots**: Strict body positioning (Head, Torso, Legs).
- **Layering**: Z-index based `LAYER_LEVEL` (Inner → Base → Mid → Outer → Over).
- **Anchor Points**: JSON metadata for `x, y` offsets and `scale` relative to a standard avatar.

---

## 3. Optimized Prisma Schema

```prisma
// --- Configuration ---
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  extensions = [pgvector(map: "vector")]
}

// --- 1. User & Style Profile ---
model User {
  id              String        @id @default(cuid())
  email           String        @unique
  profile         UserProfile?
  styleProfile    StyleProfile?
  measurements    UserMeasurement?
  outlines        UserOutline[]
  outfits         Outfit[]
  createdAt       DateTime      @default(now())
}

model StyleProfile {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  preferredColors String[]
  dislikedColors  String[]
  preferredStyles CATEGORY[]
  genderIdentity  GARMENT_GENDER
}

model UserMeasurement {
  id        String @id @default(cuid())
  userId    String @unique
  user      User   @relation(fields: [userId], references: [id])
  height    Float? // in cm
  weight    Float? // in kg
  chest     Float?
  waist     Float?
  hips      Float?
  shoulders Float?
}

// --- 2. Garment System (The "Digital Twin") ---
model Garment {
  id              String           @id @default(cuid())
  name            String
  description     String?
  
  // AI Metadata & Embeddings
  embedding       Unsupported("vector(1536)")? // pgvector for similarity
  aiMetadata      Json?            // Visual attributes extracted by AI
  
  // Classification
  type            GARMENT_TYPES
  slot            FITTING_SLOT
  layer           LAYER_LEVEL
  silhouette      SILHOUETTE
  gender          GARMENT_GENDER   @default(UNISEX)
  
  // Normalized attributes for fast filtering
  categories      CATEGORY[]
  materials       Material[]       // M2M
  colors          Color[]          // M2M
  textures        Texture[]        // M2M
  
  // Weather & Compatibility
  minTemp         Float?           // Temperature awareness
  maxTemp         Float?
  weatherRules    Json?            // Condition-based rules (e.g. { "rain": "disallow" })
  
  // Rendering
  renderData      Json?            // { anchorX, anchorY, scale, boneAlignment }
  fileId          String           @unique
  file            File             @relation(fields: [fileId], references: [id])
  
  outfits         GarmentInOutfit[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([slot, layer])
}

// --- 3. Outfit & recommendation ---
model Outfit {
  id              String           @id @default(cuid())
  name            String
  description     String?
  embedding       Unsupported("vector(1536)")?
  
  isGenerated     Boolean          @default(true)
  aiScore         Float?           // Style consistency score
  
  items           GarmentInOutfit[]
  userOutlineId   String?
  userOutline     UserOutline?     @relation(fields: [userOutlineId], references: [id])
  
  userId          String?
  user            User?            @relation(fields: [userId], references: [id])
  
  createdAt       DateTime         @default(now())
}

model GarmentInOutfit {
  id              String   @id @default(cuid())
  garmentId       String
  outfitId        String
  renderOrder     Int      // Determines stacking within the same layer
  
  garment         Garment  @relation(fields: [garmentId], references: [id])
  outfit          Outfit   @relation(fields: [outfitId], references: [id])

  @@unique([outfitId, garmentId])
}

// --- 4. Context Engine ---
model UserOutline {
  id                String    @id @default(cuid())
  userId            String?
  user              User?     @relation(fields: [userId], references: [id])
  
  // Inputs
  rawPrompt         String
  location          String?
  targetTime        DateTime?
  
  // AI Extractions
  occasion          String?   // "Wedding", "Gym", "Date"
  formality         Int?      // 1-10
  mood              String?   // "Edgy", "Cozy", "Professional"
  
  // Environment
  weatherForecast   Json?     // Cached API response
  
  outfits           Outfit[]
  createdAt         DateTime  @default(now())
}

// --- Normalized Attributes ---
model Color {
  id       String    @id @default(cuid())
  name     String    @unique
  hex      String
  garments Garment[]
}

model Material {
  id       String    @id @default(cuid())
  name     String    @unique
  garments Garment[]
}

model Texture {
  id       String    @id @default(cuid())
  name     String    @unique
  garments Garment[]
}

model File {
  id        String   @id @default(cuid())
  url       String
  provider  String   @default("S3")
  garment   Garment?
}
```

## 4. Scalability & AI Strategy
- **Query Optimization**: Composite indexes on `(slot, layer)` allow the renderer to fetch garments in correct drawing order instantly.
- **Cold Storage**: Old `UserOutlines` and associated `weatherForecast` JSON can be archived to lower-cost storage after 30 days.
- **Machine Learning**: The `aiMetadata` and `embedding` fields allow the platform to plug into any Vision Transformer or LLM pipeline without schema changes.
- **Compatibility Scoring**: A background job can pre-calculate `CompatibilityScore` pairs using the `embedding` fields to power the "Complete the Look" feature.

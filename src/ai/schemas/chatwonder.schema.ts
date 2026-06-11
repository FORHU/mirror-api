import { z } from "zod";

export const CognitiveResponseSchema = z.object({
  reply: z.string(),
  intent: z.object({
    primary: z.string(),
    secondary: z.string().nullable(),
    confidence: z.number(),
  }),
  emotion: z.enum(["neutral", "excited", "urgent", "curious", "relaxed", "frustrated"]),
  action: z.any().nullable(),
  followUpQuestion: z.string().nullable(),
  requiresConfirmation: z.boolean().catch(false),
  suggestions: z.array(z.string()).optional().default([]),
  memoryUpdates: z.record(z.string(), z.any()).optional().default({}),
  uiHints: z.object({
    overlay: z.string().nullable(),
    focus: z.string().nullable(),
  }),
  events: z.array(z.any()).optional().default([]),
  raw: z.string().optional().default(""),
});

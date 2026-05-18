import openai from "./ai-request.util";

export async function getTextEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.replace(/\n/g, " "),
    });

    return response.data[0].embedding;
  } catch (error: any) {
    console.error("[OpenAI-Embedding] Error:", error.message);
    throw error;
  }
}

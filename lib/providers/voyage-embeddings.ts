import type { EmbeddingProvider, InputType } from './embeddings';

const MAX_BATCH = 128;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.VOYAGE_API_KEY ?? '';
    if (!this.apiKey) throw new Error('Missing VOYAGE_API_KEY');
    this.model = process.env.EMBEDDING_MODEL ?? 'voyage-4-lite';
    this.baseUrl = process.env.EMBEDDING_BASE_URL ?? 'https://api.voyageai.com/v1';
  }

  dimensions(): number {
    return 1024;
  }

  async embed(texts: string[], inputType: InputType = 'document'): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const embeddings = await this.embedBatch(batch, inputType);
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  private async embedBatch(
    texts: string[],
    inputType: InputType,
  ): Promise<number[][]> {
    let delay = BASE_DELAY_MS;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
          input_type: inputType,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 429) {
        if (attempt === MAX_RETRIES) {
          throw new Error(`Voyage AI rate limited after ${MAX_RETRIES} retries`);
        }
        console.warn(`Voyage AI 429, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2; // exponential backoff
        continue;
      }

      if (!res.ok) {
        throw new Error(`Voyage AI error ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      // Sort by index to preserve order
      const sorted = (data.data as { index: number; embedding: number[] }[])
        .sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    }

    throw new Error('Unreachable');
  }
}

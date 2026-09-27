export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions(): number;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  private readonly dims = 1024;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => {
      const vec = Array.from({ length: this.dims }, () => Math.random() * 2 - 1);
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      return vec.map((v) => v / norm);
    });
  }

  dimensions(): number {
    return this.dims;
  }
}

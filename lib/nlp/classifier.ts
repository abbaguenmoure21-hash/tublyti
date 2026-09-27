export type FrustrationLabel =
  | 'no_one_explains'
  | 'wish_video_on'
  | 'stopped_too_early'
  | 'searched_long'
  | 'none';

export interface ClassificationResult {
  commentId: string;
  label: FrustrationLabel;
  requestedAngle: string | null;
  confidence: number;
}

export interface LLMClassifier {
  classifyBatch(
    comments: { id: string; text: string }[],
  ): Promise<ClassificationResult[]>;
}

export class FakeLLMClassifier implements LLMClassifier {
  async classifyBatch(
    comments: { id: string; text: string }[],
  ): Promise<ClassificationResult[]> {
    const labels: FrustrationLabel[] = [
      'no_one_explains',
      'wish_video_on',
      'stopped_too_early',
      'searched_long',
      'none',
    ];

    return comments.map((c) => ({
      commentId: c.id,
      label: labels[Math.floor(Math.random() * labels.length)],
      requestedAngle: c.text.length > 20 ? 'deeper explanation' : null,
      confidence: 0.7 + Math.random() * 0.3,
    }));
  }
}

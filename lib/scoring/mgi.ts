export interface MGIInputs {
  demand: number;
  frustration: number;
  supplyQualified: number;
  monetization: number;
}

export function computeMGI(inputs: MGIInputs): number {
  const { demand, frustration, supplyQualified, monetization } = inputs;
  return (demand * (1 + frustration)) / (1 + supplyQualified) * monetization;
}

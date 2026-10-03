/**
 * Sensitive topic detection.
 *
 * Topics matching these patterns are excluded from tops and digest,
 * but remain visible in the full list with a "sensible" badge.
 * Rationale: non-monetizable or brand-risky subjects.
 */

const SENSITIVE_PATTERNS: RegExp[] = [
  // Self-harm & mental health crises
  /\bsuicid/i,
  /\bself[- ]?harm/i,
  /\bautomutilab/i,

  // Eating disorders
  /\banorexi/i,
  /\bbulimi/i,
  /\beating\s+disorder/i,
  /\btrouble[s]?\s+alimentaire/i,

  // Medical diagnosis / prescriptions
  /\bdiagnos(?:is|tic)\b/i,
  /\bprescription\s+drug/i,
  /\bmedical\s+diagnos/i,

  // Drugs & substance abuse
  /\bdrug\s+(?:abuse|addict|overdose)/i,
  /\bsubstance\s+abuse/i,
  /\bopioid\s+crisis/i,

  // Graphic violence / terrorism
  /\bterroris[mt]/i,
  /\bmass\s+shoot/i,
  /\bgenocid/i,

  // Child safety
  /\bchild\s+(?:abuse|exploit)/i,
  /\bpedophil/i,
];

/**
 * Returns true if the topic label matches a sensitive pattern.
 */
export function isSensitiveTopic(label: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(label));
}

/**
 * Filter out sensitive topics from a list.
 * Returns { safe, sensitive } partition.
 */
export function partitionSensitive<T extends { label: string }>(
  topics: T[],
): { safe: T[]; sensitive: T[] } {
  const safe: T[] = [];
  const sensitive: T[] = [];
  for (const t of topics) {
    if (isSensitiveTopic(t.label)) {
      sensitive.push(t);
    } else {
      safe.push(t);
    }
  }
  return { safe, sensitive };
}

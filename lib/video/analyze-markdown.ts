import type { StoredAnalysis } from './analyze';

/** Texte lisible (copier-coller, MCP, export). */
export function analysisToMarkdown(row: StoredAnalysis): string {
  const a = row.analysis;
  if (!a) return '';
  const t = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');
  return [
    `# ${row.title ?? row.videoId}`,
    row.channelTitle ? `${row.channelTitle} · https://www.youtube.com/watch?v=${row.videoId}` : `https://www.youtube.com/watch?v=${row.videoId}`,
    '',
    a.summary,
    '',
    `## Accroche (${t(a.hook.start_s)}–${t(a.hook.end_s)})`,
    `- Dit : ${a.hook.said}`,
    `- Montré : ${a.hook.shown}`,
    `- Promesse : ${a.hook.promise}`,
    `- Technique : ${a.hook.technique}`,
    '',
    '## Forme',
    `- Style : ${a.format.style}`,
    `- Visuels : ${a.format.visuals.join(', ')}`,
    `- Voix : ${a.format.voice} — ${a.format.voice_tone}`,
    `- Musique : ${a.format.music}`,
    `- Texte à l’écran : ${a.format.on_screen_text}`,
    `- Rythme : ${a.format.pacing}${a.format.cuts_per_minute ? ` (~${a.format.cuts_per_minute} coupes/min)` : ''}`,
    '',
    '## Structure',
    a.chapters.map((c) => `- ${t(c.start_s)} ${c.title} — ${c.summary}`).join('\n'),
    '',
    '## Relances d’attention',
    a.retention_devices.map((d) => `- ${t(d.at_s)} ${d.technique} — ${d.description}`).join('\n'),
    ...(a.retention_notes.length
      ? ['', '## Aux décrochages', a.retention_notes.map((n) => `- ${t(n.at_s)} (${n.drop}) ${n.what_happens} → ${n.fix}`).join('\n')]
      : []),
    '',
    '## Pourquoi ça marche',
    list(a.why_it_works),
    '',
    '## Points faibles',
    list(a.weaknesses),
    '',
    '## À reprendre pour ta chaîne',
    list(a.how_to_adapt),
  ].join('\n');
}

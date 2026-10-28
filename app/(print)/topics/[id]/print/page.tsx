import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchDossierData } from '@/lib/dossier/generate';
import { getMgiBand } from '@/lib/scoring/mgi';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { COMMENT_LABELS, FRUSTRATION_LABEL, RELIABILITY_SHORT, formatLongDate, formatSupply } from '@/lib/lexique';
import { PrintButton } from './print-button';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = createServiceClient();
  const { data } = await db.from('topics').select('label').eq('id', id).single();
  return { title: data?.label ? `Impression - ${data.label}` : 'Impression' };
}

const PHASE_LABELS: Record<number, string> = {
  0: 'À surveiller',
  1: 'Ça monte',
  2: 'C’est le moment',
  3: 'Trop tard',
};

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return String(n);
}

export default async function PrintDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== 'admin') {
    // Un client n'exporte que les sujets de ses thématiques.
    const db = createServiceClient();
    const [{ niches: mine }, { data: t }] = await Promise.all([
      resolveScope(db, user.id),
      db.from('topics').select('niche_id').eq('id', id).maybeSingle(),
    ]);
    if (!t || !mine.some((n) => n.id === (t.niche_id as string))) notFound();
  }
  const data = await fetchDossierData(id);
  if (!data) notFound();

  const { topic, niche, score, frustrations, competitors, titlePatterns, angles, sparkline } = data;
  const phase = score?.phase ?? topic.phase;
  const band = score ? getMgiBand(score.mgi) : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
          @page { margin: 20mm 16mm; size: A4; }
          .dossier * { box-sizing: border-box; margin: 0; padding: 0; }
          .dossier {
            max-width: 210mm; margin: 0 auto; padding: 24px 16px 48px;
            font-family: var(--font-geist-sans), system-ui, -apple-system, sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: var(--foreground);
          }
          .dossier h1 { font-size: 20pt; font-weight: 600; margin-bottom: 4pt; letter-spacing: -0.02em; }
          .dossier h2 { font-size: 13pt; font-weight: 600; margin: 16pt 0 8pt; border-bottom: 1px solid var(--border); padding-bottom: 4pt; }
          .dossier h3 { font-size: 11pt; font-weight: 600; margin: 10pt 0 4pt; }
          .dossier .meta { font-size: 10pt; color: var(--muted-foreground); margin-bottom: 12pt; }
          .dossier table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 6pt 0; }
          .dossier th, .dossier td { padding: 4pt 8pt; text-align: left; border-bottom: 1px solid var(--border); }
          .dossier th { font-weight: 600; background: var(--muted); }
          .dossier .badge { display: inline-block; font-size: 9pt; font-weight: 500; padding: 1pt 6pt; border-radius: 4px; }
          .dossier .frustration-item { margin-bottom: 8pt; }
          .dossier .frustration-item .quote { font-style: italic; }
          .dossier .frustration-item .meta-line { font-size: 9pt; color: var(--muted-foreground); margin-top: 2pt; }
          .dossier .angle-card { margin-bottom: 10pt; padding: 8pt; background: var(--muted); border: 1px solid var(--border); border-radius: 6px; }
          .dossier .angle-card .title { font-weight: 600; font-size: 11pt; }
          .dossier .angle-card .hook { font-style: italic; margin: 2pt 0; }
          .dossier .angle-card .rationale { font-size: 9.5pt; color: var(--muted-foreground); }
          .dossier .sparkline { font-family: monospace; letter-spacing: 1px; font-size: 14pt; }
          .dossier .pattern-item { margin-bottom: 6pt; }
          .dossier .pattern-item .examples { font-size: 9.5pt; color: var(--muted-foreground); font-style: italic; }
          .dossier .footer { margin-top: 20pt; padding-top: 8pt; border-top: 1px solid var(--border); font-size: 9pt; color: var(--muted-foreground); text-align: center; }
          @media print {
            .no-print { display: none !important; }
            .dossier { padding: 0; max-width: none; }
          }
`}} />
      <PrintButton />
      <article className="dossier">
        <h1>{topic.label}</h1>
        <p className="meta">
          Thématique : {niche?.name ?? '—'} · Moment : {phase !== null ? PHASE_LABELS[phase] ?? '—' : '—'}
          <br />
          Généré le {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>

        {score && (
          <>
            <h2>Les chiffres</h2>
            <table>
              <tbody>
                <tr><th>Potentiel</th><td><strong>{Math.round(score.mgi)} / 100</strong>{band ? ` (${band.label})` : ''}</td></tr>
                <tr><th>Demande du public</th><td>{Math.round(score.demand * 100)} / 100</td></tr>
                <tr><th>{FRUSTRATION_LABEL}</th><td>{Math.round(score.frustration * 100)} %</td></tr>
                <tr><th>Vidéos de qualité existantes</th><td>{formatSupply(score.supplyQ)} par rapport à la moyenne</td></tr>
                <tr><th>Revenus publicitaires</th><td>×{new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(score.monetization)} par rapport à une thématique moyenne</td></tr>
                {score.confidence && (
                  <tr><th>Fiabilité</th><td>{RELIABILITY_SHORT[score.confidence as 'high' | 'medium' | 'low'] ?? 'Faible'}{score.confidenceReason ? ` — ${score.confidenceReason}` : ''}</td></tr>
                )}
                <tr><th>Mis à jour</th><td>{formatLongDate(score.scoredAt)}</td></tr>
              </tbody>
            </table>
          </>
        )}

        {score?.feasibilityGrade && (
          <>
            <h2>Faisabilité</h2>
            <p><strong>Note : {score.feasibilityGrade}</strong> — {score.feasibilityReason ?? 'Aucune explication.'}</p>
          </>
        )}

        {sparkline.length > 0 && (() => {
          const max = Math.max(...sparkline);
          const normalized = sparkline.map((v) => Math.round((v / (max || 1)) * 8));
          const bars = normalized.map((v) => '▁▂▃▄▅▆▇█'[v] ?? '▁');
          return (
            <>
              <h2>Courbe de tendance (30 j)</h2>
              <p className="sparkline">{bars.join('')}</p>
              <p className="meta">min {Math.round(Math.min(...sparkline))} → max {Math.round(max)}</p>
            </>
          );
        })()}

        {frustrations.length > 0 && (
          <>
            <h2>Ce que réclame le public ({frustrations.length})</h2>
            {frustrations.map((f, i) => (
              <div key={i} className="frustration-item">
                <p><strong>{i + 1}.</strong> [{f.likeCount} j’aime] <span className="quote">« {f.text.slice(0, 200)} »</span></p>
                <p className="meta-line">
                  Type : {COMMENT_LABELS[f.label] ?? f.label}
                  {f.requestedAngle && ` · Angle demandé : ${f.requestedAngle}`}
                </p>
              </div>
            ))}
          </>
        )}

        {competitors.length > 0 && (
          <>
            <h2>Vidéos déjà publiées sur ce sujet ({competitors.length})</h2>
            <table>
              <thead>
                <tr><th>#</th><th>Titre</th><th>Chaîne</th><th>Vues</th><th>Abonnés</th><th>Publiée</th></tr>
              </thead>
              <tbody>
                {competitors.map((c, i) => (
                  <tr key={c.id}>
                    <td>{i + 1}</td>
                    <td>{c.title}</td>
                    <td>{c.channelTitle}</td>
                    <td>{formatViews(c.views)}</td>
                    <td>{c.subscriberCount ? formatViews(c.subscriberCount) : '—'}</td>
                    <td>{new Date(c.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {niche && (
          <>
            <h2>Revenus publicitaires</h2>
            <p>
              {niche.rpmLow && niche.rpmHigh
                ? <><strong>{niche.rpmLow} – {niche.rpmHigh} $</strong> par 1 000 vues (estimation de la thématique)</>
                : <>×{niche.rpmCoefficient} par rapport à une thématique moyenne</>}
            </p>
          </>
        )}

        {titlePatterns.length > 0 && (
          <>
            <h2>Formules de titres ({titlePatterns.length})</h2>
            {titlePatterns.map((p, i) => (
              <div key={i} className="pattern-item">
                <h3>{p.formula} ({p.frequency} occurrences)</h3>
                <p>{p.description}</p>
                {p.emotionalTriggers.length > 0 && <p className="meta">Déclencheurs : {p.emotionalTriggers.join(', ')}</p>}
                {p.examples.length > 0 && <p className="examples">Exemples : {p.examples.slice(0, 3).join(' · ')}</p>}
              </div>
            ))}
          </>
        )}

        {angles.length > 0 && (
          <>
            <h2>Angles proposés ({angles.length})</h2>
            {angles.map((a, i) => (
              <div key={i} className="angle-card">
                <p className="title">{i + 1}. {a.title}</p>
                <p className="hook">{a.hook}</p>
                <p className="rationale">{a.rationale}</p>
                {a.formula && <p className="rationale">Formule : {a.formula}</p>}
                {a.frustrationResolved && <p className="rationale">Question à laquelle il répond : {a.frustrationResolved}</p>}
              </div>
            ))}
          </>
        )}

        <div className="footer">
          Dossier généré par TubLyTI — {formatLongDate(new Date().toISOString())}
        </div>
      </article>
    </>
  );
}

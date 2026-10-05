import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchDossierData } from '@/lib/dossier/generate';
import { getMgiBand } from '@/lib/scoring/mgi';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';

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

const LABEL_NAMES: Record<string, string> = {
  no_one_explains: "Personne n'explique",
  wish_video_on: 'Souhait de vidéo',
  stopped_too_early: "S'arrête trop tôt",
  searched_long: 'Longue recherche',
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
    <html lang="fr">
      <head>
        <title>Dossier — {topic.label}</title>
        <style dangerouslySetInnerHTML={{ __html: `
          @page { margin: 20mm 16mm; size: A4; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Geist Sans', system-ui, -apple-system, sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #141822;
            max-width: 100%;
            padding: 0;
          }
          h1 { font-size: 20pt; font-weight: 600; margin-bottom: 4pt; letter-spacing: -0.02em; }
          h2 { font-size: 13pt; font-weight: 600; margin: 16pt 0 8pt; border-bottom: 1px solid #e1e3e7; padding-bottom: 4pt; }
          h3 { font-size: 11pt; font-weight: 600; margin: 10pt 0 4pt; }
          .meta { font-size: 10pt; color: #5e636e; margin-bottom: 12pt; }
          table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 6pt 0; }
          th, td { padding: 4pt 8pt; text-align: left; border-bottom: 1px solid #e1e3e7; }
          th { font-weight: 600; background: #f2f3f7; }
          .badge { display: inline-block; font-size: 9pt; font-weight: 500; padding: 1pt 6pt; border-radius: 4px; }
          .frustration-item { margin-bottom: 8pt; }
          .frustration-item .quote { font-style: italic; }
          .frustration-item .meta-line { font-size: 9pt; color: #5e636e; margin-top: 2pt; }
          .angle-card { margin-bottom: 10pt; padding: 8pt; background: #f9fafc; border: 1px solid #e1e3e7; border-radius: 6px; }
          .angle-card .title { font-weight: 600; font-size: 11pt; }
          .angle-card .hook { font-style: italic; margin: 2pt 0; }
          .angle-card .rationale { font-size: 9.5pt; color: #5e636e; }
          .sparkline { font-family: monospace; letter-spacing: 1px; font-size: 14pt; }
          .pattern-item { margin-bottom: 6pt; }
          .pattern-item .examples { font-size: 9.5pt; color: #5e636e; font-style: italic; }
          .footer { margin-top: 20pt; padding-top: 8pt; border-top: 1px solid #e1e3e7; font-size: 9pt; color: #5e636e; text-align: center; }
          @media print {
            .no-print { display: none !important; }
          }
          .print-btn {
            position: fixed; top: 16px; right: 16px; z-index: 100;
            padding: 8px 16px; background: #524fdd; color: white; border: none;
            border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;
          }
          .print-btn:hover { opacity: 0.9; }
        `}} />
      </head>
      <body>
        <button className="print-btn no-print" id="print-btn">
          Imprimer / PDF
        </button>
        <script dangerouslySetInnerHTML={{ __html: `document.getElementById('print-btn').addEventListener('click', function() { window.print(); });` }} />

        <h1>{topic.label}</h1>
        <p className="meta">
          Niche : {niche?.name ?? '—'} · Phase : {phase !== null ? PHASE_LABELS[phase] ?? `Phase ${phase}` : 'Inconnue'} · Statut : {topic.status}
          <br />
          Généré le {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>

        {score && (
          <>
            <h2>Market Gap Index</h2>
            <table>
              <tbody>
                <tr><th>Potentiel</th><td><strong>{Math.round(score.mgi)}</strong> {band && <span className="badge" style={{ backgroundColor: band.color + '33' }}>({band.label})</span>}</td></tr>
                <tr><th>Demande (D)</th><td>{Math.round(score.demand)}</td></tr>
                <tr><th>Frustration (F)</th><td>{Math.round(score.frustration * 100)} %</td></tr>
                <tr><th>Vidéos de qualité existantes</th><td>{Math.round(score.supplyQ)}</td></tr>
                <tr><th>Monétisation (P)</th><td>× {score.monetization.toFixed(1)}</td></tr>
                {score.confidence && (
                  <tr><th>Confiance</th><td>{score.confidence === 'high' ? 'Élevée' : score.confidence === 'medium' ? 'Moyenne' : 'Faible'} — {score.confidenceReason ?? ''}</td></tr>
                )}
                <tr><th>Fraîcheur</th><td>Scores du {score.scoredAt}</td></tr>
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
            <h2>Frustrations ({frustrations.length})</h2>
            {frustrations.map((f, i) => (
              <div key={i} className="frustration-item">
                <p><strong>{i + 1}.</strong> [{f.likeCount} likes] <span className="quote">« {f.text.slice(0, 200)} »</span></p>
                <p className="meta-line">
                  Type : {LABEL_NAMES[f.label] ?? f.label}
                  {f.requestedAngle && ` · Angle demandé : ${f.requestedAngle}`}
                </p>
              </div>
            ))}
          </>
        )}

        {competitors.length > 0 && (
          <>
            <h2>Concurrents qualifiés ({competitors.length})</h2>
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
            <h2>Monétisation (RPM)</h2>
            <p>
              {niche.rpmLow && niche.rpmHigh
                ? <><strong>{niche.rpmLow} – {niche.rpmHigh} $</strong> par 1 000 vues ({niche.rpmSource ?? `coefficient × ${niche.rpmCoefficient}`})</>
                : <>Coefficient niche : × {niche.rpmCoefficient}</>}
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
            <h2>Angles de contenu ({angles.length})</h2>
            {angles.map((a, i) => (
              <div key={i} className="angle-card">
                <p className="title">{i + 1}. {a.title}</p>
                <p className="hook">{a.hook}</p>
                <p className="rationale">{a.rationale}</p>
                {a.formula && <p className="rationale">Formule : {a.formula}</p>}
                {a.frustrationResolved && <p className="rationale">Frustration résolue : {a.frustrationResolved}</p>}
              </div>
            ))}
          </>
        )}

        <div className="footer">
          Dossier généré par TubLyTI — {new Date().toISOString().slice(0, 10)}
        </div>
      </body>
    </html>
  );
}

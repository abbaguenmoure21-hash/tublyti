import { createServiceClient } from '@/lib/supabase/server';
import { KanbanBoard } from './_components/kanban-board';

export const metadata = { title: 'Pipeline' };

export interface PipelineCard {
  angleId: string;
  angleTitle: string;
  angleHook: string;
  topicId: string;
  topicLabel: string;
  nicheId: string;
  nicheName: string;
  channelName: string;
  phase: number;
  mgi: number | null;
  status: 'idea' | 'in_production' | 'published';
  videoId: string | null;
  createdAt: string;
  publishedDaysAgo: number | null;
  performanceVsMedian: number | null;
}

export type PipelineColumn = 'idea' | 'in_production' | 'published' | 'measured';

function classifyColumn(card: {
  status: string;
  videoId: string | null;
  publishedDaysAgo: number | null;
  performanceVsMedian: number | null;
}): PipelineColumn {
  if (card.status === 'idea') return 'idea';
  if (card.status === 'in_production') return 'in_production';
  if (card.status === 'published') {
    // Measured = published 30+ days ago
    if (card.publishedDaysAgo !== null && card.publishedDaysAgo >= 30) {
      return 'measured';
    }
    return 'published';
  }
  return 'idea';
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ niche?: string }>;
}) {
  const { niche: nicheFilter } = await searchParams;
  const db = createServiceClient();

  // Fetch all angles with their topics and niches
  const query = db
    .from('angles')
    .select(`
      id, title, hook, status, video_id, created_at,
      topics!inner(id, label, phase, status, niche_id,
        niches(id, name, owner_channel))
    `)
    .in('status', ['idea', 'in_production', 'published'])
    .order('created_at', { ascending: false });

  const { data: angles } = await query;

  // Get latest scores for all topics that have angles
  const topicIds = [...new Set((angles ?? []).map((a: Record<string, unknown>) => {
    const topic = a.topics as unknown as { id: string };
    return topic.id;
  }))];

  let scoreMap: Record<string, number> = {};
  if (topicIds.length > 0) {
    const { data: scores } = await db
      .from('topic_scores')
      .select('topic_id, mgi')
      .in('topic_id', topicIds)
      .order('scored_at', { ascending: false });

    const seen = new Set<string>();
    for (const s of scores ?? []) {
      if (!seen.has(s.topic_id)) {
        seen.add(s.topic_id);
        scoreMap[s.topic_id] = Number(s.mgi);
      }
    }
  }

  // For published angles, check how many days since publication
  // and get video performance vs channel median
  const publishedAngleIds = (angles ?? [])
    .filter((a: Record<string, unknown>) => a.status === 'published' && a.video_id)
    .map((a: Record<string, unknown>) => a.video_id as string);

  let videoPublishDates: Record<string, string> = {};
  let videoPerformance: Record<string, number | null> = {};

  if (publishedAngleIds.length > 0) {
    // Get video publish dates
    const { data: videos } = await db
      .from('videos')
      .select('id, published_at, channel_id')
      .in('id', publishedAngleIds);

    for (const v of videos ?? []) {
      if (v.published_at) videoPublishDates[v.id] = v.published_at;
    }

    // Get latest view snapshots for these videos
    const { data: snapshots } = await db
      .from('video_snapshots')
      .select('video_id, views')
      .in('video_id', publishedAngleIds)
      .order('captured_at', { ascending: false });

    const latestViews: Record<string, number> = {};
    const seenVids = new Set<string>();
    for (const s of snapshots ?? []) {
      if (!seenVids.has(s.video_id)) {
        seenVids.add(s.video_id);
        latestViews[s.video_id] = s.views ?? 0;
      }
    }

    // Get channel medians (last 20 videos per channel)
    const channelIds = [...new Set((videos ?? []).map((v: Record<string, unknown>) => v.channel_id as string).filter(Boolean))];

    for (const chId of channelIds) {
      const { data: channelVideos } = await db
        .from('videos')
        .select('id')
        .eq('channel_id', chId)
        .order('published_at', { ascending: false })
        .limit(20);

      const chVidIds = (channelVideos ?? []).map((v: Record<string, unknown>) => v.id as string);
      if (chVidIds.length === 0) continue;

      const { data: chSnaps } = await db
        .from('video_snapshots')
        .select('video_id, views')
        .in('video_id', chVidIds)
        .order('captured_at', { ascending: false });

      const chViews: number[] = [];
      const seenCh = new Set<string>();
      for (const s of chSnaps ?? []) {
        if (!seenCh.has(s.video_id)) {
          seenCh.add(s.video_id);
          chViews.push(s.views ?? 0);
        }
      }

      if (chViews.length === 0) continue;
      chViews.sort((a, b) => a - b);
      const median = chViews[Math.floor(chViews.length / 2)];

      // Calculate performance vs median for each published video in this channel
      for (const v of videos ?? []) {
        if (v.channel_id === chId && latestViews[v.id] !== undefined && median > 0) {
          videoPerformance[v.id] = Math.round(
            ((latestViews[v.id] - median) / median) * 100,
          );
        }
      }
    }
  }

  // Fetch all niches for the filter
  const { data: niches } = await db
    .from('niches')
    .select('id, name, owner_channel')
    .eq('status', 'active')
    .order('name');

  // Build cards
  const cards: PipelineCard[] = (angles ?? []).map((a: Record<string, unknown>) => {
    const topic = a.topics as unknown as {
      id: string;
      label: string;
      phase: number;
      niche_id: string;
      niches: { id: string; name: string; owner_channel: string | null } | null;
    };

    const vid = a.video_id as string | null;
    let publishedDaysAgo: number | null = null;
    if (vid && videoPublishDates[vid]) {
      publishedDaysAgo = Math.floor(
        (Date.now() - new Date(videoPublishDates[vid]).getTime()) / 86_400_000,
      );
    }

    return {
      angleId: a.id as string,
      angleTitle: (a.title as string) ?? '',
      angleHook: (a.hook as string) ?? '',
      topicId: topic.id,
      topicLabel: topic.label,
      nicheId: topic.niche_id,
      nicheName: topic.niches?.name ?? '',
      channelName: topic.niches?.owner_channel ?? '',
      phase: topic.phase ?? 0,
      mgi: scoreMap[topic.id] ?? null,
      status: a.status as 'idea' | 'in_production' | 'published',
      videoId: vid,
      createdAt: a.created_at as string,
      publishedDaysAgo,
      performanceVsMedian: vid ? (videoPerformance[vid] ?? null) : null,
    };
  }).filter((c: PipelineCard) => !nicheFilter || c.nicheId === nicheFilter);

  // Group cards by column
  const columns: Record<PipelineColumn, PipelineCard[]> = {
    idea: [],
    in_production: [],
    published: [],
    measured: [],
  };

  for (const card of cards) {
    const col = classifyColumn(card);
    columns[col].push(card);
  }

  const nichesList = (niches ?? []).map((n: Record<string, unknown>) => ({
    id: n.id as string,
    name: n.name as string,
    channelName: (n.owner_channel as string) ?? '',
  }));

  return (
    <div className="flex flex-col min-h-full relative overflow-x-clip">
      {/* Background gradients multi-niveaux */}
      <div className="absolute inset-0 pointer-events-none -z-10">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/15 dark:bg-blue-600/15 blur-[100px]" />
        <div className="absolute top-[20%] -right-[10%] w-[40%] h-[60%] rounded-full bg-purple-400/15 dark:bg-purple-600/15 blur-[120px]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] rounded-full bg-cyan-400/15 dark:bg-cyan-600/15 blur-[100px]" />
      </div>

      <KanbanBoard
        columns={columns}
        niches={nichesList}
        activeNiche={nicheFilter ?? null}
      />
    </div>
  );
}

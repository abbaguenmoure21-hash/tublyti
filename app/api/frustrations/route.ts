import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const db = createServiceClient();

  const { data, error } = await db
    .from('comment_labels')
    .select(
      `
      comment_id,
      label,
      requested_angle,
      confidence,
      model,
      labeled_at,
      comments!inner (
        id,
        text,
        like_count,
        published_at,
        video_id,
        videos!inner (
          id,
          title,
          channel_id,
          channels!inner (
            title,
            niche_id,
            niches!inner ( name )
          )
        )
      )
    `,
    )
    .neq('label', 'none')
    .order('labeled_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Flatten the nested structure for the frontend
  interface FlatItem {
    commentId: string;
    label: string;
    requestedAngle: string | null;
    confidence: number;
    model: string;
    labeledAt: string;
    commentText: string;
    likeCount: number;
    publishedAt: string;
    videoId: string;
    videoTitle: string;
    channelTitle: string;
    nicheName: string;
  }

  const items: FlatItem[] = (data ?? []).map((row: Record<string, unknown>) => {
    const comment = row.comments as Record<string, unknown>;
    const video = comment.videos as Record<string, unknown>;
    const channel = video.channels as Record<string, unknown>;
    const niche = channel.niches as Record<string, unknown>;

    return {
      commentId: row.comment_id as string,
      label: row.label as string,
      requestedAngle: (row.requested_angle as string) ?? null,
      confidence: row.confidence as number,
      model: row.model as string,
      labeledAt: row.labeled_at as string,
      commentText: comment.text as string,
      likeCount: (comment.like_count as number) ?? 0,
      publishedAt: comment.published_at as string,
      videoId: video.id as string,
      videoTitle: video.title as string,
      channelTitle: channel.title as string,
      nicheName: niche.name as string,
    };
  });

  // Sort by likes descending
  items.sort((a, b) => b.likeCount - a.likeCount);

  return NextResponse.json(items);
}

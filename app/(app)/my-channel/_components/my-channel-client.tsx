'use client';

import { useMemo } from 'react';
import { Users, Video, Eye, PlaySquare } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts';

interface Channel {
  id: string;
  title: string;
  subscriber_count: number | null;
}

interface VideoData {
  id: string;
  title: string;
  published_at: string | null;
  duration_s: number | null;
}

interface SnapshotData {
  video_id: string;
  captured_at: string;
  views: number;
  likes: number;
  comments: number;
}

export function MyChannelClient({
  channel,
  videos,
  snapshots,
}: {
  channel: Channel;
  videos: VideoData[];
  snapshots: SnapshotData[];
}) {
  const chartData = useMemo(() => {
    const dailyVideoViews: Record<string, Record<string, number>> = {};

    snapshots.forEach((s) => {
      const date = new Date(s.captured_at).toISOString().split('T')[0];
      if (!dailyVideoViews[date]) dailyVideoViews[date] = {};
      
      // Keep max views for the video on this day
      if (!dailyVideoViews[date][s.video_id] || dailyVideoViews[date][s.video_id] < s.views) {
        dailyVideoViews[date][s.video_id] = s.views;
      }
    });

    return Object.keys(dailyVideoViews)
      .sort()
      .map((date) => {
        const videosOnDay = dailyVideoViews[date];
        const totalViews = Object.values(videosOnDay).reduce((sum, v) => sum + v, 0);
        
        // Formatting date for display (e.g., "24 Sep")
        const dateObj = new Date(date);
        const displayDate = dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

        return {
          date: displayDate,
          fullDate: date,
          views: totalViews,
        };
      });
  }, [snapshots]);

  // Aggregate current stats
  const totalViews = chartData.length > 0 ? chartData[chartData.length - 1].views : 0;
  
  // Recent videos for the list
  const recentVideos = videos.slice(0, 10).map(v => {
    // Get latest snapshot for this video
    const videoSnaps = snapshots.filter(s => s.video_id === v.id).sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
    const latest = videoSnaps[0];
    return {
      ...v,
      views: latest?.views || 0,
      likes: latest?.likes || 0,
    };
  });

  return (
    <div className="flex-1 p-6 md:p-8 max-w-[1200px] mx-auto w-full space-y-8 fade-in">
      {/* Header section */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white text-2xl font-bold shadow-[0_4px_16px_rgba(10,132,255,0.4)]">
            {channel.title.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-[24px] font-bold text-foreground tracking-tight">{channel.title}</h2>
            <p className="text-[14px] text-muted-foreground flex items-center gap-1.5 mt-1">
              <Users className="w-4 h-4" /> 
              {channel.subscriber_count ? new Intl.NumberFormat('fr-FR').format(channel.subscriber_count) : '---'} abonnés
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-2xl border border-[--glass-border] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground mb-3 text-[13px] font-medium uppercase tracking-wider">
            <Eye className="w-4 h-4" />
            Vues Totales (vidéos suivies)
          </div>
          <div className="text-[32px] font-bold text-foreground tabular-nums tracking-tight">
            {new Intl.NumberFormat('fr-FR').format(totalViews)}
          </div>
        </div>
        
        <div className="bg-card rounded-2xl border border-[--glass-border] p-5 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground mb-3 text-[13px] font-medium uppercase tracking-wider">
            <Video className="w-4 h-4" />
            Vidéos Suivies
          </div>
          <div className="text-[32px] font-bold text-foreground tabular-nums tracking-tight">
            {videos.length}
          </div>
        </div>
      </div>

      {/* Evolution Chart */}
      <div className="bg-card rounded-2xl border border-[--glass-border] p-5 md:p-6 shadow-sm">
        <h3 className="text-[16px] font-semibold mb-6">Évolution des vues</h3>
        
        {chartData.length > 1 ? (
          <div
            className="h-[300px] w-full"
            role="img"
            aria-label={`Évolution des vues : ${chartData[0].views.toLocaleString('fr-FR')} vues le ${chartData[0].date}, ${chartData[chartData.length - 1].views.toLocaleString('fr-FR')} vues le ${chartData[chartData.length - 1].date}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0A84FF" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#0A84FF" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.15)" />
                <XAxis 
                  dataKey="date" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                  tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                  width={60}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--bg-surface-1)', 
                    borderColor: 'var(--glass-border)',
                    borderRadius: '12px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.1)'
                  }}
                  itemStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
                  formatter={(value: any) => [new Intl.NumberFormat('fr-FR').format(value), 'Vues']}
                />
                <Area 
                  type="monotone" 
                  dataKey="views" 
                  stroke="#0A84FF" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorViews)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm border border-dashed border-border rounded-xl">
            Pas assez de données pour afficher un graphique d'évolution.
          </div>
        )}
      </div>

      {/* Recent Videos */}
      <div className="bg-card rounded-2xl border border-[--glass-border] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[--glass-border]">
          <h3 className="text-[16px] font-semibold">Vidéos récentes</h3>
        </div>
        
        {recentVideos.length > 0 ? (
          <div className="divide-y divide-border">
            {recentVideos.map((video) => (
              <div key={video.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                    <PlaySquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-[14px] font-medium text-foreground line-clamp-1">{video.title}</h4>
                    <span className="text-[12px] text-muted-foreground">
                      {video.published_at ? new Date(video.published_at).toLocaleDateString('fr-FR') : 'Date inconnue'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-right">
                    <div className="text-[14px] font-semibold tabular-nums">{new Intl.NumberFormat('fr-FR').format(video.views)}</div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Vues</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-semibold tabular-nums">{new Intl.NumberFormat('fr-FR').format(video.likes)}</div>
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wider">J'aime</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground text-sm">
            Aucune vidéo suivie pour cette chaîne.
          </div>
        )}
      </div>
    </div>
  );
}

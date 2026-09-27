export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Fiche sujet</h1>
      <p className="text-muted-foreground mt-2">Sujet {id}</p>
    </div>
  );
}

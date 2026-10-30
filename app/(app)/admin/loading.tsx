import { AdminPageSkeleton } from '@/components/admin/admin-skeletons';

/** Fallback for every console page without its own loading.tsx. */
export default function AdminLoading() {
  return <AdminPageSkeleton />;
}

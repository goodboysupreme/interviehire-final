import { redirect } from 'next/navigation';

// /dashboard → redirect to the default tab (Jobs)
export default function DashboardRootPage() {
  redirect('/dashboard/jobs');
}

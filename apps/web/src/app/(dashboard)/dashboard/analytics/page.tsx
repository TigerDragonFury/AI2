import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';

export const metadata = { title: 'Analytics' };

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <AnalyticsDashboard />
    </div>
  );
}

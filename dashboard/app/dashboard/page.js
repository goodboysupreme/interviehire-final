'use client';

import { useEffect } from 'react';
import { initDashboardPage } from '../../src/dashboard/index.js';
import { html } from '../../src/html/dashboard-crystal';

export default function DashboardCrystalPage() {
  useEffect(() => {
    const cleanup = initDashboardPage();
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

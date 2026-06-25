import type { ReactNode } from 'react';
import '../../src/styles/dashboard/index.css';
import DashboardShell from './DashboardShell';

export const metadata = {
  title: 'Dashboard · intervieHire',
  description: 'intervieHire AI-powered talent acquisition dashboard.',
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}


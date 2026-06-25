import React from 'react';
import '../../src/landing/landing.css';

export const metadata = {
  title: 'intervieHire — AI Interviews, Human Results',
  description: 'AI-powered interviews 24/7 with built-in cheating detection. Screen candidates faster and more reliably — no scheduling needed.',
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

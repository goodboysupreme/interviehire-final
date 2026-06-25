'use client';
import dynamic from 'next/dynamic';

const LandingApp = dynamic(() => import('../../src/landing/LandingApp'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', fontFamily: 'Space Grotesk, sans-serif', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
        <span style={{ color: '#F5F0E8' }}>intervie</span>
        <span style={{ background: 'linear-gradient(90deg,#FF6B35,#E91E8C)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Hire</span>
      </div>
    </div>
  ),
});

export default function LandingPage() {
  return <LandingApp />;
}

'use client';

// Deploy-verification route: /dashboard/random — renders a "random" header.
export default function RandomPage() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'grid',
        placeItems: 'center',
        background: '#0a0a0a',
      }}
    >
      <h1 style={{ color: '#ffffff', fontSize: '4rem', fontFamily: 'system-ui, sans-serif' }}>
        random
      </h1>
    </div>
  );
}

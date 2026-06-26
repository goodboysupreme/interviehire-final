'use client';

export default function RandomTestPage() {
  return (
    <div style={{
      display: 'grid',
      placeItems: 'center',
      minHeight: '100vh',
      background: '#0a0a0a',
      color: '#2dd4bf',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textAlign: 'center'
    }}>
      <div>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', fontWeight: 700 }}>
          IntervieHire Test Route
        </h1>
        <p style={{ color: '#9a9a9a', fontSize: '1.1rem' }}>
          Path: <code>/dashboard/random</code>
        </p>
      </div>
    </div>
  );
}

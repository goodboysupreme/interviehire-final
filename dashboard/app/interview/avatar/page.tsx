'use client';

import { useEffect } from 'react';

export default function AvatarContainer() {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Connect / bridge external avatar messages here
      console.log('Avatar container received message from parent:', event.data);
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <main
      style={{
        backgroundColor: '#08090d',
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Empty mount container for the externally hosted avatar player */}
      <div id="avatar-mount-point" style={{ width: '100%', height: '100%' }} />
    </main>
  );
}

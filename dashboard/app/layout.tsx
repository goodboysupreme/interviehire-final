export const metadata = {
  title: 'intervieHire | AI-Screening & Expert Human Interviews',
  description: 'intervieHire is an AI-powered talent acquisition platform replacing the fragmented hiring stack with screening and vetted human expert interviews.',
};

import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}

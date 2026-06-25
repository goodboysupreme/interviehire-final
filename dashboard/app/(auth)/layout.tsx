import React from 'react';
import '../../src/styles/dashboard/01-tokens.css';
import '../../src/styles/auth.css';

export const metadata = {
  title: 'Sign in · intervieHire',
  description: 'Access the intervieHire recruiter dashboard.',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

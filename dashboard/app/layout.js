export const metadata = {
  title: 'intervieHire | AI-Screening & Expert Human Interviews',
  description: 'intervieHire is an AI-powered talent acquisition platform replacing the fragmented hiring stack with screening and vetted human expert interviews.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Motion Studio',
  description: 'A client-side, chat-first AI app with BYOK Gemini key management, rotation, encrypted local storage, and full English and Bengali support.',
  openGraph: {
    title: 'Motion Studio',
    description: 'A client-side, chat-first AI app with BYOK Gemini key management, rotation, encrypted local storage, and full English and Bengali support.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Motion Studio',
    description: 'A client-side, chat-first AI app with BYOK Gemini key management, rotation, encrypted local storage, and full English and Bengali support.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Strict Content Security Policy */}
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' https://generativelanguage.googleapis.com blob: data:; object-src 'none'; base-uri 'self';"
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

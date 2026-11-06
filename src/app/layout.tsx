import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Facilify - certificates from a spreadsheet',
  description: 'Upload one Excel or CSV sheet, make personalized certificates, save them and email each student their own.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-slate-50">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EstateFlow — AI WhatsApp CRM for Real Estate',
  description: 'Reply on WhatsApp in seconds, qualify, score and route every lead.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

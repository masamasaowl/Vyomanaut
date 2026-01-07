import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AuthProvider from './components/AuthProvider';

// We configure our font
const inter = Inter({ subsets: ['latin'] });

// The crucial metadata for SEO
export const metadata: Metadata = {
  title: 'Vyomanaut Enterprise - Distributed Cloud Storage',
  description: 'Secure, distributed file storage powered by a global network',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>

        {/* To Authorize the user at the start of the app */}
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AuthProvider from './components/AuthProvider';
import { ToastProvider } from '@/contexts/ToastContext';
import { SWRConfig } from 'swr';

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

        {/* Enable SWR and pass the possible used values */}
        <SWRConfig
          value={{
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
            shouldRetryOnError: true,
            errorRetryCount: 3,
            dedupingInterval: 5000,
          }}
        >
            {/* The Toaster is available throughout the app */}
            <ToastProvider>
              {/* To Authorize the user at the start of the app we wrap them all pages */}
              <AuthProvider>
                {children}
              </AuthProvider>
            </ToastProvider>
        </SWRConfig>
        
        
      </body>
    </html>
  );
}
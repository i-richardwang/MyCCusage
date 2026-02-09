import { Geist_Mono, Outfit } from "next/font/google"
import type { Metadata } from 'next'

import "@workspace/ui/globals.css"
import { Providers } from "@/components/providers"

const fontSans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_OWNER_NAME 
    ? `${process.env.NEXT_PUBLIC_OWNER_NAME}'s Coding Usage Dashboard`
    : 'Coding Usage Dashboard',
  description: 'Self-hosted dashboard for tracking coding agent usage, costs, and statistics with beautiful charts and insights.',
  ...(process.env.NEXT_PUBLIC_APP_URL && {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL),
    alternates: {
      canonical: '/',
    },
  }),
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fontSans.variable} ${fontMono.variable} font-sans antialiased`}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}

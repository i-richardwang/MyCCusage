import { Geist, Geist_Mono, Inter } from "next/font/google"
import type { Metadata } from 'next'

import "@workspace/ui/globals.css"
import { Providers } from "@/components/providers"

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

const fontInter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_OWNER_NAME 
    ? `${process.env.NEXT_PUBLIC_OWNER_NAME}'s Claude Code Usage Dashboard`
    : 'Claude Code Usage Dashboard',
  description: 'Self-hosted dashboard for tracking Claude Code usage, costs, and statistics with beautiful charts and insights.',
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
        className={`${fontSans.variable} ${fontMono.variable} ${fontInter.variable} font-mono antialiased theme-mono`}
      >
        <Providers>
          <div className="theme-container">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  )
}

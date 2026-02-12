"use client";

import { Card, CardContent } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Github, Heart, Zap } from "lucide-react";

// Configuration constants
const FOOTER_CONFIG = {
  project: {
    name: "Coding Usage Dashboard",
    description:
      "Open source dashboard for tracking coding agent usage, costs, and statistics with beautiful charts and insights.",
    version: "0.5.5",
    repository: "https://github.com/i-richardwang/MyCCusage",
    author: {
      name: "Richard Wang",
      github: "https://github.com/i-richardwang",
    },
  },
  currentYear: new Date().getFullYear(),
} as const;

// Reusable style classes
const styles = {
  link: "text-primary hover:underline",
  text: {
    small: "text-sm text-muted-foreground",
    heading: "font-medium flex items-center gap-2",
  },
  spacing: {
    section: "space-y-3",
    content: "space-y-1",
  },
} as const;

// External link component
const ExternalLink = ({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className={`${styles.link} ${className}`}
  >
    {children}
  </a>
);

export function Footer() {
  return (
    <footer className="border-t bg-background/50 backdrop-blur">
      <div className="container mx-auto px-4 sm:px-6 py-8">
        <Card>
          <CardContent className="px-6">
            <div className="flex flex-col lg:flex-row lg:justify-between items-start gap-8">
              {/* Project Info */}
              <div className={`${styles.spacing.section} max-w-md lg:max-w-lg`}>
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-lg">
                    {FOOTER_CONFIG.project.name}
                  </h3>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-md font-medium">
                    v{FOOTER_CONFIG.project.version}
                  </span>
                </div>
                <p className={styles.text.small}>
                  {FOOTER_CONFIG.project.description}
                </p>
              </div>

              {/* Right side sections */}
              <div className="flex flex-col sm:flex-row gap-8 lg:gap-12 flex-shrink-0">
                {/* Project Links */}
                <section className={`${styles.spacing.section} min-w-48`}>
                  <h4 className={styles.text.heading}>
                    <Zap className="h-4 w-4" />
                    Project
                  </h4>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" asChild>
                      <ExternalLink
                        href={FOOTER_CONFIG.project.repository}
                        className="flex items-center gap-2"
                      >
                        <Github className="h-4 w-4" />
                        Source Code
                      </ExternalLink>
                    </Button>
                    <div
                      className={`${styles.text.small} ${styles.spacing.content}`}
                    >
                      <div>
                        by{" "}
                        <ExternalLink
                          href={FOOTER_CONFIG.project.author.github}
                          className="font-medium"
                        >
                          {FOOTER_CONFIG.project.author.name}
                        </ExternalLink>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Open Source */}
                <section className={`${styles.spacing.section} min-w-48`}>
                  <h4 className={styles.text.heading}>
                    <Heart className="h-4 w-4" />
                    Open Source
                  </h4>
                  <div
                    className={`${styles.text.small} ${styles.spacing.content}`}
                  >
                    <div>Made with ❤️ for the community</div>
                    <div>Contributions welcome!</div>
                  </div>
                </section>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="mt-8 pt-6 border-t border-border">
              <div className={styles.text.small}>
                © {FOOTER_CONFIG.currentYear} {FOOTER_CONFIG.project.name}.
                Open source project.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </footer>
  );
}

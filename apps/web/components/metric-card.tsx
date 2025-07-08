"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"

interface MetricCardProps {
  title: string
  value: string | number
  description?: string
  className?: string
}

export function MetricCard({ title, value, description, className }: MetricCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}
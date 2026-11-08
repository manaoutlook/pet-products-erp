import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        /* Status chips: tinted background + strong text = AA contrast in both
           light and dark mode. Use for stock levels, order states, roles. */
        success:
          "border-success/30 bg-success-subtle text-success-subtle-foreground",
        warning:
          "border-warning/40 bg-warning-subtle text-warning-subtle-foreground",
        info: "border-info/30 bg-info-subtle text-info-subtle-foreground",
        destructive:
          "border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /* Primary — the single most important action on a screen (Save, Submit,
           Sign in, Apply filters). Professional blue #2563EB. */
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",

        /* CRUD action colours — use these so Create/View/Update/Delete look the
           same on every screen. */
        create:
          "bg-success-strong text-success-foreground shadow-xs hover:bg-success-strong-hover", // green
        view: "border border-primary/30 bg-primary-subtle text-primary-subtle-foreground hover:border-primary/50 hover:bg-primary/15", // blue
        update:
          "bg-warning text-warning-foreground shadow-xs hover:bg-warning-strong", // amber
        delete:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive-hover", // red

        /* Status aliases — identical styling, named after the semantic token. */
        success:
          "bg-success-strong text-success-foreground shadow-xs hover:bg-success-strong-hover",
        warning: "bg-warning text-warning-foreground shadow-xs hover:bg-warning-strong",
        info: "bg-info-strong text-info-foreground shadow-xs hover:bg-info-strong-hover",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive-hover",

        /* Neutral / structural */
        secondary:
          "bg-secondary-solid text-white shadow-xs hover:bg-secondary-solid-hover active:bg-secondary-solid-active",
        outline:
          "border border-input bg-card text-foreground shadow-xs hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-link underline-offset-4 hover:text-link-hover hover:underline",
      },
      size: {
        default: "h-control px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-control w-control",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

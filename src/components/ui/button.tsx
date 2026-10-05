import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Buttons follow the shared design system: 8px corners, 40px tall (32px
// small), 16px icons with an 8px gap, and they move down 1px when pressed.
// "default" is the primary action, "outline" the everyday secondary one.
const SECONDARY =
  "border-line bg-surface text-fg shadow-[var(--inner-glow)] hover:border-line-strong aria-expanded:border-line-strong"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-accent text-accent-fg shadow-[0_0_0_1px_var(--accent),0_8px_24px_-10px_var(--accent)] hover:bg-accent-hover",
        outline: SECONDARY,
        secondary: SECONDARY,
        ghost:
          "border-transparent text-muted hover:bg-surface-hover hover:text-fg aria-expanded:bg-surface-hover",
        destructive:
          "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
        link: "border-transparent text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        xs: "h-7 gap-1.5 px-2.5 text-xs",
        sm: "h-8 gap-1.5 px-3 text-[0.8125rem]",
        lg: "h-11 px-5",
        icon: "size-10",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // 44px tall, on a fill slightly darker than the card it sits in. The
        // border turns accent on focus (plus the shared focus ring) and
        // danger when invalid.
        "h-11 w-full min-w-0 rounded-lg border border-line bg-canvas/50 px-3 text-sm text-fg shadow-[var(--inner-glow)] transition-[border-color,background-color] duration-150 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg focus-visible:border-accent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }

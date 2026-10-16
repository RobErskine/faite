"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { useResolvedTheme } from "@/lib/use-resolved-theme"
import { toasterPosition } from "@/lib/toaster-placement"

const OPEN_SHEET = '[data-slot="sheet-content"]:not([data-closed])'

/** Whether a sheet is open, and the viewport width, kept current. The sheet is
 * portaled to <body>, so a MutationObserver on the body is the only hook. */
function useSheetPlacement() {
  const [state, setState] = useState({ open: false, width: 0 })
  useEffect(() => {
    const read = () => {
      const open = document.querySelector(OPEN_SHEET) !== null
      const width = window.innerWidth
      setState((s) => (s.open === open && s.width === width ? s : { open, width }))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-closed"],
    })
    window.addEventListener("resize", read)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", read)
    }
  }, [])
  return state
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useResolvedTheme()
  const { open, width } = useSheetPlacement()
  const position = toasterPosition(open, width)

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position={position}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

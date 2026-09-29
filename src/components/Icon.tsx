// A small, consistent stroke icon set (1.5px strokes on a 20px grid).
const paths = {
  play: <path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <path d="M7 4.5v11M13 4.5v11" strokeWidth="2.2" />
    </>
  ),
  back: <path d="M12.5 4.5 7 10l5.5 5.5" />,
  prev: <path d="M14.5 5v10L8 10zM5.5 5v10" />,
  next: <path d="M5.5 5v10L12 10zM14.5 5v10" />,
  plus: <path d="M10 4v12M4 10h12" />,
  close: <path d="M5 5l10 10M15 5 5 15" />,
  check: <path d="M4.5 10.5 8.5 14.5 15.5 6" />,
  trash: <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" />,
  file: <path d="M6 3h5.5L15 6.5V17H6zM11 3v4h4" />,
  upload: <path d="M10 13V4M6.5 7.5 10 4l3.5 3.5M4 13v3h12v-3" />,
  speaker: <path d="M4 8h3l4-3.5v11L7 12H4zM14 7.5a3.5 3.5 0 0 1 0 5M16 5.5a6.5 6.5 0 0 1 0 9" />,
  settings: <path d="M4 6h8M15 6h1M4 14h1M8 14h8M12 4.5v3M5 12.5v3" />,
  search: <path d="M9 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM13 13l3.5 3.5" />,
  flip: <path d="M4 8a6 6 0 0 1 10.5-3M16 12a6 6 0 0 1-10.5 3M14.5 2.5V5h-2.5M5.5 17.5V15H8" />,
  list: <path d="M7 5.5h9M7 10h9M7 14.5h9M4 5.5h.5M4 10h.5M4 14.5h.5" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      className="icon"
    >
      {paths[name]}
    </svg>
  );
}

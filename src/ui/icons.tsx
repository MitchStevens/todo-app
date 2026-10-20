// Inline stroke icons, sized for 44px touch targets.
const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': true,
} as const;

export const CloseIcon = () => (
  <svg {...base}>
    <path d="M4 4 L16 16 M16 4 L4 16" />
  </svg>
);

export const BackIcon = () => (
  <svg {...base}>
    <path d="M12 4 L6 10 L12 16" />
  </svg>
);

export const GearIcon = () => (
  <svg {...base}>
    <circle cx="10" cy="10" r="3" />
    <path d="M10 1.5 V4 M10 16 V18.5 M1.5 10 H4 M16 10 H18.5 M4 4 L5.8 5.8 M14.2 14.2 L16 16 M4 16 L5.8 14.2 M14.2 5.8 L16 4" />
  </svg>
);

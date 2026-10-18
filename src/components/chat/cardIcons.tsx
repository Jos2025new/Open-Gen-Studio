import type { ReactNode } from 'react';

const svg = (children: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);

/** Clean inline icons for the chat cards' chips and header (one stroke weight, no fills but the sparkle). */
export const ModelIcon = ({ size }: { size?: number }) => svg(<path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12 6.6 8.4 3 7l3.6-1.4z" />, size);
export const ResolutionIcon = ({ size }: { size?: number }) => svg(<path d="M8 2l5 6-5 6-5-6z" />, size);
export const CountIcon = ({ size }: { size?: number }) => svg(<><rect x="2" y="5" width="8" height="8" rx="1.5" /><path d="M5 2.5h7.5a1 1 0 011 1V11" /></>, size);
export const DurationIcon = ({ size }: { size?: number }) => svg(<><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.3" /></>, size);
export const CardIcon = ({ size = 20 }: { size?: number }) => svg(<><rect x="2.5" y="2.5" width="11" height="11" rx="3" /><path d="M5.5 8h5" /></>, size);
export const SparkIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12 6.6 8.4 3 7l3.6-1.4z" /></svg>
);

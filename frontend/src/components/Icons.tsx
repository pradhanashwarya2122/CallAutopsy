interface IconProps {
  size?: number;
  className?: string;
}

const base = 'inline-block align-middle';

export function ClipboardIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={`${base} ${className}`}>
      <rect x="6" y="4" width="12" height="16" rx="1.5" />
      <rect x="9" y="2" width="6" height="4" rx="1" fill="currentColor" opacity="0.15" />
      <line x1="9" y1="10" x2="15" y2="10" />
      <line x1="9" y1="14" x2="15" y2="14" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

export function WaveformIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={`${base} ${className}`}>
      <line x1="3" y1="12" x2="3" y2="12.01" />
      <line x1="7" y1="8" x2="7" y2="16" />
      <line x1="11" y1="4" x2="11" y2="20" />
      <line x1="15" y1="7" x2="15" y2="17" />
      <line x1="19" y1="10" x2="19" y2="14" />
    </svg>
  );
}

export function StethoscopeIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={`${base} ${className}`}>
      <path d="M6 3v6a4 4 0 0 0 8 0V3" />
      <line x1="6" y1="3" x2="8" y2="3" />
      <line x1="12" y1="3" x2="14" y2="3" />
      <path d="M10 13v3a4 4 0 0 0 8 0v-2" />
      <circle cx="18" cy="10" r="2" />
    </svg>
  );
}

export function AlertIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={`${base} ${className}`}>
      <path d="M12 3 2 20h20L12 3z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={`${base} ${className}`}>
      <path d="M5 12l5 5 9-11" />
    </svg>
  );
}

export function PlayIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={`${base} ${className}`}>
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}

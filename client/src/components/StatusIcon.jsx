import React from 'react';

export default function StatusIcon({ status, size = 16 }) {
  const half = size / 2;
  const strokeWidth = 2;

  if (status === 'completed') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="status-icon status-completed">
        <circle cx="8" cy="8" r="7" fill="#3fb950" />
        <path d="M5 8l2 2 4-4" stroke="#fff" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }

  if (status === 'failed') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="status-icon status-failed">
        <circle cx="8" cy="8" r="7" fill="#f85149" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      </svg>
    );
  }

  if (status === 'in_progress') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="status-icon status-in-progress">
        <circle cx="8" cy="8" r="7" fill="#d29922" />
        <circle cx="8" cy="8" r="4.5" fill="none" stroke="#fff" strokeWidth={strokeWidth} strokeDasharray="8 6" strokeLinecap="round">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 8 8"
            to="360 8 8"
            dur="1s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    );
  }

  if (status === 'queued') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="status-icon status-queued">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="#8b949e" strokeWidth={1.5} />
        <circle cx="8" cy="8" r="2" fill="#8b949e" />
      </svg>
    );
  }

  if (status === 'cancelled') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="status-icon status-cancelled">
        <circle cx="8" cy="8" r="7" fill="#6e7681" />
        <rect x="5" y="7" width="6" height="2" rx="1" fill="#fff" />
      </svg>
    );
  }

  // Default / unknown
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="status-icon">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="#6e7681" strokeWidth={1.5} />
    </svg>
  );
}

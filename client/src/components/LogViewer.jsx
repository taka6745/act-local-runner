import React, { useEffect, useRef } from 'react';

// Basic ANSI color code to CSS class mapping
const ANSI_COLORS = {
  '30': '#484f58',  // black
  '31': '#f85149',  // red
  '32': '#3fb950',  // green
  '33': '#d29922',  // yellow
  '34': '#58a6ff',  // blue
  '35': '#bc8cff',  // magenta
  '36': '#39c5cf',  // cyan
  '37': '#e6edf3',  // white
  '90': '#6e7681',  // bright black
  '91': '#ffa198',  // bright red
  '92': '#56d364',  // bright green
  '93': '#e3b341',  // bright yellow
  '94': '#79c0ff',  // bright blue
  '95': '#d2a8ff',  // bright magenta
  '96': '#56d4dd',  // bright cyan
  '97': '#ffffff',  // bright white
  '1': null,        // bold (handled separately)
};

function parseAnsi(text) {
  const parts = [];
  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor = null;
  let bold = false;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Push text before this escape code
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        color: currentColor,
        bold,
      });
    }

    const codes = match[1].split(';').filter(Boolean);
    for (const code of codes) {
      if (code === '0' || code === '') {
        currentColor = null;
        bold = false;
      } else if (code === '1') {
        bold = true;
      } else if (ANSI_COLORS[code] !== undefined) {
        if (ANSI_COLORS[code] !== null) {
          currentColor = ANSI_COLORS[code];
        }
      }
    }

    lastIndex = regex.lastIndex;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      color: currentColor,
      bold,
    });
  }

  return parts;
}

function LogLine({ number, text }) {
  const parts = parseAnsi(text);

  return (
    <div className="log-line">
      <span className="log-line-number">{number}</span>
      <span className="log-line-content">
        {parts.map((part, i) => (
          <span
            key={i}
            style={{
              color: part.color || undefined,
              fontWeight: part.bold ? 700 : undefined,
            }}
          >
            {part.text}
          </span>
        ))}
      </span>
    </div>
  );
}

export default function LogViewer({ log, autoScroll = true }) {
  const containerRef = useRef(null);
  const prevLogLenRef = useRef(0);

  useEffect(() => {
    if (autoScroll && containerRef.current && log) {
      const newLen = log.length;
      if (newLen > prevLogLenRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
      prevLogLenRef.current = newLen;
    }
  }, [log, autoScroll]);

  if (!log) {
    return (
      <div className="log-viewer" ref={containerRef}>
        <div className="log-empty">No logs available</div>
      </div>
    );
  }

  const lines = log.split('\n');

  return (
    <div className="log-viewer" ref={containerRef}>
      {lines.map((line, i) => (
        <LogLine key={i} number={i + 1} text={line} />
      ))}
    </div>
  );
}

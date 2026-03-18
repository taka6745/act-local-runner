import React from 'react';

export default function Layout({ sidebar, children }) {
  return (
    <div className="layout">
      {sidebar}
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

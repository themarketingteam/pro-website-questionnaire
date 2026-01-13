import React from 'react';
import HotjarTracking from './components/HotjarTracking';

export default function Layout({ children }) {
  return (
    <>
      <HotjarTracking />
      {children}
    </>
  );
}
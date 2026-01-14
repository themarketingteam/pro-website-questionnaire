import React from 'react';
import HotjarTracking from './components/HotjarTracking';
import ReduxProvider from './components/ReduxProvider';

export default function Layout({ children }) {
  return (
    <ReduxProvider>
      <HotjarTracking />
      {children}
    </ReduxProvider>
  );
}
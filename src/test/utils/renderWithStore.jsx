import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import formReducer from '@/components/store/formSlice';
import { render } from '@testing-library/react';

export function createTestStore(preloadedState) {
  return configureStore({
    reducer: { form: formReducer },
    preloadedState,
  });
}

export function renderWithStore(ui, { preloadedState } = {}) {
  const store = createTestStore(preloadedState);
  const Wrapper = ({ children }) => (
    <Provider store={store}>{children}</Provider>
  );
  return { ...render(ui, { wrapper: Wrapper }), store };
}
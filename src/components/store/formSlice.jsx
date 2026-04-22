import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  responses: {},
  validationStatus: {},
  touchedQuestions: {},
  expandedQuestions: {},
  credentials: {},
  textValidationMeta: {} // { [questionId]: { lastValidatedValue: string, isDirty: boolean } }
};

const formSlice = createSlice({
  name: 'form',
  initialState,
  reducers: {
    setResponse: (state, action) => {
      const { questionId, value } = action.payload;
      state.responses[questionId] = value;
      // If this is a textarea question (identified elsewhere), callers will also set dirty meta.
    },
    setMultipleResponses: (state, action) => {
      state.responses = { ...state.responses, ...action.payload };
    },
    setValidationStatus: (state, action) => {
      const { questionId, status } = action.payload;
      state.validationStatus[questionId] = status;
    },
    setMultipleValidationStatus: (state, action) => {
      state.validationStatus = { ...state.validationStatus, ...action.payload };
    },
    setTouchedQuestion: (state, action) => {
      const { questionId, touched } = action.payload;
      state.touchedQuestions[questionId] = touched;
    },
    setExpandedQuestion: (state, action) => {
      const { questionId, expanded } = action.payload;
      state.expandedQuestions[questionId] = expanded;
    },
    setAllExpanded: (state, action) => {
      state.expandedQuestions = action.payload;
    },
    setCredentials: (state, action) => {
      state.credentials = action.payload;
    },
    resetForm: (state) => {
      state.responses = initialState.responses;
      state.validationStatus = initialState.validationStatus;
      state.touchedQuestions = {};
      state.expandedQuestions = {};
    },
    deleteResponse: (state, action) => {
      const questionId = action.payload;
      delete state.responses[questionId];
      delete state.responses[`${questionId}_other`];
      delete state.responses[`${questionId}_primary`];
      delete state.textValidationMeta[questionId];
      delete state.validationStatus[questionId];
      delete state.touchedQuestions[questionId];
      delete state.expandedQuestions[questionId];
    },
    initializeExpandedQuestions: (state, action) => {
      state.expandedQuestions = action.payload;
    },
    setTextareaDirtyMeta: (state, action) => {
      const { questionId, lastValidatedValue, isDirty } = action.payload;
      state.textValidationMeta[questionId] = {
        lastValidatedValue: lastValidatedValue ?? state.textValidationMeta[questionId]?.lastValidatedValue ?? '',
        isDirty: isDirty ?? state.textValidationMeta[questionId]?.isDirty ?? false,
      };
    },
    loadInitialState: (state, action) => {
      return { ...state, ...action.payload };
    }
  }
});

export const {
  setResponse,
  setMultipleResponses,
  setValidationStatus,
  setMultipleValidationStatus,
  setTouchedQuestion,
  setExpandedQuestion,
  setAllExpanded,
  setCredentials,
  resetForm,
  deleteResponse,
  initializeExpandedQuestions,
  setTextareaDirtyMeta,
  loadInitialState
} = formSlice.actions;

export default formSlice.reducer;
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  responses: {
    '1': 'no',
    '2': 'no',
    '12': 'no',
    '14': 'no',
    '23': 'no',
    '25': 'no'
  },
  validationStatus: {
    '1': '', '2': '', '3': '', '4': '', '5': '',
    '6': '', '7': '', '8': '', '9': '', '10': '',
    '11': '', '12': '', '13': '', '14': '', '15': '',
    '16': '', '17': '', '18': '', '19': '', '20': '',
    '21': '', '22': '', '23': '', '24': '', '25': '',
    '1.1': '', '2.1': '', '2.2': '',
    '12.1': '', '14.1': '', '23.1': '', '25.1': ''
  },
  touchedQuestions: {},
  expandedQuestions: {},
  credentials: {}
};

const formSlice = createSlice({
  name: 'form',
  initialState,
  reducers: {
    setResponse: (state, action) => {
      const { questionId, value } = action.payload;
      state.responses[questionId] = value;
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
    },
    initializeExpandedQuestions: (state, action) => {
      state.expandedQuestions = action.payload;
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
  loadInitialState
} = formSlice.actions;

export default formSlice.reducer;
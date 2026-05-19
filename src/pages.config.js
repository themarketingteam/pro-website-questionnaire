/**
 * pages.config.js - legacy page registry used by the App.jsx route loop.
 *
 * Important: routing for this app is explicitly controlled in App.jsx.
 * New routes must be added in App.jsx and should not rely on this file alone.
 *
 * This file currently defines the legacy page map and layout wrapper used by
 * the existing Pages loop in App.jsx.
 */
import React, { lazy } from 'react';
import __Layout from './Layout.jsx';

const ProQuestionnaire = lazy(() => import('./pages/ProQuestionnaire'));
const ThankYou = lazy(() => import('./pages/ThankYou'));


export const PAGES = {
    "ProQuestionnaire": ProQuestionnaire,
    "ThankYou": ThankYou,
}

export const pagesConfig = {
    mainPage: "ProQuestionnaire",
    Pages: PAGES,
    Layout: __Layout,
};
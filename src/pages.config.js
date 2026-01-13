import Home from './pages/Home';
import ProQuestionnaire from './pages/ProQuestionnaire';
import TestZapier from './pages/TestZapier';
import ThankYou from './pages/ThankYou';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Home": Home,
    "ProQuestionnaire": ProQuestionnaire,
    "TestZapier": TestZapier,
    "ThankYou": ThankYou,
}

export const pagesConfig = {
    mainPage: "ProQuestionnaire",
    Pages: PAGES,
    Layout: __Layout,
};
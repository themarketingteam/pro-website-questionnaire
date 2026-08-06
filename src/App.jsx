import React, { Suspense } from 'react'
import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AdminSubmitIntake from './pages/AdminSubmitIntake';
import ProFormDraftRecovery from './pages/ProFormDraftRecovery';
import ProDraftRecovery from './pages/ProDraftRecovery';
import ProDraftOperations from './pages/ProDraftOperations';
import QuestionnaireIntakeRecoveryPage from './pages/QuestionnaireIntakeRecovery';
import DraftRecoveryPasswordGate from '@/components/admin/DraftRecoveryPasswordGate';
import ProDraftAdminRecoveryShell from '@/components/admin/ProDraftAdminRecoveryShell';
import { ProDraftAdminAuthorizationProvider } from '@/contexts/ProDraftAdminAuthorizationContext';
import AppRuntimeShell from '@/components/common/AppRuntimeShell';
import AppInitializationError from '@/components/common/AppInitializationError';
import { base44ClientInitialization } from '@/api/base44Client';

const ADMIN_EMAILS = ['benjamin.hines8@gmail.com'];

const isAdminUser = (user) => {
  if (user?.role === 'admin') return true;
  return Boolean(user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase()));
};

const AdminOnly = ({ children }) => {
  const { user, isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg bg-white rounded-xl border shadow-sm p-6 text-center">
          <h1 className="text-xl font-bold text-slate-900">Access denied</h1>
          <p className="text-slate-600 mt-2">
            You do not have permission to view questionnaire draft recovery data.
          </p>
        </div>
      </div>
    );
  }

  return children;
};

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const AppRouteLoader = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-white/80">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>
    <Suspense fallback={<AppRouteLoader />}>{children}</Suspense>
  </Layout>
  : <Suspense fallback={<AppRouteLoader />}>{children}</Suspense>;

export const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const location = useLocation();
  const bypassesBase44UserLogin = location.pathname === '/recover-draft'
    || location.pathname === '/admin/draft-recovery'
    || location.pathname === '/admin/questionnaire-intake-recovery'
    || location.pathname === '/admin/draft-operations';

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError && !bypassesBase44UserLogin) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      <Route path="/recover-draft" element={
        <LayoutWrapper currentPageName={"recover-draft"}>
          <ProDraftRecovery />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            path === 'Home' || path === 'ProQuestionnaire'
              ? <Navigate to="/" replace />
              : (
                <LayoutWrapper currentPageName={path}>
                  <Page />
                </LayoutWrapper>
              )
          }
        />
      ))}
      <Route path="/admin/submit-intake" element={
        <AdminOnly>
          <LayoutWrapper currentPageName={"admin/submit-intake"}>
            <AdminSubmitIntake />
          </LayoutWrapper>
        </AdminOnly>
      } />
      {/* Password-only access is verified server-side by a Base44 function. */}
      <Route path="/admin/draft-recovery" element={
        <ProDraftAdminAuthorizationProvider><DraftRecoveryPasswordGate><ProDraftAdminRecoveryShell>
          <LayoutWrapper currentPageName={"admin/draft-recovery"}><ProFormDraftRecovery /></LayoutWrapper>
        </ProDraftAdminRecoveryShell></DraftRecoveryPasswordGate></ProDraftAdminAuthorizationProvider>
      } />
      <Route path="/admin/questionnaire-intake-recovery" element={
        <ProDraftAdminAuthorizationProvider><DraftRecoveryPasswordGate><ProDraftAdminRecoveryShell>
          <LayoutWrapper currentPageName={"admin/questionnaire-intake-recovery"}><QuestionnaireIntakeRecoveryPage /></LayoutWrapper>
        </ProDraftAdminRecoveryShell></DraftRecoveryPasswordGate></ProDraftAdminAuthorizationProvider>
      } />
      <Route path="/admin/draft-operations" element={
        <ProDraftAdminAuthorizationProvider><DraftRecoveryPasswordGate><ProDraftAdminRecoveryShell>
          <LayoutWrapper currentPageName={"admin/draft-operations"}><ProDraftOperations /></LayoutWrapper>
        </ProDraftAdminRecoveryShell></DraftRecoveryPasswordGate></ProDraftAdminAuthorizationProvider>
      } />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  if (!base44ClientInitialization.success) {
    return <AppInitializationError />;
  }

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AppRuntimeShell>
            <AuthenticatedApp />
          </AppRuntimeShell>
        </Router>
        <Toaster />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App

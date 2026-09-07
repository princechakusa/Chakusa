import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import Layout from "./components/Layout";
import { LoadingState } from "./components/ui";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const BusinessesPage = lazy(() => import("./pages/BusinessesPage"));
const BusinessDetailPage = lazy(() => import("./pages/BusinessDetailPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const UserDetailPage = lazy(() => import("./pages/UserDetailPage"));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage"));
const CustomersPage = lazy(() => import("./pages/CustomersPage"));
const BookingsPage = lazy(() => import("./pages/BookingsPage"));
const MarketplacePage = lazy(() => import("./pages/MarketplacePage"));
const LoyaltyPage = lazy(() => import("./pages/LoyaltyPage"));
const AIOperationsPage = lazy(() => import("./pages/AIOperationsPage"));
const FinanceOperationsPage = lazy(() => import("./pages/FinanceOperationsPage"));
const AutomationPage = lazy(() => import("./pages/AutomationPage"));
const CommunicationsPage = lazy(() => import("./pages/CommunicationsPage"));
const SupportPage = lazy(() => import("./pages/SupportPage"));
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

function ProtectedLayout() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <div className="full-state"><LoadingState label="Securing your workspace" /></div>;
  if (auth.status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}

export default function App() {
  return <Suspense fallback={<div className="full-state"><LoadingState /></div>}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedLayout />}>
      <Route index element={<DashboardPage />} />
      <Route path="analytics" element={<AnalyticsPage />} />
      <Route path="businesses" element={<BusinessesPage />} />
      <Route path="businesses/:id" element={<BusinessDetailPage />} />
      <Route path="users" element={<UsersPage />} />
      <Route path="users/:id" element={<UserDetailPage />} />
      <Route path="subscriptions" element={<SubscriptionsPage />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="bookings" element={<BookingsPage />} />
      <Route path="marketplace" element={<MarketplacePage />} />
      <Route path="loyalty" element={<LoyaltyPage />} />
      <Route path="ai" element={<AIOperationsPage />} />
      <Route path="finance" element={<FinanceOperationsPage />} />
      <Route path="automation" element={<AutomationPage />} />
      <Route path="communications" element={<CommunicationsPage />} />
      <Route path="support" element={<SupportPage />} />
      <Route path="feedback" element={<FeedbackPage />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="legal" element={<LegalPage />} />
      <Route path="security" element={<SecurityPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes></Suspense>;
}

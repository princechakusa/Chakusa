import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import Layout from "./components/Layout";
import { LoadingState } from "./components/ui";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const BusinessesPage = lazy(() => import("./pages/BusinessesPage"));
const BusinessDetailPage = lazy(() => import("./pages/BusinessDetailPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const UserDetailPage = lazy(() => import("./pages/UserDetailPage"));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage"));
const AutomationPage = lazy(() => import("./pages/AutomationPage"));
const CommunicationsPage = lazy(() => import("./pages/CommunicationsPage"));
const SupportPage = lazy(() => import("./pages/SupportPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
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
      <Route path="businesses" element={<BusinessesPage />} />
      <Route path="businesses/:id" element={<BusinessDetailPage />} />
      <Route path="users" element={<UsersPage />} />
      <Route path="users/:id" element={<UserDetailPage />} />
      <Route path="subscriptions" element={<SubscriptionsPage />} />
      <Route path="automation" element={<AutomationPage />} />
      <Route path="communications" element={<CommunicationsPage />} />
      <Route path="support" element={<SupportPage />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="security" element={<SecurityPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes></Suspense>;
}

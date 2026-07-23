import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { DisputesPage } from "./pages/DisputesPage";
import { NewRecordPage } from "./pages/NewRecordPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { ReviewersPage } from "./pages/ReviewersPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Layout>{children}</Layout>;
}

/** Admin-role guard for /reviewers. The API is expected to 403 non-admins
 * as the real backstop (see ReviewersPage) — this is the UI-side
 * convenience of not showing/routing to a page a reviewer can't use. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { reviewer } = useAuth();
  if (reviewer?.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/review-queue"
        element={
          <RequireAuth>
            <ReviewQueuePage />
          </RequireAuth>
        }
      />
      <Route
        path="/disputes"
        element={
          <RequireAuth>
            <DisputesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/new-record"
        element={
          <RequireAuth>
            <NewRecordPage />
          </RequireAuth>
        }
      />
      <Route
        path="/audit-log"
        element={
          <RequireAuth>
            <AuditLogPage />
          </RequireAuth>
        }
      />
      <Route
        path="/reviewers"
        element={
          <RequireAuth>
            <RequireAdmin>
              <ReviewersPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { DisputesPage } from "./pages/DisputesPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
      <Route path="*" element={<Navigate to="/review-queue" replace />} />
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

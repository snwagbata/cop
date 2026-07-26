import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { SearchPage } from "./pages/SearchPage";
import { OfficerDetailPage } from "./pages/OfficerDetailPage";
import { DepartmentsListPage } from "./pages/DepartmentsListPage";
import { DepartmentStatsPage } from "./pages/DepartmentStatsPage";
import { OfficersBrowsePage } from "./pages/OfficersBrowsePage";
import { DisputeFormPage } from "./pages/DisputeFormPage";
import { DisputeStatusPage } from "./pages/DisputeStatusPage";
import { TipSubmissionPage } from "./pages/TipSubmissionPage";
import { AboutPage } from "./pages/AboutPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/officers/:id" element={<OfficerDetailPage />} />
        <Route path="/departments" element={<DepartmentsListPage />} />
        <Route path="/departments/:id" element={<DepartmentStatsPage />} />
        <Route path="/departments/:id/officers" element={<OfficersBrowsePage />} />
        <Route path="/disputes/new" element={<DisputeFormPage />} />
        <Route path="/disputes/status" element={<DisputeStatusPage />} />
        <Route path="/tips/new" element={<TipSubmissionPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}

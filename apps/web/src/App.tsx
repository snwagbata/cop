import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SearchPage } from "./pages/SearchPage";
import { OfficerDetailPage } from "./pages/OfficerDetailPage";
import { DepartmentsListPage } from "./pages/DepartmentsListPage";
import { DepartmentStatsPage } from "./pages/DepartmentStatsPage";
import { DisputeFormPage } from "./pages/DisputeFormPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/officers/:id" element={<OfficerDetailPage />} />
        <Route path="/departments" element={<DepartmentsListPage />} />
        <Route path="/departments/:id" element={<DepartmentStatsPage />} />
        <Route path="/disputes/new" element={<DisputeFormPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}

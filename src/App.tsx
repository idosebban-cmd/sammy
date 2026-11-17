import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { useWorkspace, WorkspaceProvider } from "./lib/workspace";
import ActionsPage from "./pages/Actions";
import AddPage from "./pages/Add";
import AskPage from "./pages/Ask";
import DocumentPage from "./pages/Document";
import DocumentsPage from "./pages/Documents";
import EntryPage from "./pages/Entry";
import HomePage from "./pages/Home";
import LoginPage from "./pages/Login";
import ProfilePage from "./pages/Profile";
import SettingsPage from "./pages/Settings";
import TimelinePage from "./pages/Timeline";

function Gate() {
  const { session, loading, workspace, error } = useWorkspace();
  // Only block on the first load; later refreshes keep the current page mounted.
  if (loading && !workspace) return <div className="mx-auto max-w-md px-4"><Loading /></div>;
  if (!session) return <LoginPage />;
  if (!workspace) {
    return (
      <div className="mx-auto mt-20 max-w-md px-4 text-center">
        <h1 className="font-display text-2xl font-semibold">Almost there</h1>
        <p className="mt-2 text-sm text-stone-600">{error ?? "This account isn't linked to a workspace yet."}</p>
        <button className="btn-secondary mt-6" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="add" element={<AddPage />} />
        <Route path="entries/:id" element={<EntryPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="actions" element={<ActionsPage />} />
        <Route path="sammy" element={<ProfilePage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:id" element={<DocumentPage />} />
        <Route path="ask" element={<AskPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto mt-20 max-w-lg px-4">
        <h1 className="font-display text-2xl font-semibold">Setup needed</h1>
        <p className="mt-2 text-sm text-stone-600">
          Copy <code>.env.example</code> to <code>.env.local</code> and add your Supabase project URL and anon key, then restart the app. See the README for the full setup.
        </p>
      </div>
    );
  }
  return (
    <BrowserRouter>
      <WorkspaceProvider>
        <Gate />
      </WorkspaceProvider>
    </BrowserRouter>
  );
}

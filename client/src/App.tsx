import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from './context/session';
import { Layout } from './components/Layout';
import { Button, PageLoader } from './components/ui';
import { AcceptInvitePage, LoginPage, RegisterPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { ProjectsPage } from './pages/Projects';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { ClientDetailPage, ClientsPage } from './pages/Clients';
import { InvoiceDetailPage, InvoiceEditorPage, InvoicesPage } from './pages/Invoices';
import { TeamPage } from './pages/Team';
import { SettingsPage } from './pages/Settings';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!session) {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

function StaffOnly({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (session?.user.role === 'CLIENT') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <PageLoader />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500">The page you're looking for doesn't exist or you don't have access.</p>
      <Button className="mt-6" onClick={() => (window.location.href = '/')}>
        Go to dashboard
      </Button>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="clients" element={<StaffOnly><ClientsPage /></StaffOnly>} />
        <Route path="clients/:id" element={<StaffOnly><ClientDetailPage /></StaffOnly>} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/new" element={<StaffOnly><InvoiceEditorPage /></StaffOnly>} />
        <Route path="invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="invoices/:id/edit" element={<StaffOnly><InvoiceEditorPage /></StaffOnly>} />
        <Route path="team" element={<StaffOnly><TeamPage /></StaffOnly>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

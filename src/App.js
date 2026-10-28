import SessionBoundary from "./components/SessionBoundary";
import ServiceConnectionNotice from "./components/ServiceConnectionNotice";
import "./ServicePages.css";
import React, { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

import { loadPage } from "./pageLoading";
import HomePage from "./pages/HomePage";
import LoginRegister from "./pages/LoginRegister";
import "./Administration.css";
import ProtectedRoute from "./ProtectedRoute";

import "./App.css";
import "./Phase3.css";
import "./Phase4.css";
import "./Phase5.css";
import "./Phase7.css";
import "./Phase8.css";
import "./Phase9.css";
import "./Phase10.css";
import "./Phase12.css";
import "./Phase14.css";
import "./Phase16.css";
import "./Marketplace.css";
import "./ProjectLifecycle.css";
import "./AccountSettings.css";

import "./Typography.css";
import "./ProposalExperience.css";
import "./ColdStart.css";
import "./TaskBoard.css";
import "./ResponsivePolish.css";

const Support = lazy(() => loadPage("Support"));
const ServicePolicies = lazy(() => loadPage("ServicePolicies"));
const AdminSupport = lazy(() => loadPage("AdminSupport"));
const AdminStorage = lazy(() => loadPage("AdminStorage"));
const AccountSettings = lazy(() => loadPage("AccountSettings"));
const VerifyEmailChange = lazy(() => loadPage("VerifyEmailChange"));
const ForgotPassword = lazy(() => loadPage("ForgotPassword"));
const ResetPassword = lazy(() => loadPage("ResetPassword"));
const ClientDashboard = lazy(() => loadPage("ClientDashboard"));
const FreelancerDashboard = lazy(() => loadPage("FreelancerDashboard"));
const TaskBoard = lazy(() => loadPage("TaskBoard"));
const MyTasks = lazy(() => loadPage("MyTasks"));
const MilestoneChain = lazy(() => loadPage("MilestoneChain"));
const WorkroomInbox = lazy(() => loadPage("WorkroomInbox"));
const FreelancerProfile = lazy(() => loadPage("FreelancerProfile"));
const TalentDirectory = lazy(() => loadPage("TalentDirectory"));
const PublicJob = lazy(() => loadPage("PublicJob"));
const TalentProfile = lazy(() => loadPage("TalentProfile"));
const AdminCases = lazy(() => loadPage("AdminCases"));
const AdminDashboard = lazy(() => loadPage("AdminDashboard"));

function App() {
  return (
    <Router>
      <ServiceConnectionNotice />
      <SessionBoundary><Suspense fallback={<main className="empty-state" role="status" aria-live="polite">Loading your page…</main>}><Routes>
        <Route path="/terms" element={<ServicePolicies />} />
        <Route path="/privacy" element={<ServicePolicies privacy />} />
        <Route path="/support" element={<Support />} />
        <Route path="/admin/support" element={<ProtectedRoute allowedRole="admin"><AdminSupport /></ProtectedRoute>} />
        <Route path="/admin/storage" element={<ProtectedRoute allowedRole="admin"><AdminStorage /></ProtectedRoute>} />
        <Route path="/account/verify-email" element={<VerifyEmailChange />} />
        <Route path="/verify-email" element={<VerifyEmailChange verifyCurrentEmail />} />
        <Route path="/account" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
        <Route path="/" element={<HomePage />} />
        <Route path="/jobs/:projectId" element={<PublicJob />} />

        <Route path="/login" element={<LoginRegister />} />
        <Route path="/admin/login" element={<LoginRegister adminOnly />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route
          path="/client-dashboard"
          element={
            <ProtectedRoute allowedRole="client">
              <ClientDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/freelancer-dashboard"
          element={
            <ProtectedRoute allowedRole="freelancer">
              <FreelancerDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/profile" element={<ProtectedRoute allowedRole="freelancer"><FreelancerProfile /></ProtectedRoute>} />
        <Route path="/my-tasks" element={<ProtectedRoute allowedRole="freelancer"><MyTasks /></ProtectedRoute>} />
        <Route path="/task-boards/:projectId?" element={<ProtectedRoute allowedRole="freelancer"><TaskBoard /></ProtectedRoute>} />
        <Route path="/talent" element={<ProtectedRoute allowedRole="client"><TalentDirectory /></ProtectedRoute>} />
        <Route path="/talent/:freelancerId" element={<ProtectedRoute allowedRole="client"><TalentProfile /></ProtectedRoute>} />
        <Route path="/workrooms" element={<ProtectedRoute><WorkroomInbox /></ProtectedRoute>} />
        <Route path="/admin/cases" element={<ProtectedRoute allowedRole="admin"><AdminCases /></ProtectedRoute>} />
        <Route path="/admin/overview" element={<ProtectedRoute allowedRole="admin"><AdminDashboard /></ProtectedRoute>} />

        <Route
          path="/milestones/:projectId"
          element={
            <ProtectedRoute>
              <MilestoneChain />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<HomePage />} />
      </Routes></Suspense></SessionBoundary>
    </Router>
  );
}

export default App;

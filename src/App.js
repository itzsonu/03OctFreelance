import Support from "./pages/Support";
import ServicePolicies from "./pages/ServicePolicies";
import AdminSupport from "./pages/AdminSupport";
import AdminStorage from "./pages/AdminStorage";
import "./ServicePages.css";
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

import AccountSettings from "./pages/AccountSettings";
import VerifyEmailChange from "./pages/VerifyEmailChange";
import HomePage from "./pages/HomePage";
import LoginRegister from "./pages/LoginRegister";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ClientDashboard from "./pages/ClientDashboard";
import FreelancerDashboard from "./pages/FreelancerDashboard";
import MilestoneChain from "./pages/MilestoneChain";
import WorkroomInbox from "./pages/WorkroomInbox";
import FreelancerProfile from "./pages/FreelancerProfile";
import TalentDirectory from "./pages/TalentDirectory";
import PublicJob from "./pages/PublicJob";
import TalentProfile from "./pages/TalentProfile";
import AdminCases from "./pages/AdminCases";
import AdminDashboard from "./pages/AdminDashboard";
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

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/terms" element={<ServicePolicies />} />
        <Route path="/privacy" element={<ServicePolicies privacy />} />
        <Route path="/support" element={<Support />} />
        <Route path="/admin/support" element={<ProtectedRoute allowedRole="admin"><AdminSupport /></ProtectedRoute>} />
        <Route path="/admin/storage" element={<ProtectedRoute allowedRole="admin"><AdminStorage /></ProtectedRoute>} />
        <Route path="/account/verify-email" element={<VerifyEmailChange />} />
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
      </Routes>
    </Router>
  );
}

export default App;

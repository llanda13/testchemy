import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useQualityMetrics } from "@/hooks/useQualityMetrics";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/admin/AdminDashboard";
import TeacherDashboard from "./pages/teacher/TeacherDashboard";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { EnhancedDashboard } from "./pages/EnhancedDashboard";
import { QualityDashboard } from "./components/quality/QualityDashboard";
import PsychometricDashboard from "./components/analytics/PsychometricDashboard";
import TestAssembly from "./pages/TestAssembly";
import CurriculumStandards from "./pages/CurriculumStandards";
import ProfessionalExport from "./pages/ProfessionalExport";
import Phase4Hub from "./pages/Phase4Hub";
import EnhancedClassification from "./pages/EnhancedClassification";
import Library from "./pages/Library";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  // Initialize automated metrics collection
  useQualityMetrics();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            
            {/* Admin Routes */}
            <Route 
              path="/admin/dashboard" 
              element={
                <ProtectedRoute requiredRole="admin">
                  <AdminDashboard />
                </ProtectedRoute>
              } 
            />
            
            {/* Teacher Routes */}
            <Route 
              path="/teacher/dashboard" 
              element={
                <ProtectedRoute requiredRole="teacher">
                  <TeacherDashboard />
                </ProtectedRoute>
              } 
            />
            <Route path="/enhanced-dashboard" element={<EnhancedDashboard userRole="teacher" userName="Demo User" />} />
            <Route path="/quality" element={<QualityDashboard />} />
            <Route path="/psychometrics" element={<PsychometricDashboard />} />
            <Route path="/test-assembly" element={<TestAssembly />} />
            <Route path="/curriculum-standards" element={<CurriculumStandards />} />
            <Route path="/professional-export" element={<ProfessionalExport />} />
            <Route path="/phase4" element={<Phase4Hub />} />
            <Route path="/validation" element={<EnhancedClassification />} />
            <Route path="/library" element={<Library />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;

import { Layout } from "@/components/ui/layout/Layout";
import AnalyticsCharts from "@/components/ui/AnalyticsCharts";
import EnhancedQuestionBank from "@/components/ui/EnhancedQuestionBank";
import { CollaborativeDocumentManager } from "@/components/ui/CollaborativeDocumentManager";
import { TestVersionComparison } from "@/components/ui/TestVersionComparison";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart3, 
  CheckCircle, 
  Users, 
  Shuffle 
} from "lucide-react";

export default function Analytics() {
  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Analytics & Advanced Features</h1>
          <p className="text-muted-foreground">
            AI-powered insights, collaboration tools, and advanced test generation
          </p>
        </div>

        <Tabs defaultValue="analytics" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="analytics" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="approval" className="gap-2">
              <CheckCircle className="h-4 w-4" />
              AI Approval
            </TabsTrigger>
            <TabsTrigger value="collaboration" className="gap-2">
              <Users className="h-4 w-4" />
              Collaboration
            </TabsTrigger>
            <TabsTrigger value="versions" className="gap-2">
              <Shuffle className="h-4 w-4" />
              Multi-Version
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analytics">
            <AnalyticsCharts />
          </TabsContent>

          <TabsContent value="approval">
            <EnhancedQuestionBank onBack={() => {}} />
          </TabsContent>

          <TabsContent value="collaboration">
            <CollaborativeDocumentManager 
              documentId="analytics-demo"
              documentType="question"
              documentTitle="Analytics Dashboard"
              currentUserEmail="demo@example.com"
              isOwner={true}
            />
          </TabsContent>

          <TabsContent value="versions">
            <TestVersionComparison 
              versions={[]}
              originalQuestions={[]}
            />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
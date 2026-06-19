import { PageHeader } from "@/components/page-header";
import { NewCaseForm } from "@/components/new-case-form";

export default function NewCasePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="New case"
        description="Define the negotiation scenario and assign 2–4 roles with private briefing instructions."
      />
      <NewCaseForm />
    </div>
  );
}

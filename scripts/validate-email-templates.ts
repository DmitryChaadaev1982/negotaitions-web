import { validateTemplateRegistry } from "@/lib/email/templates";

const issues = validateTemplateRegistry();
if (issues.length > 0) {
  console.error(JSON.stringify({ ok: false, issues }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, templates: "valid" }, null, 2));

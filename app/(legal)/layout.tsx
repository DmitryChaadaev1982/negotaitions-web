import { legalIndexingMetadata } from "@/lib/seo/indexing";

export const metadata = legalIndexingMetadata;

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

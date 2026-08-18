import { privateIndexingMetadata } from "@/lib/seo/indexing";

export const metadata = privateIndexingMetadata;

export default function JoinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

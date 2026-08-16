import { privateIndexingMetadata } from "@/lib/seo/indexing";

export const metadata = privateIndexingMetadata;

export default function RoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-dvh overflow-hidden">{children}</div>
  );
}

import { getOptionalCurrentUser } from "@/lib/auth";
import { requireCurrentLegalRelease } from "@/lib/legal/require-current-release";
import { privateIndexingMetadata } from "@/lib/seo/indexing";

export const metadata = privateIndexingMetadata;

export default async function RoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getOptionalCurrentUser();
  await requireCurrentLegalRelease(user);

  return (
    <div className="h-dvh overflow-hidden">{children}</div>
  );
}

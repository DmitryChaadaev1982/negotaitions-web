import { PublicHeader } from "@/components/public-header";
import { getOptionalCurrentUser } from "@/lib/auth";
import { publicIndexingMetadata } from "@/lib/seo/indexing";

export const metadata = publicIndexingMetadata;

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getOptionalCurrentUser();
  const isAuthenticated = Boolean(user);
  const isActive = user?.status === "ACTIVE";

  return (
    <div className="flex min-h-full flex-col">
      <PublicHeader isAuthenticated={isAuthenticated} isActive={isActive} />
      {children}
    </div>
  );
}

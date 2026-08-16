import { PublicHomePage } from "@/components/public-home-page";
import { getOptionalCurrentUser } from "@/lib/auth";

export default async function PublicHome() {
  const user = await getOptionalCurrentUser();
  const isAuthenticated = Boolean(user);
  const isActive = user?.status === "ACTIVE";

  return (
    <PublicHomePage isAuthenticated={isAuthenticated} isActive={isActive} />
  );
}

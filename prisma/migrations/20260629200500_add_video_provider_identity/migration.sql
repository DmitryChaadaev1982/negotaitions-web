-- CreateTable
CREATE TABLE "VideoProviderIdentity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerUsername" TEXT NOT NULL,
    "providerApplicationName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "lastProvisioningError" TEXT,
    "metadata" JSONB,

    CONSTRAINT "VideoProviderIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoProviderIdentity_provider_userId_key" ON "VideoProviderIdentity"("provider", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProviderIdentity_provider_providerUsername_key" ON "VideoProviderIdentity"("provider", "providerUsername");

-- CreateIndex
CREATE INDEX "VideoProviderIdentity_userId_idx" ON "VideoProviderIdentity"("userId");

-- AddForeignKey
ALTER TABLE "VideoProviderIdentity" ADD CONSTRAINT "VideoProviderIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

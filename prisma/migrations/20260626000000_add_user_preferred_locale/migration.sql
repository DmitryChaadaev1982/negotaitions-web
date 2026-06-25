-- Add preferredLocale column to User
-- "ru" | "en" — the user's chosen interface language, saved at registration and updatable via profile.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preferredLocale" TEXT NOT NULL DEFAULT 'ru';

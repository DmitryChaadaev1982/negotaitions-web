-- Rename preparationNotes to notes
ALTER TABLE "SessionParticipant" RENAME COLUMN "preparationNotes" TO "notes";

-- Drop legacy timestamped note tables
DROP TABLE "FacilitatorNote";
DROP TABLE "ObserverNote";

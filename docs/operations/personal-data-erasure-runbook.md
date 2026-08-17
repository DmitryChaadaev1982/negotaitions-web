# Personal-data erasure and anonymization runbook

Internal support-operated procedure for account-deletion and related
personal-data requests. This is not a user-facing product function and does
not authorize casual production mutation.

Do not run destructive SQL from this document. Do not create or execute an
automation script from this wave. Any destructive step requires a separately
reviewed operation when a real request occurs.

Public contact for requests: `support@negotaitions.ru`.

Approved operational model: a controlled combination of **deletion** and
**anonymization**. Replacing a display name is not, by itself, complete
anonymization.

## 1. Request intake

1. The request arrives at `support@negotaitions.ru`.
2. Create an internal case/reference identifier. Record the request date,
   channel, and the requester’s stated email/display name.
3. Establish account identity using proportionate means. Typical correlation
   is the registered email plus information the requester would reasonably
   know about the account. If identity cannot be established, do not mutate
   data; reply asking for the minimum additional confirmation.
4. Do not ask the requester to send a password, session cookie, or access
   token.

## 2. Discovery / dry run

Inventory without mutation. Use read-only queries in a reviewed session.
Record counts and identifiers in the case file. The following application
records are in scope when linked to the identified `User.id` / email:

| Area | Typical records | Notes |
| --- | --- | --- |
| Account | `User` | email, display name, password hash, status, timestamps |
| Sessions | `UserSession` | active access; hashed session token |
| Consents | `UserConsent` | historical v1 and any later rows; do not rewrite history |
| Events | `EventParticipant`, event host/facilitator links, `EventInvite` | display name, optional email |
| Sessions | `SessionParticipant`, facilitator/owner links, `SessionInvite` | display name, notes, role |
| Notes | `SessionParticipant.notes` and case/session text the user entered | may contain identifiers |
| Recordings | `Recording` plus object-storage keys | audio-only in current production; `fileKey`, compressed keys |
| Transcripts | `Transcript`, `TranscriptSegment`, speaker mapping | text may contain names |
| AI | `AiAnalysis`, publications, grants, `rawModelOutput`, `analysisJson`, `sharedAnalysisJson` | personal feedback and identifiers |
| Email/security | `EmailMessage`, `PasswordResetToken`, related journal/suppression rows | recipient email and security metadata |
| Provider identity | `VideoProviderIdentity` | provider usernames |
| Object storage | objects referenced by recording keys | application copy |
| Provider-side | Voximplant recording artifacts | not confirmed automated; treat as external follow-up |

Safe discovery pattern (illustrative, not executable production SQL):

- resolve `User` by normalized email;
- list `UserSession`, `UserConsent`, `EventParticipant`, `SessionParticipant`
  by `userId`;
- list sessions where the user is facilitator;
- list `Recording` for those sessions and collect `fileKey` /
  `compressedFileKey`;
- list `Transcript` / segments / mappings for those sessions;
- list `AiAnalysis` and publication grants for those sessions;
- list `EmailMessage` and `PasswordResetToken` for the user.

Do not paste ad-hoc `DELETE` statements into production.

## 3. Decision

Classify each discovered item:

- **DELETE** — no remaining lawful need to keep the personal data.
- **ANONYMIZE** — historical training structure may remain only after
  sufficient removal of identifiers.
- **RETAIN ON A SEPARATE VALID BASIS** — for example a legal obligation.
  Record the basis.
- **MANUAL REVIEW** — insufficient confidence that anonymization would be
  reliable.

A display-name substitution alone is classified as incomplete unless the
remaining material no longer identifies the person.

## 4. Account access termination

In the separately reviewed operation:

- revoke active `UserSession` rows / block further access;
- remove or block the account according to the approved erasure decision
  (`User.status` and credential invalidation as required).

Do not leave an active login path to the same account.

## 5. Recordings

If an audio recording contains the requesting user’s participation, the
normal erasure process deletes that recording rather than treating it as
anonymized.

Deletion scope:

- application object-storage objects referenced by `Recording.fileKey` and
  any compressed derivative keys;
- related `Recording` row after objects are removed, as decided in the
  reviewed operation;
- provider-side Voximplant copies where applicable and possible.

Provider-side Voximplant retention and deletion are an external confirmation
item. Do not record provider-side deletion as already automated.

## 6. Session participation

Where historical session structure is retained:

- sever `SessionParticipant.userId` / `EventParticipant.userId` account
  linkage;
- replace identifying display data with a neutral deleted-user
  representation;
- remove or anonymize participant notes that identify the person.

If linkage cannot be severed without leaving identifying material, classify
the related session artifacts for deletion or manual review.

## 7. Transcripts

A transcript may be retained only where it is sufficiently anonymized.
Potential anonymization work includes:

- replace or remove the participant display name;
- remove participant-account linkage;
- remove participant identifiers and speaker mappings to the person;
- remove direct identifiers appearing in transcript text;
- remove identifying participant notes or context.

If reliable anonymization is not realistically achievable for the concrete
transcript, delete it. This wave does not implement automatic transcript
anonymization.

## 8. AI analysis

For the requesting user:

- remove participant-specific personal AI feedback;
- remove direct identifiers;
- inspect shared/general analysis for identifying references;
- inspect `rawModelOutput` because it may contain personal information.

If safely editing an old analysis cannot guarantee sufficient
anonymization, delete the analysis. Regeneration from already anonymized
source material may be considered later; it is not an automatic step in
this procedure.

## 9. Verification

Repeat the discovery queries.

Confirm:

- account access is terminated;
- object-storage objects chosen for deletion are gone;
- remaining historical material no longer identifies the user where
  anonymization was chosen;
- recordings that included the user’s participation were deleted rather
  than left under a renamed participant.

## 10. Evidence

Record in the case file:

- what was deleted, anonymized, retained, or left for manual review, and
  why;
- object keys processed;
- provider-side follow-up, if any;
- verification results.

Preserve evidence required to demonstrate completion of destruction, in
line with the operator’s duties under Federal Law No. 152-FZ and the
destruction-confirmation requirements of the authorized body
(Roskomnadzor; see the current requirements established under Article 21
of 152-FZ). Do not store a new copy of the deleted personal data in the
evidence file.

## 11. Response

Notify the requester of completion or status at the contact used for the
request. Do not expose internal identifiers, storage keys, SQL, provider
console details, or other operational secrets.

If part of the request cannot be completed (for example unconfirmed
provider-side copies), say so in plain language and keep the remainder of
the case open until a separately reviewed follow-up is done.

## Future one-off procedure

A later, separately reviewed one-off operation may define exact mutation
steps for a named case. That operation must be reviewed before execution,
must start from this discovery inventory, and must not be derived by
pasting unchecked SQL from this runbook.

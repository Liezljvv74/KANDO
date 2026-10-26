/** What a staff decision on a document tells the owner. Task 11 replaces the body with the email. */
export type DocumentDecision = { id: string; requirement: string; status: 'approved' | 'rejected'; note: string | null }

export async function notifyDocumentDecision(userId: string, document: DocumentDecision): Promise<void> {
  // TODO(Task 11): send the decision email to the user.
  void userId
  void document
}

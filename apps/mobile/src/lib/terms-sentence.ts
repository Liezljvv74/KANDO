export type SentencePart = { text: string; link?: 'terms' | 'privacy' }

/** Splits the one translated sentence at {terms} and {privacy}, so each language keeps its own word order. */
export function splitSentence(sentence: string, labels: { terms: string; privacy: string }): SentencePart[] {
  return sentence
    .split(/(\{terms\}|\{privacy\})/)
    .filter(Boolean)
    .map((s) => (s === '{terms}' ? { text: labels.terms, link: 'terms' as const } : s === '{privacy}' ? { text: labels.privacy, link: 'privacy' as const } : { text: s }))
}

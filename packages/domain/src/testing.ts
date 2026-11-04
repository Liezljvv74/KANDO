// Test-only hooks, kept out of the '@kando/domain' barrel. Tests import '@kando/domain/src/testing'.
export { outboxForTests } from './email'
export { pushOutboxForTests } from './push'
export { setStorageForTests } from './storage'
export { setDocumentCheckerForTests } from './ai/document-check'
export { setIdScannerForTests } from './ai/id-scan'
export { setGatewayForTests } from './payments/gateway'

export { canonicalAward, discoverCategories, discoverAwards, splitAwards, splitValue, mergeCategories, cellValue } from './discover';
export type { DiscoveredCategory } from './discover';
export {
  assignCertificates, matchesCategory, testCondition, schemeFromDiscovery, schemeCoverage, categoryById, resolveCategory,
  certificateSettings, emailTemplateIdForGroup, newCategoriesFor, groupForDelivery, DEFAULT_CATEGORY_ID,
} from './assign';
export type { AssignResult, DeliveryGroup, CertificateSettings } from './assign';

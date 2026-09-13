// SQLite has no native enum type, so these values are enforced in application
// code instead of the database schema.
module.exports = {
  // Public ingestion endpoint (/api/track) input caps. These exist because
  // /api/track is a public, unauthenticated-by-CAPTCHA write endpoint — anyone
  // with a project's API key (including a portfolio visitor testing it) can
  // call it directly, so the server has to defend its own database.
  EVENT_NAME_MAX_LENGTH: 100,
  DISTINCT_ID_MAX_LENGTH: 200,
  PROPERTIES_MAX_BYTES: 4096,

  // Seed data / reference event catalog used across both demo projects.
  EVENT_NAMES: [
    'page_view',
    'signup_started',
    'signup_completed',
    'checkout_started',
    'checkout_completed',
    'feature_used',
  ],

  RECENT_EVENTS_LIMIT: 50,
  CSV_EXPORT_ROW_CAP: 5000,
};

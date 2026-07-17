const app = require("./app.json");

module.exports = ({ config }) => {
  const base = app.expo;
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim()
    || base.extra?.eas?.projectId
    || config.extra?.eas?.projectId;
  return {
    ...config,
    ...base,
    android: {
      ...base.android,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || base.android?.googleServicesFile
    },
    extra: {
      ...base.extra,
      eas: projectId ? { projectId } : base.extra?.eas
    }
  };
};

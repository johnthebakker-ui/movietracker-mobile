const app = require("./app.json");

module.exports = ({ config }) => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const base = app.expo;
  return {
    ...config,
    ...base,
    extra: {
      ...base.extra,
      eas: projectId ? { projectId } : undefined
    }
  };
};

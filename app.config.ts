import type { ConfigContext, ExpoConfig } from "expo/config";
import app from "./app.json";

export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const base = app.expo as ExpoConfig;
  return {
    ...config,
    ...base,
    extra: {
      ...base.extra,
      eas: projectId ? { projectId } : undefined
    }
  } as ExpoConfig;
};

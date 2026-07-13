import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const options: SecureStore.SecureStoreOptions = {
  keychainService: "movietracker-auth",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};
const chunkSize = 1800;
const metaKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, index: number) => `${key}.chunk.${index}`;

async function deleteChunks(key: string, count: number) {
  await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index), options)));
}

// Supabase's storage contract is deliberately tiny. Existing AsyncStorage
// sessions are migrated once so an app update does not sign the user out.
export const secureAuthStorage = {
  async getItem(key: string) {
    const chunkCount = Number(await SecureStore.getItemAsync(metaKey(key), options) ?? 0);
    const secured = chunkCount > 0
      ? (await Promise.all(Array.from({ length: chunkCount }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index), options)))).join("")
      : await SecureStore.getItemAsync(key, options);
    if (secured != null) return secured;
    const legacy = await AsyncStorage.getItem(key);
    if (legacy != null) {
      await secureAuthStorage.setItem(key, legacy);
      await AsyncStorage.removeItem(key);
    }
    return legacy;
  },
  async setItem(key: string, value: string) {
    const previousChunks = Number(await SecureStore.getItemAsync(metaKey(key), options) ?? 0);
    if (value.length <= chunkSize) {
      await SecureStore.setItemAsync(key, value, options);
      await deleteChunks(key, previousChunks);
      await SecureStore.deleteItemAsync(metaKey(key), options);
    } else {
      const chunks = Array.from({ length: Math.ceil(value.length / chunkSize) }, (_, index) => value.slice(index * chunkSize, (index + 1) * chunkSize));
      await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk, options)));
      if (previousChunks > chunks.length) await Promise.all(Array.from({ length: previousChunks - chunks.length }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, chunks.length + index), options)));
      await SecureStore.setItemAsync(metaKey(key), String(chunks.length), options);
      await SecureStore.deleteItemAsync(key, options);
    }
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },
  async removeItem(key: string) {
    const chunkCount = Number(await SecureStore.getItemAsync(metaKey(key), options) ?? 0);
    await Promise.all([
      SecureStore.deleteItemAsync(key, options),
      SecureStore.deleteItemAsync(metaKey(key), options),
      deleteChunks(key, chunkCount),
      AsyncStorage.removeItem(key)
    ]);
  }
};
